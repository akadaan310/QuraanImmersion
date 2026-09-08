# محرك الإسناد — Termux CLI · Android / Samsung 16 Edition

The whole engine, running on the phone, driven from the phone's own terminal.

Termux builds and serves it, an Android browser renders it, and a bridge between
the two lets each reach into the other: the terminal drives the running scene,
and the page reaches the device — vibration, wake lock, battery, TTS, and, where
the device is already rooted, the system settings that decide whether a WebGL
session survives at all.

```
┌──────────────────── one Galaxy ────────────────────┐
│                                                    │
│  Termux                        Samsung Internet    │
│  ┌──────────────┐   SSE ↓      ┌────────────────┐  │
│  │ isnaad CLI   │─────────────►│  the engine    │  │
│  │ bridge/node  │◄─────────────│  window.__TERMUX__│
│  └──────┬───────┘   RPC ↑      └────────────────┘  │
│         │ su -c                                    │
│         ▼                                          │
│   Android system settings, cpufreq, doze allowlist │
└────────────────────────────────────────────────────┘
```

---

## Install

```bash
pkg install git
git clone <this repo> ~/QuraanImmersion
bash ~/QuraanImmersion/termux/install.sh
```

The installer installs the Termux packages, runs `npm ci`, links `isnaad` onto
`PATH`, optionally sets up the Termux:Boot hook, and finishes with `isnaad
doctor`. It is safe to run again at any time.

Two Android apps matter and neither is a Termux package:

| App | Why | Without it |
|---|---|---|
| **Termux:API** | every `device.*` op | vibration, battery, TTS, wake lock all report "not installed" |
| **Termux:Boot** | starting at boot | the boot hook never runs; everything else is unaffected |

Install both from the same source as Termux itself — an F-Droid Termux and a
Play Store Termux:API have different signatures and will not talk to each other.

---

## Run

```bash
isnaad up
```

Builds if the sources are newer than `dist/`, starts the bridge on 127.0.0.1:4173,
takes a wake lock, foregrounds Termux (Android 16 drops activity starts from
backgrounded apps), and opens the URL — token included — in Samsung Internet.

```bash
isnaad down          # stop the bridge, release the wake lock
isnaad status        # bridge, device, and what the takeover changed
isnaad logs -f
```

### Driving the page from the terminal

The browser is open on the phone. You are typing in Termux. These reach it:

```bash
isnaad play 18 60          # سورة الكهف، الآية ٦٠ — select, then play
isnaad next                # الآية التالية
isnaad reciter dosari
isnaad scene noor-ala-noor # `isnaad scenes` lists all twenty
isnaad route /engine/isnaad
isnaad lambda lower 3.0    # مرج البحرين — drive one sea into collapse
isnaad watch               # the live six-vector, redrawn in place
```

`isnaad watch` renders L1…L6, the closure impulse and the analyser's level and
spectral centroid as bars in the terminal, at 2 Hz, while the phone lies face
down. `isnaad state --json` is the same data for a script.

Commands issued while no browser is attached are queued and replayed when one
connects, so `isnaad up && isnaad play 18 60` works without a race.

### The device, from inside the page

The injected shim publishes `window.__TERMUX__`:

```js
await __TERMUX__.vibrate(80);              // on an analyser transient
await __TERMUX__.wakeLock(true);           // hold it through a long ayah
const battery = await __TERMUX__.battery();
await __TERMUX__.speak('سلام', 'ar');
await __TERMUX__.root.refresh(120);        // needs --root-rpc
```

Same ops from the terminal:

```bash
isnaad dev list                       # everything callable, and what is enabled
isnaad vibrate 120
isnaad battery
isnaad dev android.prop name=ro.product.model
```

---

## Root — the takeover

**This uses root the device already has. It does not obtain root.** There is no
exploit here; nothing is flashed and no bootloader is touched. If `su` does not
already exist and grant Termux a shell, every root command reports that and
stops. Everything else in this CLI works on a stock, unrooted Galaxy.

```bash
isnaad root status         # su provider, live grant, what is currently changed
isnaad root takeover       # apply the profile — recorded, and reversible
isnaad root restore        # put every recorded value back
isnaad root thermal        # read why the last session throttled
isnaad su                  # a root shell, already in the project directory
```

### What the takeover changes, and why each one

| # | Change | The problem it solves |
|---|---|---|
| ١ | `dumpsys deviceidle whitelist +com.termux`, appops, `app_standby_enabled=0` | Samsung Device Care puts Termux to sleep and the recitation stops mid-ayah with no error anywhere |
| ٢ | `min_refresh_rate` / `peak_refresh_rate` pinned, `refresh_rate_mode=1` | One UI's adaptive display drops the panel to 60 Hz during quiet ayat and the scene visibly steps |
| ٣ | animation scales → 0.5 | the system's own transitions compete with the scenes for the same GPU |
| ٤ | cpufreq governor (opt-in: `ISNAAD_GOVERNOR=performance`) | the scheduler parks the big cores and the first thirty seconds of a session stutter |

**Thermal management is deliberately not touched.** Every "remove throttling"
recipe is an invitation to cook the phone, and a sustained WebGL load is exactly
the workload thermal management exists for. `isnaad root thermal` reads the
state so a throttle can be diagnosed; nothing here writes to it.

### Reversibility

Every value is read before it is written and recorded to
`$ISNAAD_HOME/root-state.env` as `namespace|key|old`. `isnaad root restore`
replays it. A key that did not exist before the takeover is **deleted** on
restore rather than set to a guess — writing any value would leave the device in
a state it was never in.

