/**
 * Bridge tests — `node --test termux/tests/`
 *
 * The three things worth testing here are the three that fail silently in
 * production: an argument that should have been rejected and was not, an
 * authorisation decision that went the wrong way, and a command that was
 * accepted by the server but never reached the page. Everything below is one
 * of those.
 *
 * The server tests bind to 127.0.0.1:0 and speak real HTTP, because the bugs
 * being hunted (SSE buffering, header casing, path traversal) do not exist at
 * the function-call level.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  authorise, buildCommand, encodeSSE, injectClient, isLoopback, ProtocolError, tokenMatches,
} from '../bridge/protocol.mjs';
import { OpArgError, describeOps, makeOps } from '../bridge/ops.mjs';
import { createBridge } from '../bridge/server.mjs';

// --------------------------------------------------------------- the protocol

test('buildCommand accepts a well-formed verse selection', () => {
  const command = buildCommand('verse', ['18', '60'], 7);
  assert.deepEqual(command.args, [18, 60]);
  assert.equal(command.seq, 7);
  assert.equal(command.name, 'verse');
});

test('buildCommand rejects out-of-range and malformed arguments', () => {
  assert.throws(() => buildCommand('verse', ['0', '1']), ProtocolError);
  assert.throws(() => buildCommand('verse', ['115', '1']), ProtocolError);
  assert.throws(() => buildCommand('verse', ['18', 'x']), ProtocolError);
  assert.throws(() => buildCommand('verse', ['18']), /missing argument <ayah>/);
  assert.throws(() => buildCommand('reciter', ['nobody']), /husary\|kurdi\|qatami\|dosari/);
  assert.throws(() => buildCommand('nope', []), /unknown command/);
  assert.throws(() => buildCommand('play', ['extra']), /takes 0 argument/);
});

test('the route commands reach what the drawer reaches', () => {
  assert.deepEqual(buildCommand('experience', ['musa-khidr']).args, ['musa-khidr']);
  assert.deepEqual(buildCommand('experience', ['surah-18']).args, ['surah-18']);
  assert.deepEqual(buildCommand('goto', ['12']).args, [12]);
  assert.deepEqual(buildCommand('drawer', ['waypoints']).args, ['waypoints']);
  assert.deepEqual(buildCommand('orient', ['l5']).args, ['l5']);

  // An id is a slug, never a path or a shell token.
  assert.throws(() => buildCommand('experience', ['../etc']), ProtocolError);
  assert.throws(() => buildCommand('experience', ['Surah 18']), ProtocolError);
  assert.throws(() => buildCommand('goto', ['0']), /1\.\.6236/);
  assert.throws(() => buildCommand('drawer', ['settings']), ProtocolError);
  assert.throws(() => buildCommand('orient', ['l7']), /l1\|l2\|l3\|l4\|l5\|l6\|none/);
});

test('commands the journey no longer has are gone, not silently accepted', () => {
  // A CLI still sending a retired name must fail loudly in the terminal rather
  // than posting a command the page silently ignores.
  for (const retired of ['route', 'hud', 'invert', 'calibrate', 'swipe', 'tap']) {
    assert.throws(() => buildCommand(retired, ['/']), /unknown command/);
  }
});

test('lambda stays inside the sweep the three-phase model is defined on', () => {
  assert.deepEqual(buildCommand('lambda', ['lower', '3.0']).args, ['lower', 3]);
  assert.throws(() => buildCommand('lambda', ['lower', '9']), ProtocolError);
  assert.throws(() => buildCommand('lambda', ['middle', '3']), ProtocolError);
});

test('tokenMatches is exact and survives a length mismatch', () => {
  assert.equal(tokenMatches('abc123', 'abc123'), true);
  assert.equal(tokenMatches('abc123', 'abc124'), false);
  assert.equal(tokenMatches('abc123', 'abc'), false);
  assert.equal(tokenMatches('abc123', ''), false);
  assert.equal(tokenMatches('', ''), false);
  assert.equal(tokenMatches('abc', undefined), false);
});

test('encodeSSE frames an event the browser can parse', () => {
  const frame = encodeSSE('command', { name: 'play' }, 3);
  assert.equal(frame, 'id: 3\nevent: command\ndata: {"name":"play"}\n\n');
  assert.ok(frame.endsWith('\n\n'), 'an SSE frame must end with a blank line');
});

test('injectClient adds the shim before </body> and carries the token', () => {
  const html = injectClient('<html><body><div id="root"></div></body></html>',
    { token: 'T0KEN', allowRoot: true });
  assert.ok(html.includes('"token":"T0KEN"'));
  assert.ok(html.includes('"allowRoot":true'));
  assert.ok(html.indexOf('__bridge/client.js') < html.indexOf('</body>'));
});

test('isLoopback recognises the forms Node actually reports', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53']) {
    assert.equal(isLoopback(address), true, address);
  }
  for (const address of ['192.168.1.7', '10.0.0.2', '', undefined]) {
    assert.equal(isLoopback(address), false, String(address));
  }
});

// ---------------------------------------------------------------- authorisation

const TABLE = makeOps({});

function verdict(overrides) {
  return authorise({
    op: 'device.toast', table: TABLE, token: 'T', presented: 'T',
    remote: '127.0.0.1', allowRoot: false, allowExec: false, allowLan: false,
    ...overrides,
  });
}

test('authorise: a bad token loses before anything else is considered', () => {
  const result = verdict({ presented: 'wrong', op: 'no.such.op' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  // The message must not reveal that the op does not exist.
  assert.match(result.reason, /token/);
});

test('authorise: loopback-only by default, LAN when opened', () => {
  assert.equal(verdict({ remote: '192.168.1.9' }).status, 403);
  assert.equal(verdict({ remote: '192.168.1.9', allowLan: true }).ok, true);
});

test('authorise: root ops need the flag, and stay loopback-only even with it', () => {
  assert.equal(verdict({ op: 'root.id' }).status, 403);
  assert.equal(verdict({ op: 'root.id', allowRoot: true }).ok, true);
  assert.equal(verdict({ op: 'root.id', allowRoot: true, allowLan: true, remote: '192.168.1.9' }).status, 403);
});

test('authorise: the unbounded op needs a second, separate flag', () => {
  assert.equal(verdict({ op: 'root.exec', allowRoot: true }).status, 403);
  assert.match(verdict({ op: 'root.exec', allowRoot: true }).reason, /unbounded/);
  assert.equal(verdict({ op: 'root.exec', allowRoot: true, allowExec: true }).ok, true);
});

test('authorise: an unknown op is a 404, not a spawn', () => {
  assert.equal(verdict({ op: 'device.rm-rf' }).status, 404);
});

// ------------------------------------------------------------------- op argv

test('every op builds an argv array, never a shell string', () => {
  const built = TABLE['device.toast'].argv({ message: 'سلام' });
  assert.ok(Array.isArray(built));
  assert.deepEqual(built, ['termux-toast', '-g', 'middle', 'سلام']);
});

test('shell metacharacters are rejected, not escaped', () => {
  const attacks = ['a; rm -rf /', 'a && id', 'a`id`', 'a$(id)', 'a|id', "a'b", 'a\nb'];
  for (const attack of attacks) {
    assert.throws(() => TABLE['android.prop'].argv({ name: attack }), OpArgError, attack);
    assert.throws(() => TABLE['root.setting.put'].argv({ key: attack, value: '1' }), OpArgError, attack);
  }
});

test('numeric ops clamp to physically meaningful ranges', () => {
  assert.throws(() => TABLE['root.refresh'].argv({ hz: 9000 }), OpArgError);
  assert.throws(() => TABLE['device.brightness'].argv({ level: 999 }), OpArgError);
  assert.throws(() => TABLE['device.vibrate'].argv({ ms: -1 }), OpArgError);
  assert.deepEqual(TABLE['root.refresh'].argv({ hz: 120 })[0], 'su');
});

test('displayed text may not start with a dash that a tool would read as a flag', () => {
  assert.throws(() => TABLE['device.toast'].argv({ message: '--help' }), OpArgError);
});

test('the governor op only offers governors that exist', () => {
  assert.throws(() => TABLE['root.governor'].argv({ action: 'set', governor: 'turbo' }), OpArgError);
  assert.ok(TABLE['root.governor'].argv({ action: 'get' }).includes('-c'));
});

test('describeOps marks what is actually reachable', () => {
  const described = describeOps(TABLE, { allowRoot: false, allowExec: false });
  const rootId = described.find((op) => op.name === 'root.id');
  assert.equal(rootId.enabled, false);
  assert.equal(described.find((op) => op.name === 'device.toast').enabled, true);
  assert.equal(described.find((op) => op.name === 'root.exec').danger, true);
});

test('without termux-api the device ops say so instead of failing obscurely', () => {
  const table = makeOps({ termuxApi: false });
  assert.match(table['device.toast'].unavailable, /pkg install termux-api/);
});

// ------------------------------------------------------------ the live server

async function withBridge(options, body) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'isnaad-bridge-'));
  await fsp.writeFile(path.join(root, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>');
  await fsp.mkdir(path.join(root, 'assets'), { recursive: true });
  await fsp.writeFile(path.join(root, 'assets', 'index-a1b2c3d4.js'), 'export default 1;\n');

  const bridge = createBridge({ root, token: 'TESTTOKEN', ...options });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  try {
    await body({ bridge, base, root });
  } finally {
    await new Promise((resolve) => bridge.server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test('server: index.html is injected in memory, dist is left alone', async () => {
  await withBridge({}, async ({ base, root }) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('__bridge/client.js'));
    assert.ok(html.includes('"token":"TESTTOKEN"'));

    const onDisk = await fsp.readFile(path.join(root, 'index.html'), 'utf8');
    assert.ok(!onDisk.includes('__bridge'), 'the built artefact must not be rewritten on disk');
  });
});

test('server: unknown paths without an extension fall back to the SPA', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/engine/isnaad`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);

    const missingAsset = await fetch(`${base}/assets/nope.js`);
    assert.equal(missingAsset.status, 404);
  });
});

test('server: fingerprinted assets are cached hard, index never', async () => {
  await withBridge({}, async ({ base }) => {
    const asset = await fetch(`${base}/assets/index-a1b2c3d4.js`);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    const index = await fetch(`${base}/`);
    assert.equal(index.headers.get('cache-control'), 'no-store');
  });
});

test('server: a traversal attempt cannot leave the served root', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd`);
    assert.ok(response.status === 403 || response.status === 404, `got ${response.status}`);
    const body = await response.text();
    assert.ok(!body.includes('root:'), 'must not serve anything outside dist');
  });
});

test('server: the event stream demands the token', async () => {
  await withBridge({}, async ({ base }) => {
    const denied = await fetch(`${base}/__bridge/events`);
    assert.equal(denied.status, 401);
    await denied.body?.cancel();
  });
});

test('server: a command typed in the terminal arrives on the event stream', async () => {
  await withBridge({}, async ({ bridge, base }) => {
    const stream = await fetch(`${base}/__bridge/events?k=TESTTOKEN`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();

    // The hello frame lands first and proves the stream is flushed, not buffered.
    const hello = decoder.decode((await reader.read()).value);
    assert.match(hello, /event: hello/);

    const posted = await fetch(`${base}/__bridge/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ name: 'verse', args: ['18', '60'] }),
    });
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).delivered, 1);

    let frame = '';
    while (!frame.includes('event: command')) frame += decoder.decode((await reader.read()).value);
    assert.match(frame, /"name":"verse"/);
    assert.match(frame, /"args":\[18,60\]/);

    // Dropping the reader must unregister the subscriber, or a phone that
    // navigates away a few times leaks a writer per navigation and the bridge
    // starts writing into dead sockets.
    await reader.cancel();
    for (let waited = 0; bridge.subscribers > 0 && waited < 2000; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(bridge.subscribers, 0, 'the closed stream was not unregistered');
  });
});

test('server: a malformed command is refused in the terminal, not in the browser', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/__bridge/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ name: 'verse', args: ['900', '1'] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /1\.\.114/);
  });
});

test('server: commands queued with no browser attached replay on connect', async () => {
  await withBridge({}, async ({ base }) => {
    const queued = await fetch(`${base}/__bridge/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ name: 'play', args: [] }),
    });
    assert.equal((await queued.json()).delivered, 0);

    const stream = await fetch(`${base}/__bridge/events?k=TESTTOKEN`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let frame = '';
    while (!frame.includes('event: command')) frame += decoder.decode((await reader.read()).value);
    assert.match(frame, /"name":"play"/);
    await reader.cancel();
  });
});

test('server: root RPC is refused without the flag and never spawns', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/__bridge/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ op: 'root.id', args: {} }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /--allow-root-rpc/);
  });
});

test('server: a bad op argument is a 400, and the process is never started', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/__bridge/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ op: 'device.vibrate', args: { ms: 'a; reboot' } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ms must be an integer/);
  });
});

test('server: a device op that is not installed reports how to install it', async () => {
  await withBridge({}, async ({ base }) => {
    const response = await fetch(`${base}/__bridge/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ op: 'device.toast', args: { message: 'hi' } }),
    });
    // The test host has no termux-toast; a missing binary must be a reported
    // result, not a 500 from the bridge.
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.match(payload.stderr, /pkg install termux-api|not found/);
  });
});

test('server: page telemetry round-trips to the terminal', async () => {
  await withBridge({}, async ({ base }) => {
    await fetch(`${base}/__bridge/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': 'TESTTOKEN' },
      body: JSON.stringify({ session: { surah: 18, ayah: 60, playing: true } }),
    });
    const state = await (await fetch(`${base}/__bridge/state?k=TESTTOKEN`)).json();
    assert.equal(state.session.surah, 18);
    assert.equal(state.session.playing, true);
    assert.ok(state.at > 0);
  });
});

test('server: health is public, ops are not', async () => {
  await withBridge({ allowRoot: true }, async ({ base }) => {
    const health = await (await fetch(`${base}/__bridge/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.root, true);

    assert.equal((await fetch(`${base}/__bridge/ops`)).status, 401);
    const ops = await (await fetch(`${base}/__bridge/ops?k=TESTTOKEN`)).json();
    assert.ok(ops.ops.some((op) => op.name === 'root.id' && op.enabled));
  });
});
