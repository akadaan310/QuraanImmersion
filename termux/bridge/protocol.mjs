/**
 * protocol.mjs — the wire contract between the Termux CLI, the bridge server
 * and the page running inside the Android browser.
 *
 * Everything in this file is PURE. No sockets, no child processes, no fs. That
 * is deliberate: the framing, the authorisation decision and the HTML injection
 * are the three things that are easy to get subtly wrong and impossible to test
 * once they are entangled with I/O, so they live here and `tests/` exercises
 * them directly.
 *
 * Three channels cross the Termux ⇄ browser boundary:
 *
 *   CLI ──command──►  server ──SSE──►  page      drive the running scene
 *   page ──RPC────►  server ──exec──►  Android   reach the device from the page
 *   page ──state──►  server ──read──►  CLI       telemetry back to the terminal
 *
 * The first and third are trusted-ish (the CLI owns the server). The second is
 * the dangerous one — it is a browser asking a shell to do something — so every
 * op it may name is declared, typed and bounded in `ops.mjs`, and this file
 * refuses anything not in that table before a process is ever spawned.
 */

import { timingSafeEqual } from 'node:crypto';

export const PROTOCOL_VERSION = 1;

/** Path prefix the server owns. Anything under it is bridge, not app. */
export const BRIDGE_PREFIX = '/__bridge';

/**
 * Commands the CLI may push down the SSE channel to the page.
 *
 * `args` is validated positionally against these specs before the command is
 * queued, so a malformed `isnaad play 999 999` fails in the terminal with a
 * usable message rather than silently doing nothing three layers away in a
 * browser the operator may not even be looking at.
 */
export const COMMANDS = {
  play:      { args: [], help: 'تشغيل — start the current ayah' },
  pause:     { args: [], help: 'إيقاف — pause playback' },
  toggle:    { args: [], help: 'toggle playback' },
  next:      { args: [], help: 'الآية التالية' },
  prev:      { args: [], help: 'الآية السابقة' },
  verse:     { args: [{ name: 'surah', type: 'int', min: 1, max: 114 },
                      { name: 'ayah',  type: 'int', min: 1, max: 286 }],
               help: 'select surah:ayah' },
  reciter:   { args: [{ name: 'id', type: 'enum', values: ['husary', 'kurdi', 'qatami', 'dosari'] }],
               help: 'switch reciter' },
  scene:     { args: [{ name: 'id', type: 'string', pattern: /^[a-z0-9-]{2,40}$/ }],
               help: 'select phenomenon by id' },
  route:     { args: [{ name: 'path', type: 'string', pattern: /^\/[A-Za-z0-9/_:-]{0,80}$/ }],
               help: 'navigate the SPA' },
  hud:       { args: [{ name: 'state', type: 'enum', values: ['on', 'off', 'toggle'] }], help: 'HUD visibility' },
  invert:    { args: [{ name: 'state', type: 'enum', values: ['on', 'off', 'toggle'] }], help: 'inverted viewport' },
  volume:    { args: [{ name: 'level', type: 'float', min: 0, max: 1 }], help: 'output level 0..1' },
  loop:      { args: [{ name: 'state', type: 'enum', values: ['on', 'off'] }], help: 'loop the ayah' },
  lambda:    { args: [{ name: 'sea', type: 'enum', values: ['lower', 'upper'] },
                      { name: 'value', type: 'float', min: 0.1, max: 6.0 }],
               help: 'set a sea eigenvalue (مرج البحرين)' },
  reload:    { args: [], help: 'reload the page' },
  calibrate: { args: [{ name: 'state', type: 'enum', values: ['reset', 'complete'] }], help: 'onboarding gate' },
  ping:      { args: [], help: 'liveness probe; the page answers with state' },
};

/** Thrown for anything an operator can fix by retyping. Carries an HTTP code. */
export class ProtocolError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ProtocolError';
    this.status = status;
  }
}

function coerce(spec, raw) {
  if (raw === undefined || raw === null || raw === '') {
    throw new ProtocolError(`missing argument <${spec.name}>`);
  }
  switch (spec.type) {
    case 'int': {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new ProtocolError(`<${spec.name}> must be an integer, got ${JSON.stringify(raw)}`);
      if (value < spec.min || value > spec.max) {
        throw new ProtocolError(`<${spec.name}> must be ${spec.min}..${spec.max}, got ${value}`);
      }
      return value;
    }
    case 'float': {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ProtocolError(`<${spec.name}> must be a number, got ${JSON.stringify(raw)}`);
      if (value < spec.min || value > spec.max) {
        throw new ProtocolError(`<${spec.name}> must be ${spec.min}..${spec.max}, got ${value}`);
      }
      return value;
    }
    case 'enum': {
      const value = String(raw);
      if (!spec.values.includes(value)) {
        throw new ProtocolError(`<${spec.name}> must be one of ${spec.values.join('|')}, got ${JSON.stringify(raw)}`);
      }
      return value;
    }
    case 'string': {
      const value = String(raw);
      if (spec.pattern && !spec.pattern.test(value)) {
        throw new ProtocolError(`<${spec.name}> is malformed: ${JSON.stringify(raw)}`);
      }
      return value;
    }
    default:
      throw new ProtocolError(`unknown argument type ${spec.type}`, 500);
  }
}

