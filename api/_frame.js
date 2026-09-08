/**
 * frame.js — SANDBOX-UPPER decoder for the TRO1 wire protocol.
 *
 * This is the SECOND implementation of the protocol described in
 * sandbox-lower/upper_sync_daemon.js Sec. 1. Two implementations of one wire
 * format is a standing invitation to drift, so it is not left to discipline:
 * tests/test_protocol_conformance.mjs encodes with the client and decodes with
 * THIS module (and vice versa) on randomized frames, and fails the build if the
 * two ever disagree. The duplication is deliberate -- SANDBOX-UPPER deploys
 * from its own root and must not reach into the Termux tree -- but it is
 * duplication under test, not duplication on trust.
 */

import zlib from 'node:zlib';
import { promisify } from 'node:util';

const inflate = promisify(zlib.inflateRaw);

export const MAGIC = Buffer.from('TRO1', 'ascii');
export const VERSION = 1;
export const HEADER_BASE = 44;
export const DTYPE_WIDTH = { 0: 8, 1: 4, 2: 1 };
export const FLAG_COMPRESSED = 1 << 0;
export const FLAG_SHUFFLED = 1 << 1;

export const crc32 = typeof zlib.crc32 === 'function'
  ? (buf) => zlib.crc32(buf) >>> 0
  : (() => {
      const T = new Int32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        T[i] = c;
      }
      return (buf) => {
        let c = -1;
        for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ -1) >>> 0;
      };
    })();

/** Inverse of the client's byte shuffle (daemon Sec. 2). */
export function unshuffle(buf, elementSize) {
  if (elementSize <= 1) return buf;
  const n = Math.floor(buf.length / elementSize);
  const tail = buf.length - n * elementSize;
  const out = Buffer.allocUnsafe(buf.length);
  let r = 0;
  for (let b = 0; b < elementSize; b++) {
    for (let i = 0; i < n; i++) out[i * elementSize + b] = buf[r++];
  }
  if (tail) buf.copy(out, n * elementSize, r);
  return out;
}

export async function decodeFrame(frame) {
  if (frame.length < HEADER_BASE) throw new Error('frame shorter than header');
  if (!frame.subarray(0, 4).equals(MAGIC)) throw new Error('bad magic');

  const version = frame.readUInt8(4);
  if (version !== VERSION) throw new Error(`unsupported version ${version}`);

  const flags = frame.readUInt8(5);
  const dtype = frame.readUInt8(6);
  const ndim = frame.readUInt8(7);
  if (!(dtype in DTYPE_WIDTH)) throw new Error(`unknown dtype ${dtype}`);

  const headerLen = HEADER_BASE + 4 * ndim;
  if (frame.length < headerLen) throw new Error('frame truncated in shape table');

  const seq = frame.readBigUInt64LE(8);
  const lambda = frame.readDoubleLE(16);
  const tGlobal = frame.readDoubleLE(24);
  const nSteps = frame.readUInt32LE(32);
  const checksum = frame.readUInt32LE(36);
  const payloadLen = frame.readUInt32LE(40);

  const shape = [];
  for (let i = 0; i < ndim; i++) shape.push(frame.readUInt32LE(HEADER_BASE + 4 * i));

  if (frame.length !== headerLen + payloadLen) {
    throw new Error(`frame length ${frame.length} != ${headerLen} + ${payloadLen}`);
  }

  let payload = frame.subarray(headerLen);
  if (flags & FLAG_COMPRESSED) payload = await inflate(payload);
  if (flags & FLAG_SHUFFLED) payload = unshuffle(payload, DTYPE_WIDTH[dtype]);

  const actual = crc32(payload);
  if (actual !== checksum) {
    throw new Error(`CRC mismatch: ${actual.toString(16)} != ${checksum.toString(16)}`);
  }
  const expected = shape.reduce((a, b) => a * b, 1) * DTYPE_WIDTH[dtype];
  if (payload.length !== expected) {
    throw new Error(`payload ${payload.length} B != shape-implied ${expected} B`);
  }
  return { seq, lambda, tGlobal, nSteps, dtype, shape, payload, flags };
}

/**
 * Summarize a tau frame without materializing exp(log_tau).
 *
 * The payload carries ln(tau), for the reason set out in dilation_registry.py
 * Sec. 0: tau itself overflows float64 in the super-critical core. So this
 * reduces in LOG space -- max, min, and a log-sum-exp total -- and never calls
 * Math.exp on a value it has not bounded. A naive `.reduce((a,b)=>a+Math.exp(b))`
 * here would return Infinity for any phase-C frame and silently poison the
 * stored telemetry.
 */
export function summarizeLogTau(payload) {
  const view = new Float64Array(payload.buffer, payload.byteOffset, payload.length / 8);
  let max = -Infinity, min = Infinity, finite = 0, atZero = 0;
  for (let i = 0; i < view.length; i++) {
    const v = view[i];
    // ln(tau) = -Infinity means tau = 0 exactly. That is true of a clock the
    // collapse phase STOPPED and equally of one that has not started yet, and
    // the frame carries no rate array to tell them apart — so this counts
    // "reading zero" and claims nothing more. The sender knows which is which;
    // this endpoint does not, and says so rather than guessing.
    if (v === -Infinity) { atZero++; continue; }
    if (!Number.isFinite(v)) continue;
    finite++;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  // log-sum-exp: ln(sum tau_i) computed without ever forming tau_i.
  let logSum = -Infinity;
  if (finite > 0) {
    let acc = 0;
    for (let i = 0; i < view.length; i++) {
      const v = view[i];
      if (Number.isFinite(v)) acc += Math.exp(v - max);
    }
    logSum = max + Math.log(acc);
  }
  return {
    count: view.length,
    finite,
    atZero,
    logTauMax: max === -Infinity ? null : max,
    logTauMin: min === Infinity ? null : min,
    logTauSum: logSum === -Infinity ? null : logSum,
    // The honest headline: how far past float64 the core clock has run.
    exceedsFloat64: max > 709.782712893384,
  };
}
