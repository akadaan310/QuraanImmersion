# محرك الإسناد المعرفي الانغماسي
### Isnaad-Cognitive Immersion Engine

A real-time, WebGL-driven spatial rendering environment that turns ayah-level Quranic
recitation into interactive computational scenes. Audio is fetched one ayah at a time,
analysed live with the Web Audio API, and the resulting measurement drives every shader
parameter, geometry deformation, particle density and light in the viewport.

---

## Hard constraints

These are enforced, not merely intended.

**1. No translations, anywhere.**
The interface renders original Arabic only — Uthmani script for verse text, Arabic for
every label, Arabic-Indic numerals for every counter. `QuranTextService` rejects any
payload containing Latin characters at runtime (`assertArabicOnly`), and
`scripts/check-no-translation.mjs` fails the build if a translation or tafsir resource,
parameter, or field is ever introduced. No translation endpoint is called and no
translation field is read.

**2. Audio is bound to a single ayah.**
Every playback path resolves and plays exactly one verse. The transport has no
surah-length mode, because the Isnaad runtime opens a state (L1) and closes it (L6)
once per ayah and needs discrete verse boundaries to do so.

**3. The analyser drives the visuals.**
`syncEngineUniforms` is the only path from audio to the GPU. Nothing in the twenty
scenes animates on wall-clock time alone; they are all functions of what the
`AnalyserNode` measured this frame.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
```

First run enters the calibration protocol at `/onboarding`. Audio needs a user gesture,
so the first stage is a button — browsers will not open an `AudioContext` without one.

```bash
npm run build          # typecheck + production bundle
npm run preview        # serve the build on :4173
```

### On a phone — Termux CLI, Samsung 16 Edition

The engine also runs entirely on an Android device, built and served from Termux
and rendered by the phone's own browser, with a bridge in both directions: the
terminal drives the running scene, and the page reaches the device (wake lock,
haptics, battery, TTS) — plus, where the device is already rooted, the four
system settings that decide whether a long WebGL session survives One UI at all.

```bash
bash termux/install.sh
isnaad up                 # build, serve, open Samsung Internet, hold the wake lock
isnaad play 18 60         # drive the open page from the terminal
isnaad watch              # the live six-vector, rendered in the terminal
isnaad root takeover      # uses existing root; recorded and reversible
```

See [`termux/README.md`](termux/README.md).

### Verification

```bash
npm run verify         # no-translation guard + typecheck        (fast, no browser)
npm run verify:scenes  # every shader compiles AND rasterises    (needs a preview server)
npm run verify:audio   # all four reciters play, bounded to one ayah
npm run verify:all     # all of the above
```

`verify:scenes` runs all twenty phenomena plus every route in a real WebGL context
(SwiftShader, so it works without a GPU) and fails on a shader compile error, a runtime
error, or a scene that draws nothing. TypeScript cannot check GLSL — this is what
catches shader mistakes.

`verify:audio` fetches real recitation audio, replays it to the browser, and asserts
that energy reaches the analyser for each reciter and that a timed-window ayah plays for
exactly its published span (measured in media time, so buffering stalls do not
masquerade as boundary errors).

Both browser scripts honour `PW_CHROMIUM_PATH` if the image ships its own Chromium, and
`VERIFY_BASE` to point at an already-running instance.

---

## Architecture

```
AudioEngine  ──analyse()──►  AudioFrame  ──►  IsnaadEngine  ──►  syncEngineUniforms  ──►  GLSL
  (one AudioContext,          (mutated in     (six vectors,       (the only audio→GPU
   one <audio> element)        place, never    recomputed          bridge)
                               in React)       per frame)
