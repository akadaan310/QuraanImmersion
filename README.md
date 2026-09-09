# محرك الإسناد المعرفي الانغماسي
### Isnaad-Cognitive Immersion Engine — سِيرُوا۟ فِى ٱلْأَرْضِ

An automatic, endless traversal of a real universe, driven by ayah-level Quranic
recitation. The Earth is السيارة — the vehicle the observer is aboard, not a
scene to look at. Each ayah is a leg across it. Audio is fetched one verse at a
time, analysed live with the Web Audio API, and the resulting measurement drives
every shader parameter, geometry deformation, particle density and light in the
field.

The observer does not steer. The journey opens by itself and does not stop.

---

## Hard constraints

These are enforced, not merely intended.

**1. No translations, anywhere.**
The interface renders original Arabic only — Uthmani script for verse text,
Arabic for every label, Arabic-Indic numerals for every counter.
`QuranTextService` rejects any payload containing Latin characters at runtime
(`assertArabicOnly`), and `scripts/check-no-translation.mjs` fails the build if a
translation or tafsir resource, parameter, or field is ever introduced. Even the
stars are labelled with their own Arabic names — الدَّبَران, النَّسْر الطائِر,
إبْط الجَوْزاء — which is what those names originally are.

**2. Audio is bound to a single ayah.**
Every playback path resolves and plays exactly one verse. The transport has no
surah-length mode, because the Isnaad runtime opens a state (L1) and closes it
(L6) once per ayah and needs discrete verse boundaries to do so.

**3. The analyser drives the visuals.**
`syncEngineUniforms` is the only path from audio to the GPU. Nothing in the
twenty scenes animates on wall-clock time alone; they are all functions of what
the `AnalyserNode` measured this frame.

**4. The sky is the real sky.**
Every celestial position comes from the machine's clock through
`src/astro/ephemeris.ts`. The Earth's terminator falls where it actually falls
right now; the Moon carries its real illuminated fraction; the star field turns
once per sidereal day because that is how long it takes. The one invented
population — a procedural deep field, for depth — is drawn dimmer than the
faintest catalogued star and is documented as invented where it is defined.

**5. There is no interface except the orientations.**
No transport bar, no picker, no menu, no settings, no routes. Two gestures
exist: a **swipe** moves the focus between the isnaad orientations this ayah
offers, and a **tap** adopts one. That is the entire input surface.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
```

The first tap opens the AudioContext — browsers will not start audio without a
gesture — and the same tap begins the journey. There is no splash screen.

```bash
npm run build          # typecheck + production bundle
npm run preview        # serve the build on :4173
```

**On a phone**, the engine also runs entirely from Termux, built and served on
the device and rendered by the phone's own browser, with a bridge in both
directions. See [`termux/README.md`](termux/README.md).

```bash
bash termux/install.sh
isnaad up                 # build, serve, open the browser, hold the wake lock
isnaad orient l5          # adopt a standpoint from the terminal
isnaad watch              # the live six-vector, rendered in the terminal
```

### Verification

```bash
npm run verify              # no-translation guard + typecheck + unit tests
npm run verify:scenes       # every shader compiles AND rasterises AND is distinct
npm run verify:orientations # every control is reachable, on every viewport
npm run verify:audio        # all four reciters play, bounded to one ayah
npm run verify:all
npm run termux:test         # the CLI bridge, no phone required
```

`verify:scenes` stands the journey at each of the twenty phenomena in a real
WebGL context (SwiftShader, so it works without a GPU) and fails on a shader
compile error, a runtime error, a scene that draws nothing, or two scenes whose
frames are indistinguishable — the last of which is what catches a scene that
silently rendered only the background.

`verify:orientations` exists because the orientation markers are the only
controls in the application. A marker rendered outside the viewport is not a
layout blemish; it is a control the observer cannot reach, and it is invisible to
every other check — the DOM node exists, the scene renders, nothing throws. It
asserts that every marker is on screen, tappable and non-overlapping across
every standpoint, both phases of a leg, and three viewport shapes.

---

## The journey

```
        ┌─ ayah ─┐
        │        ▼
        │   waypointOf()  ──►  a point on السيارة, and the phenomenon standing there
        │        │
        │        ▼
        │   AutoNavigator  ──►  leg, altitude, bank, shell, closure discharge
        │        │
        │        ▼
        │   JourneyRig     ──►  where the observer actually is, this frame
        │        │
        └────────┴──────────►  the station's scene, the Earth, the sky, the ladder
