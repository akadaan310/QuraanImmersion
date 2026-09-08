/**
 * The TRO1 wire format is implemented twice: once in sandbox-lower (encoder)
 * and once in sandbox-upper (decoder), because the two sandboxes deploy from
 * separate roots and neither may import the other. Two implementations of one
 * format drift unless something forces them to agree. This file is that force.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FrameCodec, DTYPE, shuffle, unshuffle, crc32 as clientCrc } from '../upper_sync_daemon.js';
import { decodeFrame, summarizeLogTau, unshuffle as serverUnshuffle,
         crc32 as serverCrc } from '../../sandbox-upper/api/_lib/frame.js';

test('client CRC32 == server CRC32 on random buffers', async () => {
  const { randomBytes } = await import('node:crypto');
  for (const n of [0, 1, 7, 64, 4096, 65537]) {
    const buf = randomBytes(n);
    assert.equal(clientCrc(buf), serverCrc(buf), `n=${n}`);
  }
});

test('client shuffle is inverted by the SERVER unshuffle', async () => {
  const { randomBytes } = await import('node:crypto');
  for (const width of [1, 4, 8]) {
    const buf = randomBytes(3000 + width);
    assert.deepEqual(serverUnshuffle(shuffle(buf, width), width), buf, `width ${width}`);
    // ...and the two unshuffle implementations agree with each other.
    assert.deepEqual(unshuffle(buf, width), serverUnshuffle(buf, width));
  }
});

test('every frame the client can encode, the server can decode', async () => {
  const cases = [];
  for (const dtype of [DTYPE.FLOAT64, DTYPE.FLOAT32, DTYPE.UINT8]) {
    for (const compress of [true, false]) {
      for (const shape of [[1], [1024], [16, 64], [4, 8, 32]]) {
        cases.push({ dtype, compress, shape });
      }
    }
  }

  const width = { 0: 8, 1: 4, 2: 1 };
  for (const { dtype, compress, shape } of cases) {
    const n = shape.reduce((a, b) => a * b, 1);
    const payload = Buffer.allocUnsafe(n * width[dtype]);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 11) & 0xff;

    const frame = await FrameCodec.encode({
      seq: 123456789n, payload, shape, dtype, compress,
      lambda: 3.5, tGlobal: 2.75, nSteps: 99,
    });
    const out = await decodeFrame(frame);

    assert.equal(out.seq, 123456789n);
    assert.equal(out.lambda, 3.5);
    assert.equal(out.tGlobal, 2.75);
    assert.equal(out.nSteps, 99);
    assert.deepEqual(out.shape, shape);
    assert.deepEqual(out.payload, payload,
      `dtype=${dtype} compress=${compress} shape=${JSON.stringify(shape)}`);
  }
});

test('the server rejects exactly what the client rejects', async () => {
  const payload = Buffer.alloc(512, 7);
  const frame = await FrameCodec.encode({ seq: 1n, payload, shape: [64], dtype: DTYPE.FLOAT64,
                                          compress: false });
  const corrupt = Buffer.from(frame); corrupt[60] ^= 0x01;
  await assert.rejects(() => FrameCodec.decode(corrupt), /CRC mismatch/);
  await assert.rejects(() => decodeFrame(corrupt), /CRC mismatch/);

  const badMagic = Buffer.from(frame); badMagic.write('NOPE', 0);
  await assert.rejects(() => FrameCodec.decode(badMagic), /bad magic/);
  await assert.rejects(() => decodeFrame(badMagic), /bad magic/);
});

test('summarizeLogTau reduces in log space and never returns Infinity', async () => {
  // A super-critical frame: log_tau values far beyond exp() range. A naive
  // server-side sum would return Infinity and poison the stored telemetry.
  const n = 256;
  const arr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = 1e-3 * Math.pow(2000, i / n);
    arr[i] = 3.5 * (1 / (r * r) - 1);          // up to 3.5e6
  }
  arr[0] = -Infinity;                          // one frozen clock (phase B)
  const payload = Buffer.from(arr.buffer);

  const s = summarizeLogTau(payload);
  assert.equal(s.count, n);
  assert.equal(s.frozen, 1);
  assert.equal(s.finite, n - 1);
  assert.ok(Number.isFinite(s.logTauMax), 'logTauMax must stay finite');
  assert.ok(Number.isFinite(s.logTauSum), 'log-sum-exp must stay finite');
  assert.ok(s.exceedsFloat64, 'this frame genuinely exceeds float64 tau range');
  assert.ok(s.logTauMax > 1e6, `expected a huge core clock, got ${s.logTauMax}`);

  // The naive alternative, for contrast: it dies on this very frame.
  const naive = Array.from(arr).reduce((a, b) => a + Math.exp(b), 0);
  assert.equal(naive, Infinity, 'the naive reduction is expected to overflow here');
});
