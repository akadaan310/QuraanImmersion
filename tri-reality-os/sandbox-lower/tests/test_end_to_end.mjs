/**
 * Full-stack integration: a real memory-mapped registry written by
 * dilation_registry.py, streamed by the real upper_sync_daemon.js CLI, into the
 * real sandbox-upper/api/ingest.js handler.
 *
 * Nothing here is mocked except the network transport being localhost. The
 * point is to prove the three modules actually compose -- in particular that a
 * SUPER-CRITICAL registry, whose proper times are astronomically outside
 * float64, survives the whole path from mmap to HTTP response without becoming
 * Infinity or NaN anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

import ingestHandler from '../../sandbox-upper/api/ingest.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const LOWER = path.resolve(HERE, '..');

/**
 * Minimal @vercel/node response shim: gives a plain http ServerResponse the
 * `.status().json()` surface the handler is written against.
 */
function vercelify(handler) {
  return (req, res) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      const body = JSON.stringify(obj);
      res.setHeader('content-type', 'application/json');
      res.end(body);
      return res;
    };
    Promise.resolve(handler(req, res)).catch((err) => {
      if (!res.headersSent) { res.statusCode = 500; res.end(String(err)); }
    });
  };
}

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

test('end-to-end: super-critical registry -> daemon CLI -> ingest handler', async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'tro-e2e-'));
  const registryDir = path.join(work, 'registry');

  // ---- 1. Build a real SUPER-CRITICAL registry with dilation_registry.py ----
  // Radii reach 1e-3, where exp(lambda/r^2) = e^3.5e6 -- utterly beyond float64.
  const py = `
import numpy as np, sys
sys.path.insert(0, ${JSON.stringify(LOWER)})
from dilation_registry import DilationRegistry, DilationConfig
n = 512
radii = np.geomspace(1e-3, 4.0, n)
coords = np.zeros((n, 3)); coords[:, 0] = radii
cfg = DilationConfig(N=3, n_sites=n, lam=3.5, r_ref=1.0)
reg = DilationRegistry.create(${JSON.stringify(registryDir)}, cfg, coords=coords, overwrite=True)
reg.run(dt=1e-4, n_steps=20)
reg.flush(); reg.close()
s = reg.summary()
print(s["phase"], s["log_rate_max"], s["float64_would_overflow"], s["log_tau_max"])
`;
  const { stdout } = await execFileAsync('python3', ['-c', py]);
  const [phase, logRateMax, wouldOverflow] = stdout.trim().split(/\s+/);
  assert.equal(phase, 'SUPER_CRITICAL');
  assert.equal(wouldOverflow, 'True', 'this registry must genuinely exceed float64');
  assert.ok(Number(logRateMax) > 1e6, `expected a divergent core rate, got ${logRateMax}`);

  // ---- 2. Stand up the REAL ingest handler over plain http -----------------
  const received = [];
  const server = http.createServer(vercelify(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    // Re-feed the buffered body, since the handler reads the stream itself.
    const body = Buffer.concat(chunks);
    const fake = Object.assign(Object.create(Object.getPrototypeOf(req)), req, {
      on(event, cb) {
        if (event === 'data') process.nextTick(() => cb(body));
        if (event === 'end') process.nextTick(() => cb());
        return fake;
      },
      destroy() {},
      method: req.method,
      headers: req.headers,
    });
    const capture = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(obj) { received.push({ status: this.statusCode, body: obj });
                  res.status(this.statusCode).json(obj); return this; },
    };
    await ingestHandler(fake, capture);
  }));
  const port = await listen(server);
  t.after(() => server.close());

  // ---- 3. Run the ACTUAL daemon CLI against it ----------------------------
  const spoolDir = path.join(work, 'spool');
  const child = spawn(process.execPath, [
    path.join(LOWER, 'upper_sync_daemon.js'),
    `--endpoint=http://127.0.0.1:${port}/api/ingest`,
    `--registry=${registryDir}`,
    `--spool=${spoolDir}`,
    '--interval=150',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const deadline = Date.now() + 20000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));

  // ---- 4. Verify what actually arrived ------------------------------------
  assert.ok(received.length > 0, `no frame reached the handler. daemon stderr:\n${stderr}`);
  const first = received[0];
  assert.equal(first.status, 200, `handler rejected the frame: ${JSON.stringify(first.body)}`);

  const b = first.body;
  assert.equal(b.protocol, 1);
  assert.equal(b.ackSeq, '0');
  assert.deepEqual(b.received.shape, [512]);
  assert.equal(b.received.lambda, 3.5);
  assert.equal(b.received.phase, 'SUPER_CRITICAL', 'the handler must classify the phase');
  assert.equal(b.received.compressed, true, 'tau telemetry should compress on the wire');
  assert.ok(b.received.wireBytes < b.received.payloadBytes,
    `wire ${b.received.wireBytes} B should beat raw ${b.received.payloadBytes} B`);

  // The headline: a registry whose tau is ~e^3.5e6 survives the full path.
  assert.equal(b.tau.count, 512);
  assert.ok(b.tau.exceedsFloat64, 'the frame genuinely carries super-float64 proper times');
  assert.ok(Number.isFinite(b.tau.logTauMax), 'logTauMax must not be Infinity');
  assert.ok(Number.isFinite(b.tau.logTauSum), 'log-sum-exp must not be Infinity');
  assert.ok(b.tau.logTauMax > 100, `core clock should be enormous, got ${b.tau.logTauMax}`);

  await fs.rm(work, { recursive: true, force: true });
});

test('end-to-end: sub-critical registry reports uniform clocks', async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'tro-e2e-sub-'));
  const registryDir = path.join(work, 'registry');
  const py = `
import numpy as np, sys
sys.path.insert(0, ${JSON.stringify(LOWER)})
from dilation_registry import DilationRegistry, DilationConfig
cfg = DilationConfig(N=4, n_sites=256, lam=1.2)
reg = DilationRegistry.create(${JSON.stringify(registryDir)}, cfg, overwrite=True)
reg.run(dt=0.01, n_steps=100)     # t_global = 1.0 exactly
reg.flush(); reg.close()
print(reg.summary()["phase"], reg.t_global)
`;
  const { stdout } = await execFileAsync('python3', ['-c', py]);
  assert.match(stdout, /SUB_CRITICAL/);

  const tau = await fs.readFile(path.join(registryDir, 'log_tau.dat'));
  const view = new Float64Array(tau.buffer, tau.byteOffset, tau.length / 8);
  // Phase A conservation law, verified from the raw mmap bytes: ln(tau) = ln(1) = 0.
  for (let i = 0; i < view.length; i++) {
    assert.ok(Math.abs(view[i]) < 1e-12, `site ${i}: ln(tau)=${view[i]}, expected 0`);
  }
  await fs.rm(work, { recursive: true, force: true });
});