```

### سِيرُوا۟ فِى ٱلْأَرْضِ — the traversal

Each ayah is assigned a point on the sphere by a Fibonacci (golden-angle)
lattice over all 6236 ayat, permuted by a stride coprime to that total. This is a
traversal ORDER — a way of walking the whole Earth without repeating and without
bunching at the poles. It is not a claim that an ayah belongs to a place, and
nothing in the interface says otherwise.

Three properties, each tested:

| | |
|---|---|
| **equal area** | latitudes are drawn uniformly in sin φ, so waypoint density per square kilometre is constant. Half of all waypoints lie within ±30° of the equator, because half the sphere's area does. |
| **no period** | the longitude step is the golden angle, irrational in units of a turn, so the sequence never falls into a repeating ring. |
| **real legs** | the stride decorrelates consecutive latitudes. Without it the first fifty ayat all land inside the Arctic, a few degrees apart — fifty short hops around the north pole is not سير. The shortest leg is now over 60° of arc. |

The phenomenon at a waypoint is bound by the ayah's own anchors first: 21:30 is
an anchor of الرتق والفتق, so standing there gives that scene and the readout
marks it ⟡ as a real binding. Only where no anchor matches does the index
decide, and the waypoint reports that it fell through rather than hiding it.

### The infinite ladder

Every seven legs the journey climbs a shell: the structure travelled so far
recedes and a wider one resolves around it.

The naive version multiplies a scale at each climb and dies — after a few dozen
shells the coordinates exceed what a 32-bit float can space apart and the scene
shears. It takes an hour of watching to hit, which is worse than hitting it
immediately, because it looks like a corruption rather than a limit.

This is a **treadmill**: a fixed band of radii holds five resident shells, the
climb slides them inward together, and a shell passing the inner edge is reused
at the outer edge with the next index. No coordinate ever grows. The shell
*index* keeps counting — it is what the readout shows — while the geometry is
five reused rings. A test runs the navigator for a simulated week and asserts
every quantity stays bounded.

### الإسنادات — the orientations

The six-vector array already describes six standpoints on the same recitation.
An orientation adopts one: the camera moves to where that vector stands, and the
vector's weight in the scene is raised so the field is genuinely being read from
there.

Which orientations appear is **not a fixed menu**. Each phenomenon carries an
emphasis profile, and the options offered are that ayah's strongest vectors, in
its own order. L3 and L5 are gated on L2 in the engine — they cannot exist
without a live vocal anchor — so they are withheld while nothing is sounding
rather than offered and refused.

Adopting a standpoint conserves the array's total weight. Without that
renormalisation, adopting an orientation would raise the total energy and every
scene would simply get brighter — which reads as a gain control, not as a change
of standpoint.

| | standpoint | where it stands |
|---|---|---|
| `أمر` | إسناد الأمر والتشغيل | at the moment the state opened |
| `صوت` | إسناد الصوت والربط | inside the voice, at the analyser |
| `مادة` | الهدف المادي | at the surface, where the response lands |
| `شاهد` | الشاهد الأرضي | on the Earth, the vehicle underfoot |
| `خفي` | المستمع غير المرئي | behind the voice by the ring buffer's delay |
| `صدى` | الصدى الغيبي — ردّ السلام | at the point of closure |

The markers are DOM elements positioned in 3D. Arabic needs contextual shaping
and bidirectional layout, which the browser does correctly and a glyph atlas
does not; and a DOM node is a real touch target with the platform's own hit-slop.
Their ring is specified in normalised device coordinates and unprojected, not
computed from a world-space radius — whether a world radius lands on screen
depends on distance, field of view and aspect together, and all three change
continuously through a flight.

---

## Real-time data

Everything in `src/astro/` is computed, never fetched and never faked.

| quantity | source | stated error |
|---|---|---|
| Earth rotation | IERS 2010 ERA, linear in UT1 | UT1−UTC ignored ⇒ ≈0.004° |
| Sun | Meeus ch. 25, low precision | ≈0.01° in longitude, 1950–2050 |
| Moon | Meeus ch. 47, abridged | ≈0.3° in longitude, ≈1000 km |
| stars | embedded catalogue, J2000 | ≈0.1°; proper motion ignored |
| geodesy | spherical, mean radius | ≈0.3% of a distance |

The readout shows the waypoint's coordinates, the **true local solar time** at
that longitude (not a timezone — a waypoint mid-Pacific does not have one),
whether the Sun is up there right now, the Moon's phase, the great-circle
bearing to the Kaaba, and the shell index.

These are for orientation. They are not fit for astrometry, navigation, or
determining prayer times, and the modules say so where they are defined. The
tests pin them to values from outside the codebase — the standard epoch, the
2026 equinoxes and solstices, perihelion and aphelion distances, the sidereal
day, Pogson's ratio, published great-circle distances and known qibla bearings.

---

## The six-vector Isnaad array

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

The dependencies are real, not decorative. L3 and L5 are gated by L2 and cannot
exist without a live vocal anchor. L5 reads a delayed copy of L2 through a ring
buffer, so the unseen audience reacts *after* the voice. L6 builds with verse
progress and discharges at completion. L4 is derived each frame from camera
distance, alignment and angular velocity — and it is measured **against the
station**, not the world origin, so witnessing means proximity to the phenomenon
being witnessed.

`EngineDriver` runs at frame priority −1000 so the analysis and the Isnaad
recomputation both complete before any scene reads them; the navigator steps at
−900, so the leg is current before the rig places the camera. Frame-rate state —
the audio frame, the six vectors, the navigator — never passes through React.

---

## The twenty phenomena

Each is a distinct scene with its own GLSL, selecting a different part of the
audio spectrum and a different weighting of the six vectors. They are unchanged
from when they were authored; what changed is that they are no longer
destinations picked from a list. Each stands at its waypoint, is met in flight,
and is left in flight.

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

ضيقاً حرجاً drives the camera's field of view itself — the contraction of the
view *is* the phenomenon — so while it stands, the rig stops writing the FOV and
resumes from wherever the scene leaves it. Two systems writing one value every
frame is a flutter, not a compromise.

حبالهم (`StarTreeRopes`) is mounted at every station, finally in the place it
describes: tethers between the station standing off the surface and the vehicle
turning beneath it.

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
EveryAyah, quran.com v4 and alquran.cloud were all checked and none carries him.
Rather than drop the reciter or silently fall back to surah-length playback,
`QuranAudioService` resolves a *timed window*: the surah stream plus the
reciter's published ayah timing table. `AudioEngine` range-requests the stream,
seeks to the ayah's start, and closes the verse at its end on a dedicated timer.
The verse boundary is exact — `verify:audio` measures it at 5–16 ms against the
published spans — so the Isnaad loop opens and closes per ayah exactly as it does
for a per-ayah object.

Two details that matter:

- **Boundaries do not ride the render loop.** A heavy scene can stretch a frame
  to hundreds of milliseconds, which was enough to run the next ayah's opening
  into the current one. The boundary has its own timer and re-arms itself if the
  stream stalls.
- **Contiguous handoff does not seek.** When one ayah hands off to the next
  inside the same stream, the playhead is already at the right place; seeking
  anyway forced a re-buffer that cost more than the drift it corrected.

Resolution is a chain — operator override, then EveryAyah, then quran.com (whose
recitation ids are *discovered by name* at runtime rather than hardcoded, since
the upstream catalogue is renumbered over time), then the timed window. The
first route that actually produces audio is memoised per reciter in
`localStorage`, so steady-state playback issues one request per ayah.

A route that fails everywhere ends that leg, not the journey: the traversal moves
on to the next ayah rather than stranding the observer at a silent station.

Verse text comes from quran.com v4 `quran/verses/uthmani`, falling back to
alquran.cloud's `quran-uthmani` edition. The 114-entry surah table in
`src/data/surahs.ts` was verified against EveryAyah's published `ayahCount`
array — all 114 counts match, and they sum to 6236.

---

## Debug bridge

`window.__ISNAAD__` exposes `{ audioEngine, isnaadEngine, session, phenomena,
reciters }`. Since the interface offers nothing but the orientations, this is the
only way to drive the journey — from the console, from the verification harness,
or from the Termux CLI over the bridge in `termux/`.

`session` is the store itself rather than a snapshot, because every external
driver needs to *act* on human-speed state, not merely read it.

```js
const { session, audioEngine, isnaadEngine } = window.__ISNAAD__;
session.getState().selectVerse(18, 60);
session.getState().adopt('l5');          // المستمع غير المرئي
session.getState().pinPhenomenon('noor-ala-noor');   // released at the next verse
isnaadEngine.snapshot.vector;            // Float32Array [L1..L6]
audioEngine.frame.centroid;              // live spectral brightness
```

---

## Layout

```
src/
  astro/        ephemeris, geodesy, the star catalogue — pure, and tested
  journey/      waypoints, orientations, the navigator, the rig, the interface
  cosmos/       السيارة, the sky, the shell ladder
  engine/       the six-vector array, the uniform bridge, the spatial modules
  experiences/  the twenty phenomena, unchanged
  audio/        one AudioContext, one <audio>, the analyser
  services/     ayah audio resolution and Uthmani text
  hypermath/    the two clock seas, conformal inversion, log-space
termux/         the Android CLI, the Termux ⇄ browser bridge, the root takeover
tri-reality-os/ SANDBOX-LOWER (Termux runtime) and SANDBOX-UPPER (Vercel ingest)
```

## Stack

Vite · React 18 · TypeScript (strict) · Three.js · React Three Fiber · drei ·
Web Audio API · Tailwind CSS · Zustand
