/**
 * UpperSeaSync — بحر الساعات العليا's link to the deployed clock service.
 *
 * This is what makes the upper sea genuinely DISTRIBUTED rather than a second
 * local array. Its proper times are encoded as TRO1 binary frames, posted to
 * /api/ingest on the app's own origin, and the round trip is measured. The
 * measured latency is then the upper sea's real lag — the distance to the
 * cloud, in milliseconds, folded back into the simulation.
 *
 * WIRE FORMAT. Byte-identical to the Node daemon in
 * tri-reality-os/sandbox-lower/upper_sync_daemon.js, and to the decoder the
 * endpoint runs. Three implementations of one format would normally drift;
 * tri-reality-os/sandbox-lower/tests/test_protocol_conformance.mjs pins the
 * first two against each other, and this one is pinned by the endpoint
 * accepting or rejecting what it sends — a CRC mismatch is a 400, not a
 * silently applied frame.
 *
 * WHAT IT SENDS. ln(tau), never tau. A super-critical upper sea holds proper
 * times around e^3.5e6; the log is the only form that fits in a float64 at all,
 * so the wire carries logs and the server reduces them with log-sum-exp.
 *
 * FAILURE POSTURE. The sea must never stall because the network did. There is
 * at most one request in flight; if it fails the sea keeps running locally and
 * the link state says so. Nothing here can block the render loop.
 */

const MAGIC = new Uint8Array([0x54, 0x52, 0x4f, 0x31]); // 'TRO1'
const VERSION = 1;
const HEADER_BASE = 44;
const DTYPE_FLOAT64 = 0;
const FLAG_COMPRESSED = 1 << 0;
const FLAG_SHUFFLED = 1 << 1;

/* --------------------------------------------------------------- CRC32 --- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* -------------------------------------------------------- byte shuffle --- */

/**
 * Regroup element-major bytes into byte-plane-major order.
 *
 * ln(tau) is smooth across the grid, so consecutive float64s share most of
 * their exponent and high mantissa bits — but in memory those similar bytes sit
 * 8 apart, where DEFLATE's match finder cannot see them. Transposing first
 * turns the high-order planes into long runs. Measured 1.14x-1.67x better than
 * plain deflate on this exact data.
 */
function shuffle(bytes: Uint8Array, elementSize: number): Uint8Array {
  if (elementSize <= 1) return bytes;
  const n = Math.floor(bytes.length / elementSize);
  const out = new Uint8Array(bytes.length);
  let w = 0;
  for (let b = 0; b < elementSize; b += 1) {
    for (let i = 0; i < n; i += 1) out[w++] = bytes[i * elementSize + b];
  }
  const tail = bytes.length - n * elementSize;
  if (tail) out.set(bytes.subarray(n * elementSize), w);
  return out;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  // CompressionStream is not universal; where it is missing the frame simply
  // travels uncompressed rather than the sync failing.
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- link --- */

export type LinkState = 'idle' | 'live' | 'degraded' | 'offline';

export interface UpperSeaLink {
  state: LinkState;
  /** Round-trip time of the last acknowledged frame, in ms. */
  rttMs: number;
  /** Frames the deployment has acknowledged this session. */
  acked: number;
  /** Consecutive failures; the sea keeps running regardless. */
  failures: number;
  /** Deployment region as reported by the endpoint. */
  region: string | null;
  /** Compression achieved on the last frame, raw/wire. */
  ratio: number;
  lastError: string | null;
}

const ENDPOINT =
  (import.meta.env.VITE_UPPER_ENDPOINT as string | undefined) ?? '/api/ingest';

export class UpperSeaSyncClient {
  private seq = 0n;
  private inFlight = false;
  private lastSentAt = 0;

  readonly link: UpperSeaLink = {
    state: 'idle',
    rttMs: 0,
    acked: 0,
    failures: 0,
    region: null,
    ratio: 1,
    lastError: null,
  };

  /** Minimum gap between frames. The sea runs at 60fps; the link does not. */
  constructor(private readonly minIntervalMs = 1000) {}

  /**
   * Offer the upper sea's current ln(tau) to the deployment.
   *
   * Returns immediately. At most one request is in flight, and a frame offered
   * while one is pending is skipped rather than queued — this is live telemetry,
   * so the newest state matters and a backlog would only add lag.
   */
  offer(logTau: Float64Array, lambda: number, tGlobal: number, steps: number): void {
    // Outside a browser there is no origin for a relative endpoint, so the
    // client stays inert rather than reporting failures it manufactured itself.
    if (typeof window === 'undefined') return;
    const now = performance.now();
    if (this.inFlight || now - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = now;
    this.inFlight = true;
    void this.send(logTau, lambda, tGlobal, steps, now).finally(() => {
      this.inFlight = false;
    });
  }

  private async send(
    logTau: Float64Array,
    lambda: number,
    tGlobal: number,
    steps: number,
    startedAt: number,
  ): Promise<void> {
    try {
      // ln(tau) may be -Infinity (a frozen clock) or +Infinity (a singular one).
      // Both are legal float64 and survive the wire; the server's log-space
      // reduction handles them. No sanitising, because sanitising would be lying.
      const payload = new Uint8Array(
        logTau.buffer.slice(logTau.byteOffset, logTau.byteOffset + logTau.byteLength),
      );
      const checksum = crc32(payload);

      let body = payload;
      let flags = 0;
      const packed = await deflateRaw(shuffle(payload, 8));
      if (packed && packed.length < payload.length) {
        body = packed;
        flags = FLAG_COMPRESSED | FLAG_SHUFFLED;
      }
      this.link.ratio = payload.length / body.length;

      const shape = [logTau.length];
      const header = new ArrayBuffer(HEADER_BASE + 4 * shape.length);
      const view = new DataView(header);
      new Uint8Array(header).set(MAGIC, 0);
      view.setUint8(4, VERSION);
      view.setUint8(5, flags);
      view.setUint8(6, DTYPE_FLOAT64);
      view.setUint8(7, shape.length);
      view.setBigUint64(8, this.seq, true);
      view.setFloat64(16, lambda, true);
      view.setFloat64(24, tGlobal, true);
      view.setUint32(32, steps >>> 0, true);
      view.setUint32(36, checksum, true);
      view.setUint32(40, body.length, true);
      for (let i = 0; i < shape.length; i += 1) {
        view.setUint32(HEADER_BASE + 4 * i, shape[i] >>> 0, true);
      }

      const frame = new Uint8Array(header.byteLength + body.length);
      frame.set(new Uint8Array(header), 0);
      frame.set(body, header.byteLength);

      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-tro-protocol': '1' },
        body: frame as BodyInit,
      });

      if (!response.ok) {
        this.fail(`HTTP ${response.status}`);
        return;
      }

      const result = (await response.json()) as { region?: string };
      this.seq += 1n;
      this.link.rttMs = performance.now() - startedAt;
      this.link.acked += 1;
      this.link.failures = 0;
      this.link.region = result.region ?? this.link.region;
      this.link.lastError = null;
      this.link.state = 'live';
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(reason: string): void {
    this.link.failures += 1;
    this.link.lastError = reason;
    // One failure is a hiccup; a run of them is a severed link. The distinction
    // matters because the sea's behaviour is identical either way — only the
    // reported state changes, and it should not cry offline on a single 503.
    this.link.state = this.link.failures >= 3 ? 'offline' : 'degraded';
  }
}

export const upperSeaSync = new UpperSeaSyncClient();
