#!/usr/bin/env node
/**
 * Enforces the project's hard constraint: no Quranic verse translation may enter
 * the application. This runs in `npm run verify` so a future change that adds a
 * translation endpoint fails the build rather than shipping.
 *
 * It checks three things:
 *   1. No source file requests a translation/tafsir resource.
 *   2. QuranTextService still carries its runtime Latin-text rejection guard.
 *   3. No source file declares a translation-shaped field on verse data.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;

/** Patterns that indicate a translation is being fetched or stored. */
const FORBIDDEN = [
  { pattern: /\/translations?\b/i, why: 'translation resource path' },
  { pattern: /[?&]translations?=/i, why: 'translation query parameter' },
  { pattern: /\btranslation_ids\b/i, why: 'translation ids parameter' },
  { pattern: /\/tafsirs?\b/i, why: 'tafsir resource path' },
  { pattern: /\btext_translated\b/i, why: 'translated verse field' },
  { pattern: /\btranslatedText\b/i, why: 'translated verse field' },
];

/** Files exempted because they only NAME the constraint (docs and this guard). */
const EXEMPT = new Set(['services/QuranTextService.ts']);

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (['.ts', '.tsx'].includes(extname(entry))) found.push(full);
  }
  return found;
}

const files = walk(ROOT);
const violations = [];

for (const file of files) {
  const relative = file.slice(ROOT.length + 1);
  const source = readFileSync(file, 'utf8');

  for (const { pattern, why } of FORBIDDEN) {
    if (!pattern.test(source)) continue;
    if (EXEMPT.has(relative)) continue;
    const line = source.split('\n').findIndex((text) => pattern.test(text)) + 1;
    violations.push(`${relative}:${line} — ${why} (${pattern})`);
  }
}

const textService = readFileSync(join(ROOT, 'services/QuranTextService.ts'), 'utf8');
if (!textService.includes('assertArabicOnly')) {
  violations.push('services/QuranTextService.ts — runtime Arabic-only guard was removed');
}
if (!/const LATIN = \/\[A-Za-z\]\//.test(textService)) {
  violations.push('services/QuranTextService.ts — Latin-character rejection was removed');
}

if (violations.length) {
  console.error('\n✗ لا تُعرض الترجمات — no-translation constraint violated:\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ no-translation constraint holds across ${files.length} source files`);
