#!/usr/bin/env node
/**
 * Renders every route and all twenty phenomena in a real WebGL context and fails
 * on any shader compile error, runtime error, or scene that rasterises nothing.
 *
 * TypeScript cannot check GLSL, so this is the only thing standing between a
 * typo in a shader and a blank viewport.
 *
 *   npm run preview   # in another shell (or point VERIFY_BASE at a running app)
 *   npm run verify:scenes
 */

import { PNG } from 'pngjs';
import { BASE, PHENOMENON_SLUGS, launch, DRIVE_SYNTHETIC_AUDIO } from './lib/harness.mjs';

/** Central band of the viewport, clear of every HUD panel. */
const CLIP = { x: 420, y: 150, width: 440, height: 340 };
const MIN_COVERAGE = 0.01;

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

async function visit(label, path, settle = 1500) {
  current = label;
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(settle);
}

// Confirm a real WebGL context exists, or "no errors" would prove nothing.
await visit('boot', '/');
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

for (const [label, path] of [
  ['onboarding', '/onboarding'],
  ['engine/spatial', '/engine/spatial'],
  ['engine/isnaad', '/engine/isnaad'],
]) {
  await visit(label, path);
}

let dark = 0;
for (const slug of PHENOMENON_SLUGS) {
  await visit(`experiences/${slug}`, `/experiences/${slug}`, 400);
  await page.evaluate(DRIVE_SYNTHETIC_AUDIO);
  await page.waitForTimeout(2200);

  const png = PNG.sync.read(await page.screenshot({ clip: CLIP }));
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    // The vacuum background is #030712; anything brighter was drawn by the scene.
    if (png.data[i] > 12 || png.data[i + 1] > 18 || png.data[i + 2] > 32) lit += 1;
  }
  const coverage = lit / (png.width * png.height);
  const ok = coverage > MIN_COVERAGE;
  if (!ok) dark += 1;
  console.log(`${ok ? '✓' : '✗'} ${slug.padEnd(20)} ${(coverage * 100).toFixed(1).padStart(5)}% drawn`);
}

await browser.close();

if (problems.length) {
  console.error(`\n✗ ${problems.length} shader or runtime problem(s):\n`);
  for (const problem of problems) console.error('  ' + problem + '\n');
}
if (dark) console.error(`\n✗ ${dark} scene(s) rendered nothing`);

if (problems.length || dark) process.exit(1);
console.log(`\n✓ ${PHENOMENON_SLUGS.length} scenes and 4 routes rendered cleanly`);
