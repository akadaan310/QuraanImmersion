#!/usr/bin/env node
/**
 * server.mjs — the Termux ⇄ browser bridge.
 *
 * Serves the built `dist/` to whichever Android browser the operator points at
 * it, and holds open two channels the browser cannot open for itself:
 *
 *   GET  /__bridge/events    SSE. Commands typed in Termux arrive here.
 *   POST /__bridge/rpc       The page asks Termux to touch the device.
 *   POST /__bridge/state     The page reports what it is doing, for `isnaad watch`.
 *
 * Node standard library only. Termux on ARM64 can install a great deal, but
 * every dependency is a wheel or a native build that can fail on a phone at the
 * worst possible moment, so the bridge has none.
 *
 * BINDING. Default is 127.0.0.1. The phone's own browser reaches loopback, and
 * loopback is the one interface that cannot be reached from the coffee-shop
 * Wi-Fi. `--lan` opens it to the local network for desktop debugging, and then
 * the token stops being a formality: it is the only thing between the bridge
 * and everyone else on that network. Privileged ops stay loopback-only
 * regardless of any flag.
 */

import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import {
  BRIDGE_PREFIX, COMMANDS, ProtocolError, authorise, buildCommand,
  encodeSSE, injectClient, isLoopback, tokenMatches,
} from './protocol.mjs';
import { OpArgError, describeOps, makeOps, runOp } from './ops.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const args = {};
  for (const entry of argv.slice(2)) {
    if (!entry.startsWith('--')) continue;
    const [key, ...value] = entry.slice(2).split('=');
    args[key] = value.length ? value.join('=') : 'true';
  }
  return args;
}

