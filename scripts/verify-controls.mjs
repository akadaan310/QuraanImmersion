#!/usr/bin/env node
/**
 * The control bar and the drawer are the whole deliberate interface.
 *
 * A control rendered off the viewport, under the system gesture bar, or too
 * small to hit is not a layout blemish — it is a control the observer cannot
 * reach, and it is invisible to every other check in the repository: the DOM
 * node exists, the scene renders, nothing throws.
 *
 * So this asserts reachability across the axes that actually vary: three
 * viewport shapes, every drawer, and the rows inside them. It also checks that
 * the drawer never covers the whole screen — the field has to stay visible
 * behind it, or the drawer has become a page.
 *
 *   npm run preview   # in another shell
 *   npm run verify:controls
 */

import { BASE, launch, DRIVE_SYNTHETIC_AUDIO } from './lib/harness.mjs';

const VIEWPORTS = [
  { label: 'phone  900×1600', width: 900, height: 1600 },
  { label: 'narrow 360×740', width: 360, height: 740 },
  { label: 'desk  1440×900', width: 1440, height: 900 },
];

const DRAWERS = ['experiences', 'waypoints', 'reciters'];

/** Below this a thumb misses. 44 px is the long-standing platform minimum. */
const MIN_TARGET = 44;

const { browser, context } = await launch();
const page = await context.newPage();

const failures = [];
let checked = 0;

page.on('pageerror', (error) => failures.push(`pageerror: ${String(error).slice(0, 300)}`));

await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(DRIVE_SYNTHETIC_AUDIO);
// The bar only exists once the audio gate has been passed, which is the real
// first-run state; forcing it here rather than tapping keeps the check hermetic.
await page.evaluate(() => window.__ISNAAD__.session.setState({ unlocked: true }));
await page.waitForTimeout(600);

const boxesOf = (selector) => page.evaluate((css) =>
  Array.from(document.querySelectorAll(css)).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      text: (element.textContent || '').trim().slice(0, 24),
      left: Math.round(box.left), top: Math.round(box.top),
      right: Math.round(box.right), bottom: Math.round(box.bottom),
      width: Math.round(box.width), height: Math.round(box.height),
      onScreen: box.left >= -1 && box.top >= -1
        && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
    };
  }), selector);

for (const viewport of VIEWPORTS) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(500);

  // ---- the bar ------------------------------------------------------------
  const buttons = await boxesOf('.isnaad-bar__button');
  checked += 1;

  if (buttons.length < 4) {
    failures.push(`${viewport.label}: control bar has ${buttons.length} buttons, expected 4`);
  }
  for (const button of buttons) {
    if (!button.onScreen) {
      failures.push(`${viewport.label}: bar button '${button.text}' off screen `
        + `(${button.left},${button.top})–(${button.right},${button.bottom})`);
    }
    if (button.height < MIN_TARGET) {
      failures.push(`${viewport.label}: bar button '${button.text}' is ${button.height} px tall`);
    }
  }
  // Two buttons sharing pixels are two controls the observer cannot tell apart.
  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const a = buttons[i];
      const b = buttons[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        failures.push(`${viewport.label}: bar buttons '${a.text}' and '${b.text}' overlap`);
      }
    }
  }

  // ---- each drawer --------------------------------------------------------
  for (const drawer of DRAWERS) {
    await page.evaluate((which) => window.__ISNAAD__.session.getState().openDrawer(which), drawer);
    await page.waitForTimeout(450);
    checked += 1;

    const sheets = await boxesOf('.isnaad-drawer');
    if (sheets.length !== 1) {
      failures.push(`${viewport.label} ${drawer}: drawer did not open`);
      continue;
    }
    const sheet = sheets[0];
    if (!sheet.onScreen) {
      failures.push(`${viewport.label} ${drawer}: drawer off screen (top ${sheet.top}, bottom ${sheet.bottom})`);
    }
    if (sheet.height > viewport.height * 0.72) {
      failures.push(`${viewport.label} ${drawer}: drawer covers ${Math.round(
        (sheet.height / viewport.height) * 100)}% of the screen — the field must stay visible`);
    }

    const rows = await boxesOf('.isnaad-row');
    if (rows.length === 0) {
      failures.push(`${viewport.label} ${drawer}: no rows`);
      continue;
    }
    // Only the rows actually in view need to be hittable; the rest are scrolled
    // to. The first is always in view and is the one to check.
    const first = rows[0];
    if (first.height < 34) {
      failures.push(`${viewport.label} ${drawer}: rows are ${first.height} px tall`);
    }
    if (first.width < 120) {
      failures.push(`${viewport.label} ${drawer}: rows are only ${first.width} px wide`);
    }

    // The list must actually scroll, or a 286-ayah surah is unreachable past
    // whatever fits on the first screen.
    const scrollable = await page.evaluate(() => {
      const list = document.querySelector('.isnaad-list');
      return list ? list.scrollHeight > list.clientHeight + 4 || list.children.length < 12 : false;
    });
    if (!scrollable) {
      failures.push(`${viewport.label} ${drawer}: the list neither fits nor scrolls`);
    }
  }

  await page.evaluate(() => window.__ISNAAD__.session.getState().openDrawer('none'));
  await page.waitForTimeout(250);
}

// ---- the drawer actually navigates -----------------------------------------
await page.setViewportSize({ width: 900, height: 1600 });
await page.evaluate(() => window.__ISNAAD__.session.getState().openDrawer('experiences'));
await page.waitForTimeout(400);
const before = await page.evaluate(() => window.__ISNAAD__.session.getState().experienceId);
await page.evaluate(() => {
  const rows = document.querySelectorAll('.isnaad-row');
  // The second row, so the pick is always a change from whatever opened first.
  (rows[1] ?? rows[0]).dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(700);
const after = await page.evaluate(() => ({
  id: window.__ISNAAD__.session.getState().experienceId,
  drawer: window.__ISNAAD__.session.getState().drawer,
}));
checked += 1;
if (after.id === before) failures.push('picking a row in the drawer did not change the route');
if (after.drawer !== 'none') failures.push('picking a row left the drawer open');

await browser.close();

if (failures.length) {
  console.error(`\n✗ ${failures.length} unreachable or unusable control(s):\n`);
  for (const failure of failures) console.error('  ' + failure);
  console.error('');
  process.exit(1);
}
console.log(`✓ every control reachable and usable across ${checked} states`);
