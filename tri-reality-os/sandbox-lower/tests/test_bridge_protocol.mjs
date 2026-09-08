/**
 * Adversarial tests for the SANDBOX-LOWER -> SANDBOX-UPPER bridge.
 *
 * The point of this file is the no-loss claim. It is not tested by sending ten
 * frames to a healthy server; it is tested by breaking the server, killing the
 * process, and corrupting the wire, then asserting that every frame still
 * arrives exactly once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  FrameCodec, Spool, SyncDaemon, UplinkClient,
  shuffle, unshuffle, crc32, DTYPE, HEADER_BASE,
} from '../upper_sync_daemon.js';

const tmp = async (tag) => fs.mkdtemp(path.join(os.tmpdir(), `tro-${tag}-`));

/** A float64 payload shaped like real tau data: smooth, log-scale. */
function tauPayload(n, offset = 0) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.log1p(i + offset) * 3.5 + Math.sin(i / 50) * 0.25;
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

/* ------------------------------------------------------------------ codec */

test('byte shuffle is exactly invertible for every element width', () => {
  for (const width of [1, 4, 8]) {
    const buf = crypto.randomBytes(8000 + width); // deliberately not a multiple
    assert.deepEqual(unshuffle(shuffle(buf, width), width), buf, `width ${width}`);
  }
});

test('frame round-trips with metadata and payload intact', async () => {
  const payload = tauPayload(4096);
  const frame = await FrameCodec.encode({
    seq: 42n, payload, shape: [4096], dtype: DTYPE.FLOAT64,
    lambda: 3.5, tGlobal: 1.25, nSteps: 7,
  });
  const out = await FrameCodec.decode(frame);
  assert.equal(out.seq, 42n);
  assert.equal(out.lambda, 3.5);
  assert.equal(out.tGlobal, 1.25);
  assert.equal(out.nSteps, 7);
  assert.deepEqual(out.shape, [4096]);
  assert.deepEqual(out.payload, payload);
});

test('shuffle beats plain deflate on every payload shape, losslessly', async () => {
  // The absolute compression ratio belongs to the data, not to this code, so
  // asserting one would be a claim about the caller. What IS this module's
  // claim is that the byte shuffle improves on plain deflate -- test that.
  const zlib = await import('node:zlib');
  const { promisify } = await import('node:util');
  const deflate = promisify(zlib.deflateRaw);

  const shapes = {
    'phase A (uniform clocks)': (n) => { const a = new Float64Array(n); a.fill(Math.log(0.01)); return a; },
    'phase C (log rates)': (n) => { const a = new Float64Array(n);
      for (let i = 0; i < n; i++) { const r = 1e-3 * Math.pow(4000, i / n); a[i] = 3.5 * (1 / (r * r) - 1); }
      return a; },
    'smooth synthetic': (n) => { const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = Math.log1p(i) * 3.5 + Math.sin(i / 50) * 0.25; return a; },
    'uniform random': (n) => { const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = Math.random(); return a; },
  };

  for (const [name, gen] of Object.entries(shapes)) {
    const arr = gen(16384);
    const payload = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const plain = await deflate(payload, { level: 6 });
    const shuf = await deflate(shuffle(payload, 8), { level: 6 });
    const gain = plain.length / shuf.length;
    assert.ok(gain > 1.0, `${name}: shuffle should beat deflate, got ${gain.toFixed(2)}x`);

    // Whatever it does to size, it must not touch a single bit of the data.
    const framed = await FrameCodec.encode({ seq: 1n, payload, shape: [16384], compress: true });
    assert.deepEqual((await FrameCodec.decode(framed)).payload, payload, `${name} must be lossless`);
  }
});

test('a corrupted payload is REJECTED, not silently applied', async () => {
  const payload = tauPayload(1024);
  const frame = await FrameCodec.encode({ seq: 1n, payload, shape: [1024], compress: false });
  frame[HEADER_BASE + 100] ^= 0xff;                    // flip one bit in the payload
  await assert.rejects(() => FrameCodec.decode(frame), /CRC mismatch/);
});

test('a truncated frame is rejected', async () => {
  const frame = await FrameCodec.encode({ seq: 1n, payload: tauPayload(512), shape: [512] });
  await assert.rejects(() => FrameCodec.decode(frame.subarray(0, frame.length - 10)));
});

test('bad magic and bad version are rejected', async () => {
  const frame = await FrameCodec.encode({ seq: 1n, payload: tauPayload(64), shape: [64] });
  const badMagic = Buffer.from(frame); badMagic.write('XXXX', 0);
  await assert.rejects(() => FrameCodec.decode(badMagic), /bad magic/);
  const badVer = Buffer.from(frame); badVer.writeUInt8(99, 4);
  await assert.rejects(() => FrameCodec.decode(badVer), /unsupported version/);
});