function sendJSON(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function readBody(request, limit = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ProtocolError('request body too large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ProtocolError('body is not JSON');
  }
}

/** The one interface address the phone can actually be reached on. */
function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

export function createBridge(options = {}) {
  const root = path.resolve(options.root || 'dist');
  const token = options.token || randomBytes(24).toString('base64url');
  const allowRoot = Boolean(options.allowRoot);
  const allowExec = Boolean(options.allowExec);
  const allowLan = Boolean(options.allowLan);
  const ops = makeOps({ su: options.su || 'su', termuxApi: options.termuxApi !== false });

  /** Connected SSE clients — usually exactly one: the phone's browser. */
  const subscribers = new Set();
  /** Last 64 commands, so a page that reconnects mid-recitation catches up. */
  const history = [];
  let seq = 0;
  /** Whatever the page last said about itself. `isnaad watch` reads this. */
  let pageState = { connected: false, at: 0 };

  function broadcast(command) {
    const frame = encodeSSE('command', command, command.seq);
    for (const client of subscribers) {
      try { client.write(frame); } catch { subscribers.delete(client); }
    }
    history.push(command);
    if (history.length > 64) history.shift();
    return { delivered: subscribers.size, seq: command.seq };
  }

  /** Push a command to the page. Throws ProtocolError on bad input. */
  function dispatch(name, args) {
    const command = buildCommand(name, args, seq + 1);
    seq = command.seq;
    return { command, ...broadcast(command) };
  }

  function presentedToken(request, url) {
    return url.searchParams.get('k')
      || (request.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || request.headers['x-bridge-token']
      || '';
  }

  async function serveStatic(request, response, pathname) {
    // Resolve inside `root`, then verify it stayed there.
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    let target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return sendJSON(response, 403, { error: 'path escapes the served root' });
    }

    let stat = await fsp.stat(target).catch(() => null);
    if (stat?.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fsp.stat(target).catch(() => null);
    }
    // SPA fallback: /engine/isnaad is a route, not a file on disk.
    if (!stat && !path.extname(relative)) {
      target = path.join(root, 'index.html');
      stat = await fsp.stat(target).catch(() => null);
    }
    if (!stat) {
      return sendJSON(response, 404, { error: `not found: /${relative}` });
    }

    if (target.endsWith('index.html')) {
      const html = await fsp.readFile(target, 'utf8');
      const injected = injectClient(html, { token, allowRoot });
      response.writeHead(200, {
        'content-type': MIME['.html'],
        'content-length': Buffer.byteLength(injected),
        'cache-control': 'no-store',
      });
      return response.end(injected);
    }

    response.writeHead(200, {
      'content-type': MIME[path.extname(target)] || 'application/octet-stream',
      'content-length': stat.size,
      // Vite fingerprints its assets, so they are safe to cache hard — which
      // matters on a phone reopening the page over mobile data.
      'cache-control': /-[A-Za-z0-9_]{8}\./.test(path.basename(target))
        ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return createReadStream(target).pipe(response);
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://bridge.local');
    const pathname = url.pathname;
    const remote = request.socket.remoteAddress;

    try {
      if (!pathname.startsWith(BRIDGE_PREFIX)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return sendJSON(response, 405, { error: 'method not allowed' });
        }
        return await serveStatic(request, response, pathname);
      }

      const route = pathname.slice(BRIDGE_PREFIX.length) || '/';

      // ---------------------------------------------------------- client shim
      if (route === '/client.js' && request.method === 'GET') {
        const source = await fsp.readFile(path.join(HERE, 'client.js'), 'utf8');
        response.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        return response.end(source);
      }

      if (route === '/health' && request.method === 'GET') {
        return sendJSON(response, 200, {
          ok: true, protocol: 1, root: allowRoot, exec: allowExec, lan: allowLan,
          subscribers: subscribers.size, seq, uptime: Math.round(process.uptime()),
        });
      }

      // Everything past this line is authenticated.
      const presented = presentedToken(request, url);

      if (route === '/events' && request.method === 'GET') {
        if (!tokenMatches(token, presented)) return sendJSON(response, 401, { error: 'bad bridge token' });
        if (!isLoopback(remote) && !allowLan) return sendJSON(response, 403, { error: 'loopback only' });

        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          // Chrome and Samsung Internet both buffer an unflushed event stream
          // through their compression layer; this is the header that stops it.
          'x-accel-buffering': 'no',
        });
        response.write(encodeSSE('hello', { seq, allowRoot, protocol: 1 }));
        subscribers.add(response);
        pageState = { ...pageState, connected: true, at: Date.now() };

        // Replay whatever the page missed while it was navigating.
        const since = Number(request.headers['last-event-id'] || url.searchParams.get('since') || 0);
        for (const command of history) {
          if (command.seq > since) response.write(encodeSSE('command', command, command.seq));
        }

        const heartbeat = setInterval(() => {
          // A comment frame: holds the radio's NAT mapping and the browser's
          // idle timer open without waking any listener inside the page.
          try { response.write(': ping\n\n'); } catch { /* closed just below */ }
        }, 15_000);
        const close = () => {
          clearInterval(heartbeat);
          subscribers.delete(response);
          if (subscribers.size === 0) pageState = { ...pageState, connected: false, at: Date.now() };
        };
        request.on('close', close);
        response.on('error', close);
        return undefined;
      }

      if (route === '/command' && request.method === 'POST') {
        if (!tokenMatches(token, presented)) return sendJSON(response, 401, { error: 'bad bridge token' });
        if (!isLoopback(remote)) return sendJSON(response, 403, { error: 'commands are loopback-only' });
        const body = await readBody(request);
        const result = dispatch(body.name, body.args || []);
        return sendJSON(response, 200, { ok: true, ...result });
      }

      if (route === '/commands' && request.method === 'GET') {
        return sendJSON(response, 200, {
          commands: Object.entries(COMMANDS).map(([name, spec]) => ({
            name, help: spec.help, args: spec.args.map((argument) => argument.name),
          })),
        });
      }

      if (route === '/ops' && request.method === 'GET') {
        if (!tokenMatches(token, presented)) return sendJSON(response, 401, { error: 'bad bridge token' });
        return sendJSON(response, 200, { ops: describeOps(ops, { allowRoot, allowExec }) });
      }

      if (route === '/rpc' && request.method === 'POST') {
        const body = await readBody(request);
        const verdict = authorise({
          op: body.op, table: ops, token, presented, remote, allowRoot, allowExec, allowLan,
        });
        if (!verdict.ok) {
          console.error(`[bridge] refused ${body.op} from ${remote}: ${verdict.reason}`);
          return sendJSON(response, verdict.status, { error: verdict.reason });
        }
        let result;
        try {
          result = await runOp(verdict.entry, body.args);
        } catch (error) {
          if (error instanceof OpArgError) return sendJSON(response, 400, { error: error.message });
          throw error;
        }
        // Every privileged call leaves a line in the terminal the operator is
        // sitting in front of. Root that runs silently is root you cannot audit.
        if (verdict.entry.root) console.error(`[bridge] ROOT ${body.op} → exit ${result.code}`);
        return sendJSON(response, 200, { op: body.op, ...result });
      }

      if (route === '/state') {
        if (!tokenMatches(token, presented)) return sendJSON(response, 401, { error: 'bad bridge token' });
        if (request.method === 'POST') {
          const body = await readBody(request, 256 * 1024);
          pageState = { ...body, connected: subscribers.size > 0, at: Date.now() };
          if (options.onState) options.onState(pageState);
          return sendJSON(response, 200, { ok: true });
        }
        if (request.method === 'GET') return sendJSON(response, 200, pageState);
      }

      return sendJSON(response, 404, { error: `no bridge route ${route}` });
    } catch (error) {
      if (error instanceof ProtocolError) return sendJSON(response, error.status, { error: error.message });
      console.error('[bridge] internal error:', error);
      return sendJSON(response, 500, { error: 'internal bridge error' });
    }
  });

  return {
    server, token, dispatch, ops,
    get subscribers() { return subscribers.size; },
    get state() { return pageState; },
  };
}

