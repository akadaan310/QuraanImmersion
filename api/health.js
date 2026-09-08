/**
 * api/health.js — liveness and protocol advertisement for SANDBOX-UPPER.
 *
 * The daemon can call this on startup to confirm the far end speaks its wire
 * version before it begins spooling, which turns a silent protocol mismatch
 * into an immediate, legible failure.
 */
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'tri-reality-os/sandbox-upper',
    protocol: 1,
    dtypes: ['float64', 'float32', 'uint8'],
    maxFrameBytes: 8 * 1024 * 1024,
    features: { deflate: true, byteShuffle: true, crc32: true },
    dedupe: process.env.TRO_DURABLE_STORE ? 'durable' : 'warm',
    node: process.version,
    now: new Date().toISOString(),
  });
}
