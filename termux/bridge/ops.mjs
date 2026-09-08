/**
 * ops.mjs — the device surface the browser is allowed to reach.
 *
 * This is the whole of "Termux → browser → Android". A page rendered by Samsung
 * Internet has no way to vibrate the phone on a spectral peak, read the battery,
 * hold a wake lock through a long recitation, or ask the kernel for the current
 * CPU governor. Termux does. The bridge lends the page exactly the capabilities
 * named below and nothing else.
 *
 * TWO RULES, both structural rather than advisory:
 *
 *   1. Every op is an ARGV, never a shell string. `argv()` returns an array and
 *      the executor uses `execFile`, so a value arriving from the page cannot
 *      become a shell metacharacter no matter what it contains. The one op that
 *      deliberately hands a string to a shell (`root.exec`) is marked `danger`
 *      and is refused unless the operator started the bridge with an explicit
 *      extra flag.
 *
 *   2. Every free parameter is validated against a narrow type before it is
 *      placed in that argv. The validators are the small functions at the top.
 *
 * Ops marked `root: true` need a working `su`. They are refused outright unless
 * the bridge was started with `--allow-root-rpc`, and even then only from a
 * loopback origin (see `authorise` in protocol.mjs).
 */

import { execFile } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------- validators

export class OpArgError extends Error {}

function must(condition, message) {
  if (!condition) throw new OpArgError(message);
}

/** A bare token: no spaces, no quotes, no shell metacharacters, ever. */
function word(value, name, max = 120) {
  const text = String(value ?? '');
  must(/^[A-Za-z0-9._@:/+-]{1,512}$/.test(text) && text.length <= max,
       `${name} must be a bare token (got ${JSON.stringify(text)})`);
  return text;
}

/** Free text that will be *displayed* (toast, notification, TTS), never parsed. */
function text(value, name, max = 400) {
  const string = String(value ?? '');
  must(string.length > 0 && string.length <= max, `${name} must be 1..${max} characters`);
  // A leading dash would be read as an option by the tool receiving it.
  must(!string.startsWith('-'), `${name} may not start with '-'`);
  return string;
}

function integer(value, name, min, max) {
  const number = Number(value);
  must(Number.isInteger(number) && number >= min && number <= max,
       `${name} must be an integer ${min}..${max} (got ${JSON.stringify(value)})`);
  return number;
}

function number(value, name, min, max) {
  const parsed = Number(value);
  must(Number.isFinite(parsed) && parsed >= min && parsed <= max,
       `${name} must be ${min}..${max} (got ${JSON.stringify(value)})`);
  return parsed;
}

function oneOf(value, name, values) {
  const text = String(value ?? '');
  must(values.includes(text), `${name} must be one of ${values.join('|')}`);
  return text;
}

/**
 * An Android settings key. Namespaced keys are `a.b.c`; nothing else is a valid
 * key, so this both validates and stops `settings put` being aimed at an
 * argument list of the caller's choosing.
 */
function settingsKey(value) {
  const key = String(value ?? '');
  must(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(key) && key.length <= 80, `key must be a settings identifier`);
  return key;
}

// -------------------------------------------------------------- the op table

/**
 * Build the op table.
 *
 * `su` is resolved once at construction rather than per call: if the operator
 * revoked Termux's root grant mid-session we want the op to fail loudly at the
 * `su` invocation, not to silently fall through to an unprivileged path and
 * report success for something that did not happen.
 */