```

`EngineDriver` runs at frame priority `-1000` so the analysis and the Isnaad
recomputation both complete before any scene reads them; otherwise every scene would
trail the voice by one frame.

Frame-rate state (the audio frame, the six vectors) never passes through React. Only
human-speed state — which verse, which reciter, which phenomenon — lives in the Zustand
store.

### Module I — Calibration protocol (`src/onboarding/`)

Three stages, once per browser:

| Stage | What it does |
|---|---|
| `الإستعاذة` | Opens the audio graph on a user gesture, then sweeps a `BiquadFilterNode` from 12 kHz down to a 55 Hz sub-bass floor over a procedural noise bed. The readout mirrors the scheduled `AudioParam` ramp, so the band is watched actually closing. |
| `إخلع نعليك` | An interactive modal that releases three terrestrial reference locks. It advances on the operator's action, not a timer. |
| `ألواح` | Three overlapping HUD data planes (`فتى / فتية`, `أسفار`, `الصخرة والحوت`), separated in depth rather than in time — they mount simultaneously. |

### Module II — Spatial topology (`src/engine/spatial/`)

- **`الرتق` — `InvertedViewport`**: the universe collapsed into one translucent crystal.
  The observer is stationed outside and cannot enter (`OrbitControls.minDistance`
  exceeds the shell radius). Cosmic rotation is projected inward from the boundary
  toward the core. When a phenomenon occupies the core, the projection recedes to a
  frame and the nucleus stands down.
- **`حبالهم` — `StarTreeRopes`**: tethers between sky coordinate nodes and terrestrial
  anchors. The curve is resolved in the *vertex* shader from endpoint attributes, so
  tension and harmonic order track the analyser at full frame rate across thousands of
  segments. An untriggered rope hangs slack; a triggered one pulls taut.
- **`دار القرار` — `DefensiveAxis`**: lattice and intruder particles share one
  `InstancedMesh`; the shader decides per instance which is which, so the containment
  loop costs nothing per frame on the CPU.

### Module III — The six-vector Isnaad array (`src/engine/isnaad/`)

```
[L1] إسناد الأمر والتشغيل        programmatic trigger; opens the geometry state
       │
       ▼
[L2] إسناد الصوت والربط          the analyser; drives every shader uniform
       ├──────────────┐
       ▼              ▼
[L3] الهدف المادي   [L5] المستمع غير المرئي
       └──────┬───────┘
              ▼
[L6] الصدى الغيبي — رد السلام     closes the circuit; the field expands once
              ▼
