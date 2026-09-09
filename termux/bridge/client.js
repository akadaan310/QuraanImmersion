/**
 * client.js — the half of the bridge that runs inside the Android browser.
 *
 * Injected into `index.html` in memory by server.mjs, so the built bundle on
 * disk stays byte-identical to what `npm run build` produced and what
 * `verify:scenes` rasterised. Nothing in `src/` imports this file; if the
 * bridge is not serving the page, this code does not exist and the app behaves
 * exactly as it does on a desktop.
 *
 * It joins three things:
 *
 *   1. SSE down  — commands typed in Termux drive `window.__ISNAAD__`.
 *   2. RPC up    — `window.__TERMUX__.call(op, args)` reaches the device.
 *   3. State up  — a small telemetry post, so `isnaad watch` can render the
 *                  live vector in the terminal while the phone is face-down.
 *
 * Written as an IIFE in ES2019 so it parses in Samsung Internet's older
 * WebViews too. It is deliberately not part of the TypeScript build.
 */
(function () {
  'use strict';

  var CONFIG = window.__TERMUX_BRIDGE_CONFIG__ || {};
  var ENDPOINT = CONFIG.endpoint || '/__bridge';
  var STORE_KEY = 'isnaad.bridge.token';

  /**
   * Token resolution, in order: what the server injected, then `?k=` on the
   * URL, then whatever a previous page in this tab kept. The URL form matters
   * when the operator shares the LAN link to a desktop browser; once used it is
   * stripped from the address bar so the token does not end up in a screenshot,
   * a bookmark or the browser's own history sync.
   */
  function resolveToken() {
    if (CONFIG.token) return CONFIG.token;
    var fromUrl = new URLSearchParams(location.search).get('k');
    if (fromUrl) {
      try { sessionStorage.setItem(STORE_KEY, fromUrl); } catch (e) { /* private mode */ }
      var clean = new URL(location.href);
      clean.searchParams.delete('k');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
      return fromUrl;
    }
    try { return sessionStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; }
  }

  var TOKEN = resolveToken();

  function post(route, body) {
    return fetch(ENDPOINT + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': TOKEN },
      body: JSON.stringify(body || {}),
      keepalive: route === '/state',
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'HTTP ' + response.status);
        return payload;
      });
    });
  }

  // ---------------------------------------------------------------- device API

  /**
   * `window.__TERMUX__` — what the page gains by being served from Termux.
   *
   * Every method returns a promise of `{ ok, code, stdout, stderr }`. Nothing
   * throws for a device that simply said no (torch busy, no TTS engine); a
   * rejection means the bridge refused the call, which is a different problem
   * and deserves a different branch in the caller.
   */
  var termux = {
    available: true,
    allowRoot: Boolean(CONFIG.allowRoot),

    call: function (op, args) { return post('/rpc', { op: op, args: args || {} }); },
    ops: function () {
      return fetch(ENDPOINT + '/ops?k=' + encodeURIComponent(TOKEN)).then(function (r) { return r.json(); });
    },

    toast: function (message, gravity) { return termux.call('device.toast', { message: message, gravity: gravity }); },
    notify: function (content, title) { return termux.call('device.notify', { content: content, title: title }); },
    vibrate: function (ms) { return termux.call('device.vibrate', { ms: ms || 60 }); },
    speak: function (message, lang) { return termux.call('device.speak', { message: message, lang: lang || 'ar' }); },
    battery: function () { return termux.call('device.battery', {}); },
    wakeLock: function (on) { return termux.call('device.wakelock', { state: on === false ? 'off' : 'on' }); },
    brightness: function (level) { return termux.call('device.brightness', { level: level }); },
    volume: function (level, stream) { return termux.call('device.volume', { level: level, stream: stream || 'music' }); },
    torch: function (on) { return termux.call('device.torch', { state: on === false ? 'off' : 'on' }); },
    clipboard: function (value) {
      return value === undefined ? termux.call('device.clipboard.get', {})
                                 : termux.call('device.clipboard.set', { value: value });
    },
    sensor: function (name) { return termux.call('device.sensor', { sensor: name }); },
    prop: function (name) { return termux.call('android.prop', { name: name }); },

    /** Privileged. Refused unless the bridge was started with --allow-root-rpc. */
    root: {
      id: function () { return termux.call('root.id', {}); },
      refresh: function (hz) { return termux.call('root.refresh', { hz: hz }); },
      governor: function (governor) {
        return termux.call('root.governor', governor ? { action: 'set', governor: governor } : { action: 'get' });
      },
      setting: function (namespace, key, value) {
        return termux.call('root.setting.put', { namespace: namespace, key: key, value: value });
      },
      /** Also needs --allow-root-exec. Two flags, because it is unbounded. */
      exec: function (command) { return termux.call('root.exec', { command: command }); },
    },
  };

  window.__TERMUX__ = termux;

  // ------------------------------------------------------- driving the engine

  /**
   * The app's own debug bridge. `main.tsx` publishes it synchronously before
   * the first render, and this script is deferred, so by the time we run it is
   * normally already there — but a failed chunk load would leave it undefined
   * forever, and silently doing nothing is the worst possible failure here.
   * So: poll briefly, then say so out loud.
   */
  function engine() { return window.__ISNAAD__ || null; }

  function whenReady(callback) {
    var waited = 0;
    (function attempt() {
      if (engine() && engine().session) return callback(engine());
      waited += 100;
      if (waited > 15000) {
        console.error('[termux-bridge] window.__ISNAAD__.session never appeared — the app bundle did not initialise.');
        return undefined;
      }
      return setTimeout(attempt, 100);
    })();
  }

  function onOff(current, state) {
    if (state === 'on') return true;
    if (state === 'off') return false;
    return !current;
  }

  function apply(command) {
    var api = engine();
    if (!api || !api.session) throw new Error('engine not ready');
    var store = api.session;
    var state = store.getState();
    var args = command.args || [];

    switch (command.name) {
      case 'play': state.play(); break;
      case 'pause': state.pause(); break;
      case 'toggle': state.toggleTransport(); break;
      case 'next': state.advance(); break;
      case 'prev': state.retreat(); break;
      case 'verse': state.selectVerse(args[0], args[1]); break;
      case 'reciter': state.setReciter(args[0]); break;
      case 'scene': {
        // The store indexes a table directly, so an unknown id would throw
        // inside React rather than here. Check first and report a usable error
        // back up the RPC, where the operator is actually looking.
        var known = (api.phenomena || []).map(function (p) { return p.id; });
        if (known.length && known.indexOf(args[0]) === -1) {
          throw new Error("unknown scene '" + args[0] + "'. known: " + known.join(' '));
        }
        // A pin, not a mode: the store releases it at the next verse.
        state.pinPhenomenon(args[0]);
        break;
      }
      case 'orient': state.adopt(args[0] === 'none' ? null : args[0]); break;
      case 'swipe': state.focus(args[0] === 'next' ? 1 : -1); break;
      case 'tap': state.commitFocus(); break;
      case 'veil': store.setState({ veil: onOff(state.veil, args[0]) }); break;
      case 'volume': state.setVolume(args[0]); break;
      case 'loop': state.setLoopVerse(args[0] === 'on'); break;
      case 'lambda': state.setLambda(args[0], args[1]); break;
      case 'reload': location.reload(); break;
      case 'gate':
        // 'open' performs the unlock the first tap performs, which also starts
        // the journey. 'reset' clears it so the gate can be seen again.
        if (args[0] === 'open') state.unlock();
        else {
          try { localStorage.removeItem('isnaad.unlocked.v2'); } catch (e) { /* private mode */ }
          store.setState({ unlocked: false });
        }
        break;
      case 'ping': break;
      default: throw new Error('unhandled command ' + command.name);
    }
  }

  // ------------------------------------------------------------------ telemetry

  function snapshot() {
    var api = engine();
    var report = {
      path: location.pathname,
      href: location.href,
      ua: navigator.userAgent,
      screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
      visible: document.visibilityState,
    };
    if (!api || !api.session) return report;

    var state = api.session.getState();
    report.session = {
      unlocked: state.unlocked,
      reciter: state.reciter,
      surah: state.surah,
      ayah: state.ayah,
      // The phenomenon is derived from the waypoint unless something has pinned
      // one, so both are reported: the terminal should be able to tell a leg
      // that arrived at a scene from a scene the operator pinned there.
      phenomenon: state.pinnedPhenomenon || (state.waypoint && state.waypoint.phenomenon),
      pinned: Boolean(state.pinnedPhenomenon),
      playing: state.playing,
      provider: state.provider,
      routeFailed: state.routeFailed,
      volume: state.volume,
      veil: state.veil,
      orientation: state.orientation,
      focused: state.focused,
      lambdaLower: state.lambdaLower,
      lambdaUpper: state.lambdaUpper,
    };

    // Where on السيارة this leg lands, and how far up the ladder it is. This is
    // what `isnaad watch` renders as the position readout in the terminal.
    if (state.waypoint) {
      report.waypoint = {
        index: state.waypoint.index,
        lat: Math.round(state.waypoint.at.lat * 1000) / 1000,
        lon: Math.round(state.waypoint.at.lon * 1000) / 1000,
        anchored: state.waypoint.anchored,
      };
    }

    var isnaad = api.isnaadEngine && api.isnaadEngine.snapshot;
    if (isnaad) {
      report.isnaad = {
        // Rounded at the source: this crosses a socket up to twice a second on
        // a phone, and six values at 1e-15 precision is pure radio waste.
        vector: Array.prototype.map.call(isnaad.vector, function (v) { return Math.round(v * 1000) / 1000; }),
        closure: Math.round(isnaad.closure * 1000) / 1000,
        executing: isnaad.executing,
        executions: isnaad.executions,
      };
    }
    var frame = api.audioEngine && api.audioEngine.frame;
    if (frame) {
      report.audio = {
        level: Math.round(frame.level * 1000) / 1000,
        peak: Math.round(frame.peak * 1000) / 1000,
        centroid: Math.round(frame.centroid * 1000) / 1000,
        transient: Math.round(frame.transient * 1000) / 1000,
        subBass: Math.round(frame.subBass * 1000) / 1000,
        treble: Math.round(frame.treble * 1000) / 1000,
      };
    }
    return report;
  }

  var pushing = false;
  function pushState() {
    if (pushing) return Promise.resolve();       // never queue behind a slow radio
    pushing = true;
    return post('/state', snapshot())
      .catch(function () { /* the terminal will notice the gap itself */ })
      .then(function () { pushing = false; });
  }

  // ------------------------------------------------------------- the SSE link

  function connect() {
    var source = new EventSource(ENDPOINT + '/events?k=' + encodeURIComponent(TOKEN));

    source.addEventListener('hello', function () {
      console.info('[termux-bridge] linked to Termux' + (CONFIG.allowRoot ? ' (root RPC enabled)' : ''));
      pushState();
    });

    source.addEventListener('command', function (event) {
      var command;
      try { command = JSON.parse(event.data); } catch (error) { return; }
      try {
        apply(command);
      } catch (error) {
        console.error('[termux-bridge] ' + command.name + ': ' + error.message);
        post('/state', Object.assign(snapshot(), {
          lastError: { command: command.name, message: String(error.message), at: Date.now() },
        })).catch(function () {});
        return;
      }
      // Report after the command has had a frame to take effect, so what the
      // terminal prints is the state the operator just caused, not the one
      // before it.
      setTimeout(pushState, 120);
    });

    source.onerror = function () {
      // EventSource reconnects on its own; this only surfaces the gap. A 401
      // is the exception — it will retry forever without ever succeeding — so
      // check liveness once and say something useful if the token is wrong.
      fetch(ENDPOINT + '/health').then(function (r) { return r.json(); }).then(function (health) {
        if (health && health.ok && !TOKEN) {
          console.error('[termux-bridge] no token. Open the URL printed by `isnaad up`, including its ?k= parameter.');
        }
      }).catch(function () {});
    };

    return source;
  }

  whenReady(function () {
    connect();
    // 1 Hz while playing, every 5 s when idle. The vector only moves when the
    // analyser does, and an idle phone should not be waking its radio.
    setInterval(function () {
      var api = engine();
      var playing = api && api.session && api.session.getState().playing;
      if (playing || Date.now() - (window.__TERMUX_LAST_PUSH__ || 0) > 5000) {
        window.__TERMUX_LAST_PUSH__ = Date.now();
        pushState();
      }
    }, 1000);
    document.addEventListener('visibilitychange', pushState);
  });
})();