/**
 * Build a command envelope from CLI-shaped input, or throw.
 *
 * Verse bounds are checked loosely here (1..286 covers the longest surah); the
 * page clamps against the real per-surah table in `clampVerse`. Two layers,
 * because this one cannot know the surah table and that one cannot report to a
 * terminal.
 */
export function buildCommand(name, rawArgs = [], seq = 0) {
  const spec = COMMANDS[name];
  if (!spec) throw new ProtocolError(`unknown command '${name}'. try: ${Object.keys(COMMANDS).join(' ')}`);
  if (rawArgs.length > spec.args.length) {
    throw new ProtocolError(`'${name}' takes ${spec.args.length} argument(s), got ${rawArgs.length}`);
  }
  const args = spec.args.map((argSpec, index) => coerce(argSpec, rawArgs[index]));
  return { v: PROTOCOL_VERSION, seq, name, args, at: Date.now() };
}

/** Encode one envelope as a single SSE event. */
export function encodeSSE(event, data, id) {
  const payload = JSON.stringify(data);
  let frame = '';
  if (id !== undefined) frame += `id: ${id}\n`;
  frame += `event: ${event}\n`;
  // A payload never contains a raw newline after JSON.stringify, so one data
  // line is always sufficient — but split anyway, because a future non-JSON
  // payload silently truncating at the first newline would be a nasty bug.
  for (const line of payload.split('\n')) frame += `data: ${line}\n`;
  return `${frame}\n`;
}

/** Constant-time token comparison that tolerates length mismatch. */
export function tokenMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  if (expected.length === 0) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison so the reject path costs the same as a mismatch.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Decide whether an RPC may run.
 *
 * Returns `{ ok: true }` or `{ ok: false, status, reason }`. Split out from the
 * server so the whole authorisation matrix — token, origin, root gate, and the
 * separate gate on the one unbounded op — is a single testable function rather
 * than a chain of `if` statements wrapped around a spawn.
 *
 * The order is not arbitrary. Token first, so an unauthenticated caller learns
 * nothing about which ops exist; origin second; existence third; privilege
 * last.
 */
export function authorise({ op, table, token, presented, remote, allowRoot, allowExec, allowLan }) {
  if (!tokenMatches(token, presented)) {
    return { ok: false, status: 401, reason: 'bad or missing bridge token' };
  }
  const loopback = isLoopback(remote);
  if (!loopback && !allowLan) {
    return { ok: false, status: 403, reason: `off-device origin ${remote} rejected (bridge is loopback-only)` };
  }
  const entry = table[op];
  if (!entry) {
    return { ok: false, status: 404, reason: `unknown op '${op}'` };
  }
  if (entry.root && !allowRoot) {
    return { ok: false, status: 403, reason: `op '${op}' is privileged; start the bridge with --allow-root-rpc to enable it` };
  }
  if (entry.danger && !allowExec) {
    return { ok: false, status: 403, reason: `op '${op}' is unbounded; start the bridge with --allow-root-exec to enable it` };
  }
  if (entry.root && !loopback) {
    // A root op from another machine on the Wi-Fi is never what the operator
    // meant, even with the token and even with the flag set.
    return { ok: false, status: 403, reason: `privileged op '${op}' refused from non-loopback origin ${remote}` };
  }
  return { ok: true, entry, loopback };
}

export function isLoopback(address) {
  if (!address) return false;
  const clean = String(address).replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean.startsWith('127.');
}

/**
 * Inject the bridge client into the built index.html.
 *
 * The token rides in the injected markup rather than a cookie because the page
 * is served from a static bundle that knows nothing about the bridge, and the
 * bundle must stay byte-identical to what `npm run build` produced — patching
 * dist/ on disk would mean the served app is no longer the artefact that was
 * verified. So the injection happens in memory, per request.
 */
export function injectClient(html, { token, allowRoot, endpoint = BRIDGE_PREFIX }) {
  const config = JSON.stringify({ token, allowRoot: Boolean(allowRoot), endpoint, v: PROTOCOL_VERSION });
  const tag = `<script>window.__TERMUX_BRIDGE_CONFIG__=${config};</script>`
    + `<script src="${endpoint}/client.js" defer></script>`;
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`);
  return html + tag;
}