[L4] الشاهد الأرضي               the observer's own camera state
```

The dependencies are real, not decorative. L3 and L5 are gated by L2 and cannot exist
without a live vocal anchor. L5 reads a delayed copy of L2 through a ring buffer, so the
unseen audience reacts *after* the voice. L6 builds with verse progress and discharges
at completion. L4 is derived each frame from camera distance, alignment and angular
velocity — witnessing is strongest when still, aligned, and at a contemplative distance.

### Module IV — Twenty phenomena (`src/experiences/`)

Each is a distinct scene with its own GLSL, selecting a different part of the audio
spectrum and a different weighting of the six vectors (`isnaadWeights` in
`src/data/phenomena.ts`).

| # | Scene | Technique |
|---|---|---|
| ١ | الرتق والفتق | vertex inflation gated on sub-bass; seams open past a fracture threshold |
| ٢ | طين لازب | particle cohesion weighted L3 against L5 |
| ٣ | مواقع النجوم | fixed nodes, CPU-precomputed adjacency, energy packets on the links |
| ٤ | السقف المحفوظ | inbound trajectories deflected tangentially at the shell |
| ٥ | البحر المسجور | displaced water body; heat read *through* the column via Beer–Lambert |
| ٦ | مرج البحرين | two fluids advected by separate fields, hard-clipped at the boundary |
| ٧ | الحديد فيه بأس شديد | particles snap onto parameterised dipole field lines |
| ٨ | ظلمات في بحر لُجّي | cumulative layer-by-layer transmittance, not painted darkness |
| ٩ | النجم الثاقب | treble-driven beam; sweep rate follows spectral centroid |
| ١٠ | زُبَر الحديد والصدفين | deterministic bottom-up course assembly, then molten fill |
| ١١ | طي السماء كطي السجل | a real plane→cylinder coordinate transform with nesting turns |
| ١٢ | سراباً بقيعة | shimmer refraction that evaporates as the observer (L4) closes in |
| ١٣ | نور على نور | three additively blended shells; thin-film interference stacks |
| ١٤ | سحاب ثقال | mass integrated across frames; discharge on threshold crossing |
| ١٥ | الشجرة المباركة والزيت | raymarched emission from inside the volume — no light source, no lambert term |
| ١٦ | أوتاداً | root depth proportional to height; anchoring damps plate oscillation |
| ١٧ | ضيقاً حرجاً | genuine camera FOV contraction driven by accumulated altitude |
| ١٨ | كِسَفاً من السماء | per-fragment ballistic integration with a solved time of flight |
| ١٩ | حجراً محجوراً | separation enforced as a per-particle invariant after all forces |
| ٢٠ | الصاعقة | non-indexed geometry; faces separate about their own centroids |

---

## Audio sources

All four reciters play at ayah level, by two different mechanisms.

| Reciter | Source | Mechanism |
|---|---|---|
| محمود خليل الحصري | EveryAyah `Husary_128kbps` | one object per ayah |
| ناصر القطامي | EveryAyah `Nasser_Alqatami_128kbps` | one object per ayah |
| ياسر الدوسري | EveryAyah `Yasser_Ad-Dussary_128kbps` | one object per ayah |
| رعد الكردي | mp3quran (read 221) + ayah timing table | timed window |

**On Raad Al-Kurdi.** No open CDN publishes his recitation as per-ayah objects —
EveryAyah, quran.com v4 and alquran.cloud were all checked and none carries him. Rather
than drop the reciter or silently fall back to surah-length playback, `QuranAudioService`
resolves a *timed window*: the surah stream plus the reciter's published ayah timing
table. `AudioEngine` range-requests the stream, seeks to the ayah's start, and closes the
verse at its end on a dedicated timer. The verse boundary is exact — `verify:audio`
measures it at 5–16 ms against the published spans — so the Isnaad loop opens and closes
per ayah exactly as it does for a per-ayah object.

Two details that matter:

- **Boundaries do not ride the render loop.** A heavy scene can stretch a frame to
  hundreds of milliseconds, which was enough to run the next ayah's opening into the
  current one. The boundary has its own timer and re-arms itself if the stream stalls.
- **Contiguous handoff does not seek.** When one ayah hands off to the next inside the
  same stream, the playhead is already at the right place; seeking anyway forced a
  re-buffer that cost more than the drift it corrected.

Resolution is a chain — operator override, then EveryAyah, then quran.com (whose
recitation ids are *discovered by name* at runtime rather than hardcoded, since the
upstream catalogue is renumbered over time), then the timed window. The first route that
actually produces audio is memoised per reciter in `localStorage`, so steady-state
playback issues one request per ayah.

To point a reciter at your own mirror, set `VITE_AYAH_BASE_HUSARY` (or `…_KURDI`,
`…_QATAMI`, `…_DOSARI`) to a directory serving `SSSAAA.mp3`, or set
`localStorage['isnaad.audio.base.<id>']` at runtime.

Verse text comes from quran.com v4 `quran/verses/uthmani`, falling back to
alquran.cloud's `quran-uthmani` edition. The 114-entry surah table in
`src/data/surahs.ts` was verified against EveryAyah's published `ayahCount` array — all
114 counts match.

---

## Debug bridge

`window.__ISNAAD__` exposes `{ audioEngine, isnaadEngine }`. The engines are module
singletons with no React surface, so this is the only way to inspect or drive them from
the console or from the verification harness.

```js
const { audioEngine, isnaadEngine } = window.__ISNAAD__;
await audioEngine.playVerse('dosari', 18, 60);
isnaadEngine.snapshot.vector;   // Float32Array [L1..L6]
audioEngine.frame.centroid;     // live spectral brightness
```

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | تشغيل / إيقاف الآية |
| `←` | الآية التالية |
| `→` | الآية السابقة |

(Arrow direction follows the RTL reading order.)

---

## Stack

Vite · React 18 · TypeScript (strict) · Three.js · React Three Fiber · drei ·
Web Audio API · Tailwind CSS · Zustand