test('shape/payload mismatch is caught at encode time', async () => {
  await assert.rejects(
    () => FrameCodec.encode({ seq: 1n, payload: tauPayload(100), shape: [99] }),
    /implies/);
});

/* ------------------------------------------------------------------ spool */

test('spool survives process death: unacked frames replay', async () => {
  const dir = await tmp('spool');
  const s1 = await new Spool(dir).open();
  for (let i = 0; i < 10; i++) {
    await s1.append(await FrameCodec.encode({ seq: BigInt(i), payload: tauPayload(256, i), shape: [256] }));
  }
  await s1.ack(4n);                 // frames 0..4 confirmed by the far end
  await s1.close();                 // simulate: process dies here

  const s2 = await new Spool(dir).open();
  const seen = [];
  for await (const { seq } of s2.pending()) seen.push(Number(seq));
  assert.deepEqual(seen, [5, 6, 7, 8, 9], 'exactly the unacked tail must replay');
  await s2.close();
});

test('spool tolerates a torn tail from a crash mid-write', async () => {
  const dir = await tmp('torn');
  const s1 = await new Spool(dir).open();
  for (let i = 0; i < 5; i++) {
    await s1.append(await FrameCodec.encode({ seq: BigInt(i), payload: tauPayload(128, i), shape: [128] }));
  }
  await s1.close();
  // Append a half-written record, as a kill -9 mid-write would leave.
  const logPath = path.join(dir, 'spool.log');
  const partial = Buffer.alloc(4 + 20);
  partial.writeUInt32LE(9999, 0);
  await fs.appendFile(logPath, partial);

  const s2 = await new Spool(dir).open();
  const seen = [];
  for await (const { seq } of s2.pending()) seen.push(Number(seq));
  assert.deepEqual(seen, [0, 1, 2, 3, 4], 'complete records survive a torn tail');
  await s2.close();
});

test('compaction reclaims acked space and keeps the tail', async () => {
  const dir = await tmp('compact');
  const s = await new Spool(dir).open();
  for (let i = 0; i < 20; i++) {
    await s.append(await FrameCodec.encode({ seq: BigInt(i), payload: tauPayload(512, i), shape: [512] }));
  }
  const before = s.bytes;
  await s.ack(14n);
  const after = await s.compact();
  assert.ok(after < before / 2, `compaction should reclaim: ${before} -> ${after}`);
  const seen = [];
  for await (const { seq } of s.pending()) seen.push(Number(seq));
  assert.deepEqual(seen, [15, 16, 17, 18, 19]);
  await s.close();
});

/* ------------------------------------- the no-loss claim, under real failure */

/** Ingest server that dedupes on seq and can be told to misbehave. */
function makeUpper({ failRate = 0, failStatus = 503 } = {}) {
  const received = new Map();   // seq -> sha256(payload)
  let requests = 0, rejected = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      requests++;
      if (Math.random() < failRate) {
        rejected++;
        res.writeHead(failStatus).end('injected failure');
        return;
      }
      try {
        const frame = Buffer.concat(chunks);
        const { seq, payload } = await FrameCodec.decode(frame);
        const digest = crypto.createHash('sha256').update(payload).digest('hex');
        const key = seq.toString();
        if (received.has(key)) {
          // Idempotent replay: must be byte-identical, or at-least-once is unsound.
          assert.equal(received.get(key), digest, `seq ${key} replayed with DIFFERENT bytes`);
        } else {
          received.set(key, digest);
        }
        res.writeHead(200, { 'content-type': 'application/json' })
           .end(JSON.stringify({ ackSeq: key }));
      } catch (err) {
        res.writeHead(400).end(String(err));
      }
    });
  });
  return { server, received, stats: () => ({ requests, rejected }) };
}

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