export function makeOps({ su = 'su', termuxApi = true } = {}) {
  /** Wrap a privileged argv into an `su -c` invocation. */
  const asRoot = (parts) => [su, '-c', parts.join(' ')];

  const table = {
    // ---------------------------------------------------------------- device
    'device.toast': {
      help: 'flash a toast over whatever is on screen',
      argv: (a) => ['termux-toast', '-g', oneOf(a.gravity ?? 'middle', 'gravity', ['top', 'middle', 'bottom']),
                    text(a.message, 'message', 200)],
    },
    'device.notify': {
      help: 'post a notification (survives the browser being backgrounded)',
      argv: (a) => ['termux-notification', '--id', word(a.id ?? 'isnaad', 'id', 40),
                    '--title', text(a.title ?? 'الإسناد', 'title', 100),
                    '--content', text(a.content, 'content', 300)],
    },
    'device.vibrate': {
      help: 'haptic pulse — the usual consumer of the analyser peak',
      argv: (a) => ['termux-vibrate', '-d', String(integer(a.ms ?? 60, 'ms', 1, 5000)), '-f'],
    },
    'device.speak': {
      help: 'Android TTS',
      argv: (a) => ['termux-tts-speak', '-l', oneOf(a.lang ?? 'ar', 'lang', ['ar', 'en']), text(a.message, 'message', 300)],
    },
    'device.battery': {
      help: 'battery level, temperature and charge state',
      argv: () => ['termux-battery-status'],
      json: true,
    },
    'device.wakelock': {
      help: 'hold or release the CPU wake lock',
      argv: (a) => (oneOf(a.state ?? 'on', 'state', ['on', 'off']) === 'on'
        ? ['termux-wake-lock'] : ['termux-wake-unlock']),
    },
    'device.brightness': {
      help: 'screen brightness 0..255, or "auto"',
      argv: (a) => ['termux-brightness', a.level === 'auto' ? 'auto' : String(integer(a.level, 'level', 0, 255))],
    },
    'device.volume': {
      help: 'set a stream volume',
      argv: (a) => ['termux-volume', oneOf(a.stream ?? 'music', 'stream', ['music', 'call', 'system', 'ring', 'alarm', 'notification']),
                    String(integer(a.level, 'level', 0, 15))],
    },
    'device.torch': {
      help: 'camera torch',
      argv: (a) => ['termux-torch', oneOf(a.state ?? 'on', 'state', ['on', 'off'])],
    },
    'device.clipboard.get': { help: 'read the Android clipboard', argv: () => ['termux-clipboard-get'] },
    'device.clipboard.set': {
      help: 'write the Android clipboard',
      argv: (a) => ['termux-clipboard-set', text(a.value, 'value', 4000)],
    },
    'device.sensor': {
      help: 'one sample from a named sensor',
      argv: (a) => ['termux-sensor', '-s', word(a.sensor, 'sensor', 60), '-n', '1'],
      json: true,
      timeoutMs: 8000,
    },
    'device.info': { help: 'Termux + Android environment report', argv: () => ['termux-info'], timeoutMs: 25_000 },

    // ------------------------------------------------------------ properties
    'android.prop': {
      help: 'read one system property',
      argv: (a) => ['getprop', word(a.name, 'name', 80)],
    },
    'android.setting.get': {
      help: 'read a settings value',
      argv: (a) => ['settings', 'get', oneOf(a.namespace ?? 'system', 'namespace', ['system', 'secure', 'global']),
                    settingsKey(a.key)],
    },

    // ------------------------------------------------------------- privileged
    'root.id': {
      help: 'prove the su grant is live',
      root: true,
      argv: () => asRoot(['id']),
      timeoutMs: 20_000,
    },
    'root.setting.put': {
      help: 'write a settings value (refresh rate, animation scale, …)',
      root: true,
      argv: (a) => asRoot(['settings', 'put',
                           oneOf(a.namespace ?? 'system', 'namespace', ['system', 'secure', 'global']),
                           settingsKey(a.key), word(a.value, 'value', 60)]),
    },
    'root.refresh': {
      help: 'pin the panel refresh rate (One UI adaptive display)',
      root: true,
      argv: (a) => {
        const hz = integer(a.hz, 'hz', 24, 240);
        return asRoot(['settings', 'put', 'system', 'min_refresh_rate', String(hz), ';',
                       'settings', 'put', 'system', 'peak_refresh_rate', String(hz)]);
      },
    },
    'root.governor': {
      help: 'read or set the CPU frequency governor on every policy',
      root: true,
      argv: (a) => {
        const action = oneOf(a.action ?? 'get', 'action', ['get', 'set']);
        if (action === 'get') {
          return asRoot(['cat', '/sys/devices/system/cpu/cpufreq/policy*/scaling_governor']);
        }
        const governor = oneOf(a.governor, 'governor', ['performance', 'schedutil', 'powersave', 'walt', 'interactive']);
        return asRoot(['for', 'p', 'in', '/sys/devices/system/cpu/cpufreq/policy*;', 'do',
                       'echo', governor, '>', '$p/scaling_governor;', 'done']);
      },
      timeoutMs: 20_000,
    },
    'root.doze.exempt': {
      help: 'put Termux on the battery-optimisation allowlist',
      root: true,
      argv: (a) => asRoot(['dumpsys', 'deviceidle', 'whitelist',
                           (oneOf(a.state ?? 'add', 'state', ['add', 'remove']) === 'add' ? '+' : '-')
                             + word(a.package ?? 'com.termux', 'package', 100)]),
    },
    'root.thermal': {
      help: 'read the thermal service state (why the GPU throttled)',
      root: true,
      argv: () => asRoot(['dumpsys', 'thermalservice']),
      timeoutMs: 20_000,
    },
    'root.exec': {
      help: 'run an arbitrary command as root — the full takeover, gated twice',
      root: true,
      danger: true,
      argv: (a) => {
        const command = String(a.command ?? '');
        must(command.length > 0 && command.length <= 4000, 'command must be 1..4000 characters');
        return [su, '-c', command];
      },
      timeoutMs: 120_000,
    },
  };

  if (!termuxApi) {
    for (const [name, entry] of Object.entries(table)) {
      if (name.startsWith('device.') && name !== 'device.info') {
        entry.unavailable = 'termux-api is not installed (pkg install termux-api, plus the Termux:API app)';
      }
    }
  }
  return table;
}

/**
 * Execute one authorised op.
 *
 * Returns `{ ok, code, stdout, stderr, json? }` and NEVER throws for a non-zero
 * exit: a failing device op is data the page should see, not a bridge fault.
 * Only a malformed argument (OpArgError) rejects, because that is a bug in the
 * caller and should surface as a 400.
 */
export function runOp(entry, args = {}) {
  if (entry.unavailable) {
    return Promise.resolve({ ok: false, code: null, stdout: '', stderr: entry.unavailable });
  }
  const argv = entry.argv(args || {});
  const [command, ...rest] = argv;
  return new Promise((resolve) => {
    execFile(command, rest, {
      timeout: entry.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const result = {
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout ?? '').trimEnd(),
        stderr: String(stderr ?? '').trimEnd(),
      };
      if (error && error.code === 'ENOENT') {
        result.stderr = `${command}: not found. ${
          command.startsWith('termux-')
            ? 'Install it with: pkg install termux-api (and the Termux:API app from F-Droid).'
            : 'It is not on PATH in this Termux session.'}`;
      }
      if (entry.json && result.ok) {
        try { result.json = JSON.parse(result.stdout); } catch { /* leave stdout as the truth */ }
      }
      resolve(result);
    });
  });
}

/** The table, reduced to what is safe to hand a browser: names and help. */
export function describeOps(table, { allowRoot, allowExec }) {
  return Object.entries(table).map(([name, entry]) => ({
    name,
    help: entry.help,
    root: Boolean(entry.root),
    danger: Boolean(entry.danger),
    enabled: (!entry.root || allowRoot) && (!entry.danger || allowExec) && !entry.unavailable,
    note: entry.unavailable,
  }));
}
