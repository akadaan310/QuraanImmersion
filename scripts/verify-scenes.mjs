#!/usr/bin/env node
/**
 * Renders all twenty phenomena in a real WebGL context and fails on any shader
 * compile error, runtime error, or scene that does not visibly draw.
 *
 * TypeScript cannot check GLSL, so this is the only thing standing between a
 * typo in a shader and a blank viewport.
 *
 * HOW IT REACHES A SCENE NOW
 * --------------------------
 * There are no routes. The application is one continuous journey and a
 * phenomenon is a station along it, so the harness stands the journey at each
 * one in turn (`pinPhenomenon`) and adopts إسناد الصوت والربط — the standpoint
 * inside the station — so the frame is a picture of the scene and not of the
 * Earth behind it.
 *
 * WHAT EACH CHECK CAN AND CANNOT CATCH
 * ------------------------------------
 *   errors        A shader that fails to compile, or a scene that throws. This
 *                 is the strong check and the reason the script exists.
 *   coverage      That something was rasterised. The Earth and the star field
 *                 are also in frame, so this cannot prove the STATION drew —
 *                 which is why the third check exists.
 *   distinctness  Every scene's frame signature must differ from every other's.
 *                 Two scenes that rendered nothing would both collapse to the
 *                 same background and collide here, which coverage alone would
 *                 not notice.
 *
 *   npm run preview   # in another shell (or point VERIFY_BASE at a running app)
 *   npm run verify:scenes
 */

import { PNG } from 'pngjs';
import { BASE, PHENOMENON_SLUGS, launch, DRIVE_SYNTHETIC_AUDIO, STAND_AT } from './lib/harness.mjs';

/** Central band of the viewport, clear of the readout and the orientation trail. */
const CLIP = { x: 420, y: 170, width: 440, height: 380 };
const MIN_COVERAGE = 0.02;
/** Two signatures closer than this in mean channel distance are "the same frame". */
const SIGNATURE_EPSILON = 1.5;

const { browser, context } = await launch();
const page = await context.newPage();

const problems = [];
let current = '(startup)';

page.on('console', (message) => {
  const text = message.text();
  if (message.type() !== 'error' && !/shader|GLSL|WebGLProgram/i.test(text)) return;
  // Upstream CDN failures are an environment condition, not a defect here.
  if (/net::ERR|Failed to load resource|Failed to fetch/i.test(text)) return;
  problems.push(`[${current}] console.${message.type()}: ${text.slice(0, 600)}`);
});
page.on('pageerror', (error) => problems.push(`[${current}] pageerror: ${String(error).slice(0, 600)}`));

// Confirm a real WebGL context exists, or "no errors" would prove nothing.
current = 'boot';
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2000);

const gl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  return context ? context.getParameter(context.VERSION) : null;
});
if (!gl) {
  console.error('✗ no WebGL context available — scene verification cannot run here');
  await browser.close();
  process.exit(2);
}
console.log(`context: ${gl}\n`);

await page.evaluate(DRIVE_SYNTHETIC_AUDIO);

/** An 8×8 grid of mean channel values — coarse enough to ignore noise, fine
 *  enough that two different scenes never collide by accident. */
function signature(png) {
  const CELLS = 8;
  const sums = new Float64Array(CELLS * CELLS * 3);
  const counts = new Float64Array(CELLS * CELLS);
  for (let y = 0; y < png.height; y += 1) {
    const row = Math.min(CELLS - 1, Math.floor((y / png.height) * CELLS));
    for (let x = 0; x < png.width; x += 1) {
      const column = Math.min(CELLS - 1, Math.floor((x / png.width) * CELLS));
      const cell = row * CELLS + column;
      const at = (y * png.width + x) * 4;
      sums[cell * 3] += png.data[at];
      sums[cell * 3 + 1] += png.data[at + 1];
      sums[cell * 3 + 2] += png.data[at + 2];
      counts[cell] += 1;
    }
  }
  return Array.from(sums, (sum, index) => sum / counts[Math.floor(index / 3)]);
}

function distance(a, b) {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index] - b[index]);
  return total / a.length;
}

const signatures = [];
let dark = 0;

for (const slug of PHENOMENON_SLUGS) {
  current = slug;
  await page.evaluate(STAND_AT, slug);
  // The rig approaches rather than snaps, so the camera needs time to settle at
  // the new standpoint before the frame means anything.
  await page.waitForTimeout(2400);

  const png = PNG.sync.read(await page.screenshot({ clip: CLIP }));
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    // The vacuum background is #01030a; anything brighter was drawn.
    if (png.data[i] > 10 || png.data[i + 1] > 14 || png.data[i + 2] > 26) lit += 1;
  }
  const coverage = lit / (png.width * png.height);
  const ok = coverage > MIN_COVERAGE;
  if (!ok) dark += 1;

  signatures.push({ slug, signature: signature(png) });
  console.log(`${ok ? '✓' : '✗'} ${slug.padEnd(20)} ${(coverage * 100).toFixed(1).padStart(5)}% drawn`);
}

await browser.close();

// Distinctness. A pair that collides means at least one of the two did not draw
// what makes it itself.
const collisions = [];
for (let i = 0; i < signatures.length; i += 1) {
  for (let j = i + 1; j < signatures.length; j += 1) {
    const apart = distance(signatures[i].signature, signatures[j].signature);
    if (apart < SIGNATURE_EPSILON) {
      collisions.push(`${signatures[i].slug} ≡ ${signatures[j].slug}  (${apart.toFixed(2)})`);
    }
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} shader or runtime problem(s):\n`);
  for (const problem of problems) console.error('  ' + problem + '\n');
}
if (dark) console.error(`\n✗ ${dark} scene(s) rendered nothing`);
if (collisions.length) {
  console.error(`\n✗ ${collisions.length} scene pair(s) rendered the same frame:\n`);
  for (const collision of collisions) console.error('  ' + collision);
}

if (problems.length || dark || collisions.length) process.exit(1);
console.log(`\n✓ ${PHENOMENON_SLUGS.length} scenes rendered cleanly and distinctly`);