### Letting the page call root

Off by default. Two separate flags, because they are two different risks:

```bash
isnaad up --root-rpc        # the page may call the curated privileged ops
isnaad up --root-exec       # …and root.exec, which is unbounded. Implies --root-rpc.
```

Even with both, a privileged op is refused from any non-loopback origin.

---

## Security model

The bridge lends a browser page the ability to run commands. That is worth
stating plainly, along with what bounds it.

- **Loopback by default.** 127.0.0.1 only. `--lan` opens the LAN for desktop
  debugging; privileged ops stay loopback-only regardless of any flag.
- **A token on every request.** Generated per run, written to
  `$ISNAAD_HOME/bridge.token` with mode 600, compared in constant time. It rides
  in the URL as `?k=`; the shim strips it from the address bar on first load so
  it does not reach a screenshot, a bookmark or history sync.
- **Argv, never a shell string.** Every op builds an argument array and is run
  with `execFile`. A value from the page cannot become a shell metacharacter —
  `getprop "a; rm -rf /"` is rejected by the validator, not escaped and hoped
  about. The one op that does hand a string to a shell, `root.exec`, is gated
  behind its own flag.
- **Two gates on privilege.** `root: true` needs `--allow-root-rpc`;
  `danger: true` needs `--allow-root-exec` as well. Authorisation is a single
  function (`authorise` in `bridge/protocol.mjs`), not a chain of `if`s around a
  spawn, and it is tested directly.
- **Every privileged call is logged** to the terminal the operator is sitting in
  front of. Root that runs silently is root you cannot audit.
- **The built bundle is never rewritten.** The client shim is injected into
  `index.html` in memory, per request, so what is served stays byte-identical to
  what `npm run build` produced and `verify:scenes` rasterised.

---

## SANDBOX-LOWER (`tri-reality-os`)

The lower sandbox was always a Termux runtime; the CLI just gives it a door.

```bash
isnaad tro selftest                          # hyper-math self-tests on this SoC
isnaad tro test                              # the bridge-protocol suite
isnaad tro daemon https://…/api/ingest       # stream τ(x,t) up to SANDBOX-UPPER
```

`selftest` prints `hardware_report()` first, so the numbers are attributed to
the actual chip they ran on.

---

## Samsung 16 specifics

Detected, and acted on, rather than assumed:

- **Android 16 / API 36** — `is_android_16_plus`. Below it, the CLI says so and
  carries on; the Android-16 specifics simply do not apply.
- **One UI version** — from `ro.build.version.oneui` (`80000` → One UI 8.0),
  falling back to the SEP version, which tracks it but is *not* the same number
  and is reported as `SEP …` rather than converted.
- **Samsung Internet** targeted by package (`com.sec.android.app.sbrowser`) when
  present, with Chrome, Firefox and Edge as ordered fallbacks. Override with
  `--browser chrome` or a raw package name.
- **Background activity starts.** Android 16 silently drops `am start` from a
  backgrounded app. `isnaad up` foregrounds Termux first, then falls back to
  `su -c am start`, then prints the URL and copies it to the clipboard. It never
  reports "opened" for a start Android dropped.
- **Sleeping / deep-sleeping apps.** With root, handled by the takeover. Without
  it, `isnaad doctor` prints the exact Settings path.

---

## Command reference

`isnaad help` is authoritative. In brief:

| | |
|---|---|
| `up` `down` `restart` `status` `open` `logs` | the session |
| `doctor` `setup` | diagnose · install |
| `play` `pause` `toggle` `next` `prev` `ayah` | transport |
| `reciter` `scene` `route` `hud` `invert` `volume` `loop` `lambda` | the scene |
| `watch` `state` `scenes` `commands` `send` | observe · drive |
| `dev` `toast` `notify` `vibrate` `speak` `battery` `torch` `brightness` | the device |
| `root status\|takeover\|restore\|thermal` `su` | privilege |
| `tro selftest\|test\|daemon` | SANDBOX-LOWER |

Options: `--port N` · `--browser <name>` · `--lan` · `--root-rpc` ·
`--root-exec` · `--rebuild` · `--yes` · `--no-color`.

Environment: `ISNAAD_HOME` `ISNAAD_PORT` `ISNAAD_BROWSER` `ISNAAD_GOVERNOR`
`ISNAAD_BUILD_HEAP` `ISNAAD_BRIDGE_TOKEN`.

---

## Layout

```
termux/
  bin/isnaad            the CLI — argument parsing and dispatch only
  lib/common.sh         logging, device identification, bridge locations
  lib/doctor.sh         what this phone can and cannot do, and the fix for each
  lib/browser.sh        Termux → browser: termux-open-url, am, su -c am
  lib/root.sh           su detection, the takeover, and the restore ledger
  lib/serve.sh          build, serve, wake lock, open
  bridge/protocol.mjs   framing, validation, authorisation — pure, and tested
  bridge/ops.mjs        the device surface the page may reach; one argv each
  bridge/server.mjs     static + SSE + RPC; Node standard library only
  bridge/client.js      the shim injected into the page (window.__TERMUX__)
  bridge/ctl.mjs        the terminal end — command, watch, state, rpc
  boot/isnaad-boot.sh   Termux:Boot hook
  tests/bridge.test.mjs node --test: protocol, ops, authorisation, live server
```

```bash
npm run termux:test     # 33 assertions, no phone required
```
