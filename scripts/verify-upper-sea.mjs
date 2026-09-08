import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib/harness.mjs';
import ingestHandler from '../api/ingest.js';

const DIST = path.resolve(new URL('..', import.meta.url).pathname, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.json': 'application/json', '.svg': 'image/svg+xml' };

/** Minimal @vercel/node response shim. */
function shimResponse(res, onResult, bodyLength) {
  return {
    statusCode: 200,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(obj) {
      onResult({ status: this.statusCode, body: obj, wireBytes: bodyLength });
      res.writeHead(this.statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
      return this;
    },
  };
}

const results = [];

/**
 * One origin serving BOTH the built app and the real api/ingest handler —
 * exactly the topology the Vercel deployment has. No request interception, so
 * nothing sits between the browser's encoder and the endpoint's decoder.
 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/ingest') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const fake = {
        method: req.method,
        headers: req.headers,
        on(event, cb) {
          if (event === 'data') process.nextTick(() => cb(body));
          if (event === 'end') process.nextTick(() => cb());
          return fake;
        },
        destroy() {},
      };
      await ingestHandler(fake, shimResponse(res, (r) => results.push(r), body.length));
    });
    return;
  }

  // Static SPA: serve the asset if it exists, else index.html.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(DIST, rel);
  const target = fs.existsSync(file) && fs.statSync(file).isFile()
    ? file : path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const ORIGIN = `http://127.0.0.1:${port}`;

const { browser, context } = await launch();
const page = await context.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push(String(e).slice(0, 300)));

await page.goto(ORIGIN + '/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Drive the recitation so the seas are actually running, then wait for the
// sync client's own 1 s cadence to fire.
await page.evaluate(() => {
  const { audioEngine, isnaadEngine } = window.__ISNAAD__;
  const real = audioEngine.analyse.bind(audioEngine);
  let t = 0;
  audioEngine.analyse = () => {
    const f = real(); t += 1 / 60;
    const env = 0.6 + 0.3 * Math.sin(t * 2);
    f.dt = 1 / 60; f.level = env; f.peak = env; f.transient = Math.max(0, Math.sin(t * 9)) * 0.9;
    f.centroid = 0.5; f.bass = 0.8 * env; f.treble = 0.7 * env; f.mid = 0.6 * env;
    f.subBass = 0.5 * env; f.lowMid = 0.5 * env; f.highMid = 0.5 * env;
    f.playing = true; f.progress = (t % 8) / 8; f.duration = 8;
    return f;
  };
  isnaadEngine.beginExecution();
});

const deadline = Date.now() + 20000;
while (results.length < 2 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200));
}

const link = await page.evaluate(() => {
  // The HUD samples this; read it straight from the module the app uses.
  return window.__ISNAAD_LINK__ ? { ...window.__ISNAAD_LINK__() } : null;
});

await browser.close();
server.close();

let failures = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failures += 1; };
const pass = (msg) => console.log(`✓ ${msg}`);

if (problems.length) fail(`page errors: ${problems.join(' | ')}`);

if (results.length === 0) {
  fail('the browser never sent a frame to the upper-sea endpoint');
} else {
  const accepted = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status !== 200);
  if (rejected.length) {
    fail(`endpoint rejected ${rejected.length} frame(s): ${JSON.stringify(rejected[0].body)}`);
  } else {
    pass(`endpoint accepted ${accepted.length} browser-encoded TRO1 frame(s)`);
  }

  const last = accepted[accepted.length - 1];
  if (last) {
    const t = last.body.tau;
    const r = last.body.received;
    pass(`shape ${JSON.stringify(r.shape)} · ${r.wireBytes} B wire / ${r.payloadBytes} B raw`
       + ` (${(r.payloadBytes / r.wireBytes).toFixed(2)}x) · compressed=${r.compressed}`);
    pass(`phase ${r.phase} · lambda ${r.lambda.toFixed(3)} · ${t.count} clocks`);
    if (r.shape[0] !== 72 * 72) fail(`expected 5184 clocks, got ${r.shape[0]}`);

    // The very first frame legitimately has no finite maximum: every clock
    // still reads tau = 0, i.e. ln(tau) = -Infinity. What must hold is that
    // SOME frame, once the seas have run, carries finite accumulated time.
    const withTime = accepted.find((a) => Number.isFinite(a.body.tau.logTauMax));
    if (!withTime) {
      fail('no frame ever carried a finite ln(tau) — the seas are not advancing');
    } else {
      const tt = withTime.body.tau;
      pass(`ln(tau) max ${tt.logTauMax.toExponential(3)} · ${tt.finite} running`
         + ` · ${tt.atZero} at zero`);
    }
  }
}

if (link) {
  if (link.state === 'live') pass(`link live · rtt ${link.rttMs.toFixed(0)} ms · ${link.acked} acked`);
  else fail(`link state is ${link.state}: ${link.lastError}`);
}

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ upper sea round trip verified');
process.exit(failures ? 1 : 0);
