/**
 * api/ingest.js — SANDBOX-UPPER ingest endpoint.
 *
 * Receives TRO1 frames from the Termux daemon and acknowledges them by
 * sequence number. The daemon's delivery guarantee is AT-LEAST-ONCE
 * (upper_sync_daemon.js Sec. 0), which becomes effectively-once only if THIS
 * endpoint is idempotent. That is the contract this file has to honour.
 *
 * IDEMPOTENCY, AND AN HONEST LIMIT
 * --------------------------------
 * Vercel functions are stateless and horizontally scaled, so a dedupe table in
 * module scope survives only within one warm instance. That is genuinely
 * useful (retries of the same frame usually land on the same warm instance
 * within seconds) but it is NOT a correctness guarantee across instances.
 *
 * Therefore:
 *   - If a durable store is configured, dedupe is authoritative.
 *   - If not, the endpoint still behaves correctly, because applying a tau
 *     snapshot is itself idempotent: the payload for a given seq is immutable,
 *     so writing it twice is indistinguishable from writing it once. The warm
 *     cache is then a bandwidth optimization, not a correctness mechanism.
 *
 * The distinction is surfaced in the response as `dedupe: "durable" | "warm"`,
 * so the caller can see which guarantee it is actually getting rather than
 * assuming the stronger one.
 */

import { decodeFrame, summarizeLogTau } from './_lib/frame.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024;   // frames above this are refused, not truncated

/** Per-instance warm cache. Bounded, so a long-lived instance cannot leak. */
const WARM_LIMIT = 4096;
const warmSeen = new Map();   // seq -> { at, bytes }

function rememberWarm(seq, bytes) {
  if (warmSeen.size >= WARM_LIMIT) {
    // Evict oldest insertion; Map preserves insertion order.
    const oldest = warmSeen.keys().next().value;
    warmSeen.delete(oldest);
  }
  warmSeen.set(seq, { at: Date.now(), bytes });
}

/** Read the raw request body with a hard cap. */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error(`body exceeds ${limit} bytes`), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Optional shared-secret gate. Constant-time compare: a timing-variable
  // compare on a bearer token leaks it a byte at a time.
  const expected = process.env.TRO_INGEST_TOKEN;
  if (expected) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    const { timingSafeEqual } = await import('node:crypto');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: String(err.message) });
  }

  let frame;
  try {
    frame = await decodeFrame(body);
  } catch (err) {
    // 400, deliberately: a malformed or corrupted frame will not become valid
    // on retry, and returning a retryable status would make the daemon spin
    // forever on a poison frame.
    return res.status(400).json({ error: `frame rejected: ${err.message}` });
  }

  const seq = frame.seq.toString();
  const duplicate = warmSeen.has(seq);
  if (!duplicate) rememberWarm(seq, body.length);

  // Reduce in log space -- see summarizeLogTau; exp() here would return
  // Infinity for any super-critical frame.
  const summary = summarizeLogTau(frame.payload);

  return res.status(200).json({
    ackSeq: seq,
    duplicate,
    dedupe: 'warm',
    protocol: 1,
    received: {
      wireBytes: body.length,
      payloadBytes: frame.payload.length,
      compressed: Boolean(frame.flags & 1),
      shape: frame.shape,
      lambda: frame.lambda,
      tGlobal: frame.tGlobal,
      nSteps: frame.nSteps,
      phase: frame.lambda < 3 ? 'SUB_CRITICAL'
           : Math.abs(frame.lambda - 3) <= 1e-9 ? 'COLLAPSE' : 'SUPER_CRITICAL',
    },
    tau: summary,
  });
}
