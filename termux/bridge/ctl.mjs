#!/usr/bin/env node
/**
 * ctl.mjs — the terminal end of the bridge.
 *
 * `bin/isnaad` is a shell script and shell is bad at JSON, so every command
 * that has to speak to the running bridge comes through here. Node is already
 * a hard requirement (the app is built with it), so this costs nothing.
 *
 *   ctl.mjs command <name> [args…]     push a command to the page
 *   ctl.mjs rpc <op> [key=value…]      run a device op from the terminal
 *   ctl.mjs state [--json]             what the page last reported
 *   ctl.mjs watch [--hz=2]             live vector, redrawn in place
 *   ctl.mjs health | commands | ops    introspection
 *
 * Exit codes: 0 success, 1 bridge unreachable, 2 bad usage/refused.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

const BASE = process.env.ISNAAD_BRIDGE_URL || 'http://127.0.0.1:4173';

function token() {
  if (process.env.ISNAAD_BRIDGE_TOKEN) return process.env.ISNAAD_BRIDGE_TOKEN;
  const file = process.env.ISNAAD_TOKEN_FILE;
  if (file) {
    try { return readFileSync(file, 'utf8').trim(); } catch { /* reported below */ }
  }
  return '';
}

const TOKEN = token();

async function api(route, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}/__bridge${route}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-bridge-token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(`لا يوجد جسر — no bridge at ${BASE} (${error.cause?.code || error.message}).`);
    console.error('Start one with:  isnaad up');
    process.exit(1);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`✗ ${payload.error || `HTTP ${response.status}`}`);
    process.exit(2);
  }
  return payload;
}

// ------------------------------------------------------------------ rendering

const BAR_GLYPHS = '▁▂▃▄▅▆▇█';
const L_NAMES = ['L1 أمر', 'L2 صوت', 'L3 مادي', 'L4 شاهد', 'L5 خفي', 'L6 صدى'];

function bar(value, width = 24) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  const filled = clamped * width;
  const whole = Math.floor(filled);
  const remainder = filled - whole;
  const tail = remainder > 0 && whole < width
    ? BAR_GLYPHS[Math.min(BAR_GLYPHS.length - 1, Math.floor(remainder * BAR_GLYPHS.length))]
    : '';
  return ('█'.repeat(whole) + tail).padEnd(width, '·');
}

/** Arabic-Indic digits, matching the app's own counters. */
function arabicNumerals(value) {
  return String(value).replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}

function renderState(state) {
  const lines = [];
  const session = state.session;
  if (!session) {
    lines.push('  the page has not reported yet — is it open in the browser?');
    return lines.join('\n');
  }
  lines.push(`  الآية      ${arabicNumerals(session.surah)}:${arabicNumerals(session.ayah)}`
    + `   ${session.playing ? '▶ تشغيل' : '⏸ إيقاف'}`);
  lines.push(`  القارئ     ${session.reciter}${session.provider ? `   (${session.provider})` : ''}`);
  lines.push(`  الظاهرة    ${session.phenomenon}`);
  lines.push(`  المسار     ${state.path}`);
  lines.push(`  البحران    λ↓ ${session.lambdaLower?.toFixed(2)}   λ↑ ${session.lambdaUpper?.toFixed(2)}`);
  if (session.routeFailed) lines.push('  ⚠ تعذّر المسار الصوتي — every audio route failed for this ayah');
  lines.push('');
  if (state.isnaad) {
    state.isnaad.vector.forEach((value, index) => {
      lines.push(`  ${L_NAMES[index]}  ${bar(value)} ${value.toFixed(3)}`);
    });
    lines.push(`  إغلاق      ${bar(state.isnaad.closure)} ${state.isnaad.closure.toFixed(3)}`
      + `   ×${arabicNumerals(state.isnaad.executions)}`);
  }
  if (state.audio) {
    lines.push('');
    lines.push(`  مستوى      ${bar(state.audio.level)} ${state.audio.level.toFixed(3)}`);
    lines.push(`  سطوع طيفي  ${bar(state.audio.centroid)} ${state.audio.centroid.toFixed(3)}`);
  }
  if (state.lastError) {
    lines.push('');
    lines.push(`  ✗ ${state.lastError.command}: ${state.lastError.message}`);
  }
  return lines.join('\n');
}

// -------------------------------------------------------------------- actions

async function main() {
  const [action, ...rest] = process.argv.slice(2);

  switch (action) {
    case 'command': {
      const [name, ...args] = rest;
      if (!name) { console.error('usage: ctl.mjs command <name> [args…]'); process.exit(2); }
      const result = await api('/command', { method: 'POST', body: { name, args } });
      if (result.delivered === 0) {
        console.error(`⚠ ${name} queued but no browser is attached — open the page, it will replay on connect.`);
        process.exit(0);
      }
      console.log(`✓ ${name}${args.length ? ' ' + args.join(' ') : ''}  →  ${result.delivered} client(s)`);
      break;
    }

    case 'rpc': {
      const [op, ...pairs] = rest;
      if (!op) { console.error('usage: ctl.mjs rpc <op> [key=value…]'); process.exit(2); }
      const args = {};
      for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index < 0) { console.error(`✗ arguments must be key=value, got '${pair}'`); process.exit(2); }
        args[pair.slice(0, index)] = pair.slice(index + 1);
      }
      const result = await api('/rpc', { method: 'POST', body: { op, args } });
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      process.exit(result.ok ? 0 : 1);
      break;
    }

    case 'state': {
      const state = await api('/state');
      if (rest.includes('--json')) console.log(JSON.stringify(state, null, 2));
      else console.log(renderState(state));
      break;
    }

    case 'watch': {
      const hz = Number((rest.find((a) => a.startsWith('--hz=')) || '--hz=2').slice(5)) || 2;
      const interval = Math.max(100, Math.round(1000 / hz));
      process.stdout.write('\x1b[?25l');                       // hide the cursor
      const restore = () => { process.stdout.write('\x1b[?25h\n'); process.exit(0); };
      process.on('SIGINT', restore);
      process.on('SIGTERM', restore);
      for (;;) {
        const state = await api('/state');
        const body = renderState(state);
        const header = `  مرصد الإسناد — ${new Date().toLocaleTimeString()}`
          + `   ${state.connected ? '● متصل' : '○ منفصل'}\n`;
        // Home the cursor and clear to end of screen: no scrollback churn, and
        // it survives the terminal being resized mid-recitation.
        process.stdout.write(`\x1b[H\x1b[J${header}\n${body}\n\n  ^C للخروج`);
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    case 'health': {
      console.log(JSON.stringify(await api('/health'), null, 2));
      break;
    }

    case 'commands': {
      const { commands } = await api('/commands');
      for (const command of commands) {
        const signature = `${command.name} ${command.args.map((a) => `<${a}>`).join(' ')}`;
        console.log(`  ${signature.padEnd(28)} ${command.help}`);
      }
      break;
    }

    case 'ops': {
      const { ops } = await api('/ops');
      for (const op of ops) {
        const mark = op.enabled ? '✓' : '·';
        const tags = [op.root ? 'root' : '', op.danger ? 'DANGER' : ''].filter(Boolean).join(',');
        console.log(`  ${mark} ${op.name.padEnd(22)} ${tags.padEnd(12)} ${op.help}`);
        if (op.note) console.log(`      ${op.note}`);
      }
      break;
    }

    default:
      console.error('usage: ctl.mjs {command|rpc|state|watch|health|commands|ops} …');
      process.exit(2);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