// ------------------------------------------------------------------ CLI entry

async function main() {
  const args = parseArgs(process.argv);
  const host = args.host || (args.lan === 'true' ? '0.0.0.0' : '127.0.0.1');
  const port = Number(args.port || 4173);

  const bridge = createBridge({
    root: args.root || 'dist',
    token: args.token || process.env.ISNAAD_BRIDGE_TOKEN,
    allowRoot: args['allow-root-rpc'] === 'true',
    allowExec: args['allow-root-exec'] === 'true',
    allowLan: args.lan === 'true',
    su: args.su || process.env.ISNAAD_SU || 'su',
    termuxApi: args['no-termux-api'] !== 'true',
  });

  if (args['token-file']) {
    await fsp.writeFile(args['token-file'], bridge.token, { mode: 0o600 });
  }

  await new Promise((resolve, reject) => {
    bridge.server.once('error', reject);
    bridge.server.listen(port, host, resolve);
  });

  console.error(`[bridge] serving ${path.resolve(args.root || 'dist')}`);
  console.error(`[bridge] listening on http://${host}:${port}`);
  if (args.lan === 'true') {
    const lan = lanAddress();
    if (lan) console.error(`[bridge] LAN:  http://${lan}:${port}/?k=${bridge.token}`);
  }
  console.error(`[bridge] root RPC: ${args['allow-root-rpc'] === 'true' ? 'ENABLED' : 'disabled'}`
    + `  unbounded exec: ${args['allow-root-exec'] === 'true' ? 'ENABLED' : 'disabled'}`);

  // stdout carries exactly one line: the URL. The shell reads it with $(…),
  // and everything above went to stderr precisely so that it can.
  console.log(`http://127.0.0.1:${port}/?k=${bridge.token}`);

  const shutdown = () => {
    console.error('\n[bridge] closing');
    bridge.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
