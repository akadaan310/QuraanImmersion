#!/usr/bin/env node
/**
 * The orientation markers are the entire input surface of the application.
 *
 * There is no menu, no transport and no route. If a marker renders outside the
 * viewport it is not a layout blemish — it is a control the observer cannot
 * reach, on an interface that has no other way to do the same thing. That
 * failure is invisible to every other check in the repository: the DOM node
 * exists, the scene renders, no error is thrown, and the button is simply not
 * on screen.
 *
 * So this asserts the one property that matters, across the axes that were
 * actually observed to break it: every standpoint the rig can adopt, both
 * phases of a leg, and both a portrait phone and a landscape desktop.
 *
 *   npm run preview   # in another shell
 *   npm run verify:orientations
 */

import { BASE, launch, DRIVE_SYNTHETIC_AUDIO } from './lib/harness.mjs';

/** Portrait first: it is the narrower axis and the one the app is for. */
const VIEWPORTS = [
  { label: 'phone  900×1600', width: 900, height: 1600 },
  { label: 'tall   720×1600', width: 720, height: 1600 },
  { label: 'desk  1440×900', width: 1440, height: 900 },
];

const STANDPOINTS = [null, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

/** Both phases of a leg: arriving, and standing. */
const PHASES = [
  { label: 'arrival', progress: 0.46 },
  { label: 'station', progress: 0.85 },
];

const { browser, context } = await launch();
const page = await context.newPage();

const failures = [];
let checked = 0;

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(DRIVE_SYNTHETIC_AUDIO);

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  for (const phase of PHASES) {
    // Pin the leg so the frame is the phase under test rather than whatever the
    // synthetic progress happened to reach.
    await page.evaluate((progress) => {
      const { audioEngine } = window.__ISNAAD__;
      if (!audioEngine.__pinned) {
        const real = audioEngine.analyse.bind(audioEngine);
        audioEngine.__pinned = true;
        audioEngine.analyse = () => {
          const frame = real();
          frame.progress = window.__PINNED_PROGRESS__;
          return frame;
        };
      }
      window.__PINNED_PROGRESS__ = progress;
    }, phase.progress);

    for (const standpoint of STANDPOINTS) {
      await page.evaluate((id) => {
        const session = window.__ISNAAD__.session.getState();
        session.selectVerse(18, 60);
        session.adopt(id);
      }, standpoint);
      // The rig approaches rather than snaps; the markers have to be checked
      // where the camera settles, not where it started.
      await page.waitForTimeout(2600);

      const markers = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.isnaad-orientation')).map((element) => {
          const box = element.getBoundingClientRect();
          return {
            sigil: element.querySelector('.isnaad-orientation__sigil')?.textContent ?? '?',
            left: Math.round(box.left), top: Math.round(box.top),
            right: Math.round(box.right), bottom: Math.round(box.bottom),
            width: Math.round(box.width), height: Math.round(box.height),
            onScreen: box.left >= 0 && box.top >= 0
              && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
            // A tap target under about 40 px on a phone is a missed tap.
            tappable: box.width >= 40 && box.height >= 40,
          };
        }));

      checked += 1;
      const where = `${viewport.label}  ${phase.label}  ${standpoint ?? 'default'}`;

      if (markers.length === 0) {
        failures.push(`${where}: no markers rendered at all`);
        continue;
      }
      for (const marker of markers) {
        if (!marker.onScreen) {
          failures.push(`${where}: '${marker.sigil}' off screen `
            + `(${marker.left},${marker.top})–(${marker.right},${marker.bottom}) `
            + `in ${viewport.width}×${viewport.height}`);
        } else if (!marker.tappable) {
          failures.push(`${where}: '${marker.sigil}' is only ${marker.width}×${marker.height} px`);
        }
      }

      // Overlap: two markers sharing pixels are two controls the observer
      // cannot tell apart, which is the same defect wearing a different hat.
      for (let i = 0; i < markers.length; i += 1) {
        for (let j = i + 1; j < markers.length; j += 1) {
          const a = markers[i];
          const b = markers[j];
          const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          if (overlaps) failures.push(`${where}: '${a.sigil}' and '${b.sigil}' overlap`);
        }
      }
    }
  }
}

await browser.close();

if (failures.length) {
  console.error(`\n✗ ${failures.length} unreachable or unreadable marker(s):\n`);
  for (const failure of failures) console.error('  ' + failure);
  console.error('');
  process.exit(1);
}
console.log(`✓ every orientation marker reachable across ${checked} camera states`);