test('NO FRAME IS LOST when the uplink fails 50% of requests', async () => {
  const upper = makeUpper({ failRate: 0.5 });
  const port = await listen(upper.server);
  const dir = await tmp('flaky');

  const daemon = new SyncDaemon({
    endpoint: `http://127.0.0.1:${port}/api/ingest`,
    spoolDir: dir,
    clientOptions: { baseDelayMs: 5, maxDelayMs: 40, maxRetries: 12, timeoutMs: 2000 },
  });
  await daemon.start();

  const N = 40;
  const expected = new Map();
  for (let i = 0; i < N; i++) {
    const payload = tauPayload(1024, i);
    expected.set(String(i), crypto.createHash('sha256').update(payload).digest('hex'));
    await daemon.submit({ payload, shape: [1024], lambda: 3.5, tGlobal: i * 0.01, nSteps: i });
  }

  const deadline = Date.now() + 30000;
  while (upper.received.size < N && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await daemon.stop();
  upper.server.close();

  assert.equal(upper.received.size, N, `expected all ${N} frames, got ${upper.received.size}`);
  for (const [seq, digest] of expected) {
    assert.equal(upper.received.get(seq), digest, `seq ${seq} arrived corrupted or missing`);
  }
  assert.equal(daemon.stats().framesDropped, 0, 'no frame may be dropped');
  const s = upper.stats();
  assert.ok(s.rejected > 0, 'the failure injector must actually have fired');
});

test('NO FRAME IS LOST across a daemon kill and restart', async () => {
  const upper = makeUpper();
  const port = await listen(upper.server);
  const dir = await tmp('restart');
  const endpoint = `http://127.0.0.1:${port}/api/ingest`;
  const clientOptions = { baseDelayMs: 5, maxDelayMs: 20, maxRetries: 8 };

  // Phase 1: spool frames while the uplink is UNREACHABLE, then die abruptly.
  const dead = new SyncDaemon({
    endpoint: 'http://127.0.0.1:9/api/ingest',   // discard port: always refused
    spoolDir: dir,
    clientOptions: { baseDelayMs: 1, maxDelayMs: 5, maxRetries: 0, timeoutMs: 200 },
  });
  await dead.start();
  const expected = new Map();
  for (let i = 0; i < 12; i++) {
    const payload = tauPayload(512, i);
    expected.set(String(i), crypto.createHash('sha256').update(payload).digest('hex'));
    await dead.submit({ payload, shape: [512], lambda: 3.5 });
  }
  dead.running = false;                 // kill -9: no graceful drain, no acks
  await dead.spool.close();

  // Phase 2: a fresh daemon on the same spool must replay everything.
  const revived = new SyncDaemon({ endpoint, spoolDir: dir, clientOptions });
  const { resumedFrames } = await revived.start();
  assert.equal(resumedFrames, 12, 'all 12 unacked frames must be recovered from disk');

  const deadline = Date.now() + 20000;
  while (upper.received.size < 12 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await revived.stop();
  upper.server.close();

  assert.equal(upper.received.size, 12);
  for (const [seq, digest] of expected) assert.equal(upper.received.get(seq), digest);
});

test('a non-retryable 4xx stops the retry loop instead of spinning', async () => {
  const upper = makeUpper({ failRate: 1.0, failStatus: 400 });
  const port = await listen(upper.server);
  const client = new UplinkClient({
    endpoint: `http://127.0.0.1:${port}/x`, baseDelayMs: 1, maxRetries: 5,
  });
  const frame = await FrameCodec.encode({ seq: 1n, payload: tauPayload(64), shape: [64] });
  const res = await client.send(frame);
  upper.server.close();
  assert.equal(res.ok, false);
  assert.equal(res.retryable, false);
  assert.equal(upper.stats().requests, 1, '400 must not be retried');
});

test('429 and 5xx ARE retried', async () => {
  for (const status of [429, 503]) {
    const upper = makeUpper({ failRate: 1.0, failStatus: status });
    const port = await listen(upper.server);
    const client = new UplinkClient({
      endpoint: `http://127.0.0.1:${port}/x`, baseDelayMs: 1, maxDelayMs: 4, maxRetries: 3,
    });
    const frame = await FrameCodec.encode({ seq: 1n, payload: tauPayload(64), shape: [64] });
    await client.send(frame);
    upper.server.close();
    assert.equal(upper.stats().requests, 4, `${status} should be attempted 1+3 times`);
  }
});

test('spool cap with onFull=drop-oldest COUNTS every drop', async () => {
  const dir = await tmp('full');
  const daemon = new SyncDaemon({
    endpoint: 'http://127.0.0.1:9/x',
    spoolDir: dir,
    spoolMaxBytes: 40 * 1024,       // deliberately tiny
    onFull: 'drop-oldest',
    clientOptions: { baseDelayMs: 1, maxRetries: 0, timeoutMs: 100 },
  });
  await daemon.spool.open();
  daemon.running = true;
  let dropEvents = 0;
  daemon.on('dropped', () => dropEvents++);
  for (let i = 0; i < 60; i++) {
    await daemon.submit({ payload: tauPayload(1024, i), shape: [1024] });
  }
  await daemon.spool.close();
  const st = daemon.stats();
  assert.ok(st.framesDropped > 0, 'the cap must actually have been hit');
  assert.equal(st.framesDropped, dropEvents, 'every drop must be both counted AND announced');
});
