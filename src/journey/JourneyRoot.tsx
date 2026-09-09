/**
 * The journey — one canvas, one continuous flight, no routes.
 *
 * The application is a single scene now. There is no navigation between pages
 * because there is nothing to navigate to: the universe opens automatically and
 * keeps opening, and the twenty phenomena are stations along it rather than
 * destinations chosen from a list.
 *
 * WHAT STANDS AT A STATION
 * ------------------------
 * Every one of the twenty scenes is preserved exactly as authored — same GLSL,
 * same analyser-driven uniforms, same six-vector weighting. What changed is
 * where they are: each is mounted at its waypoint on السيارة, scaled to the
 * station, met in flight and left in flight. Nothing about the research is
 * discarded; it is placed.
 *
 * FRAME ORDER
 * -----------
 * `EngineDriver` still runs at priority −1000, so the analysis and the six
 * vectors are complete before any scene reads them. The navigator steps just
 * after it, at −900, so the leg is current before the rig places the camera at
 * default priority. Anything that reads the camera reads a camera that has
 * already moved this frame.
 */

import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AdaptiveDpr, AdaptiveEvents, Preload } from '@react-three/drei';
import * as THREE from 'three';

import { EngineDriver } from '@/engine/EngineDriver';
import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { EXPERIENCE_SCENES } from '@/experiences';
import { PHENOMENON_BY_ID } from '@/data/phenomena';
import { StarTreeRopes } from '@/engine/spatial/StarTreeRopes';
import { Earth } from '@/cosmos/Earth';
import { Sky } from '@/cosmos/Sky';
import { Shells } from '@/cosmos/Shells';
import { useSession, activePhenomenon } from '@/state/store';

import { JourneyRig, STATION_SCALE, Track, stationPosition } from './JourneyRig';
import { OrientationField } from './OrientationField';
import { createNavigator, orientationsVisible, type NavState } from './AutoNavigator';
import { orientationsFor } from './orientations';
import { shellOf, waypointAhead, type Waypoint } from './waypoints';

/** The scenes are authored around a core of this radius. */
const SCENE_CORE = 3.2;

/**
 * Steps the navigator once per frame and publishes the result.
 *
 * The state object is mutated in place and never copied into React: it changes
 * sixty times a second and every one of its consumers reads it from a ref inside
 * a `useFrame`. Putting it in state would re-render the whole tree at frame rate
 * for values no DOM node displays.
 */
function NavigatorDriver({ index, onLeg }: { index: number; onLeg: (state: NavState) => void }) {
  const navigator = useMemo(() => createNavigator(), []);

  useFrame((_, delta) => {
    const frame = audioEngine.frame;
    onLeg(navigator.step({
      dt: delta,
      progress: frame.progress,
      executing: isnaadEngine.snapshot.executing,
      closure: isnaadEngine.snapshot.closure,
      index,
    }));
  }, -900);

  return null;
}

/** The phenomenon standing at the current waypoint, placed and scaled. */
function Station({ waypoint, phenomenon }: { waypoint: Waypoint; phenomenon: keyof typeof EXPERIENCE_SCENES }) {
  const Scene = EXPERIENCE_SCENES[phenomenon];
  const accent = PHENOMENON_BY_ID[phenomenon].accent;
  const position = useMemo(() => stationPosition(waypoint), [waypoint]);

  return (
    <group position={position} scale={STATION_SCALE}>
      <Scene accent={accent} />
      {/*
        حبالهم — the tethers, kept from the spatial module and finally in the
        place they describe: between the station standing off the surface and the
        vehicle turning beneath it.
      */}
      <StarTreeRopes accent={accent} radius={SCENE_CORE * 0.92} />
    </group>
  );
}

function Journey() {
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const waypoint = useSession((state) => state.waypoint);
  const phenomenon = useSession((state) => activePhenomenon(state));
  const orientation = useSession((state) => state.orientation);
  const focused = useSession((state) => state.focused);
  const playing = useSession((state) => state.playing);
  const adopt = useSession((state) => state.adopt);

  const accent = PHENOMENON_BY_ID[phenomenon].accent;

  // The leg is flown FROM the previous ayah's waypoint. Deriving it rather than
  // storing it means a jump — the CLI selecting an arbitrary verse — still
  // produces a real great circle from wherever the journey logically was.
  const previous = useMemo(() => waypointAhead(surah, ayah, -1), [surah, ayah]);

  /** Mutated by the navigator each frame; read by the rig and the shells. */
  const nav = useRef<NavState>({
    phase: 'departure', leg: 0, altitude: 2.6, bank: 0, shell: 0, discharge: 0, legsFlown: 0,
  });
  const core = useRef(stationPosition(waypoint));

  // These two DO drive React, at human speed only: the markers appear once per
  // leg and the track's progress is re-read by the shader, not by the DOM.
  const [markersVisible, setMarkersVisible] = useState(false);
  const [climb, setClimb] = useState(0);

  const onLeg = useCallback((state: NavState) => {
    nav.current = state;
    const shouldShow = orientationsVisible(state);
    // setState is idempotent in React only for identical values, so this guard
    // is what keeps a per-frame callback from queueing sixty renders a second.
    setMarkersVisible((current) => (current === shouldShow ? current : shouldShow));
    const rung = shellOf(waypoint.index) + state.shell;
    setClimb((current) => (Math.abs(current - rung) < 0.01 ? current : rung));
  }, [waypoint.index]);

  const offered = useMemo(
    () => orientationsFor(phenomenon, playing),
    [phenomenon, playing],
  );

  const onStation = useCallback((position: THREE.Vector3) => {
    core.current.copy(position);
  }, []);

  return (
    <>
      {/* L4 is measured against the station, so the observer's proximity means
          proximity to the phenomenon being witnessed — not to the world origin. */}
      <EngineDriver core={core.current} />
      <NavigatorDriver index={waypoint.index} onLeg={onLeg} />

      <JourneyRig
        nav={nav.current}
        waypoint={waypoint}
        previous={previous}
        orientation={orientation}
        cedeFov={phenomenon === 'dayyiq-haraj'}
        onStation={onStation}
      />

      <Sky />
      <Shells accent={accent} climb={climb} />
      <Earth accent={accent} />
      <Track from={previous} to={waypoint} progress={nav.current.leg} accent={accent} />

      <Suspense fallback={null}>
        <Station waypoint={waypoint} phenomenon={phenomenon} />
      </Suspense>

      <OrientationField
        station={core.current}
        offered={offered}
        adopted={orientation}
        focused={focused}
        visible={markersVisible}
        onAdopt={adopt}
      />

      <Preload all />
    </>
  );
}

export function JourneyRoot() {
  return (
    <Canvas
      // The far plane has to clear the celestial sphere at 640 with room for the
      // outermost shell; the near plane is as far out as it can be without
      // clipping the station, because the depth buffer's precision is spent
      // almost entirely between near and 10× near.
      camera={{ position: [0, 1.6, 4.2], fov: 58, near: 0.02, far: 4000 }}
      // Capped at 2: a modern Galaxy reports 3–3.5, and rendering twenty
      // full-screen shader passes at 3.5× costs more than it can possibly show
      // on a panel the width of a hand.
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        // The scenes are additive and already run hot; a tone map keeps the
        // bright cores of ٱلنور and ٱلصاعقة from clipping to flat white.
        toneMapping: THREE.ACESFilmicToneMapping,
        alpha: false,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color('#01030a'), 1);
      }}
    >
      <AdaptiveDpr pixelated />
      <AdaptiveEvents />
      <Journey />
    </Canvas>
  );
}
