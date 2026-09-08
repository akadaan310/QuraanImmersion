/**
 * EngineDriver — the head of the frame pipeline.
 *
 * Runs at priority -1000 so the audio analysis and the Isnaad recomputation both
 * complete BEFORE any scene reads them. Without this ordering, scenes would sample
 * a frame that is one tick stale and the visuals would visibly trail the voice.
 *
 * It also derives L4 (الشاهد الأرضي) from the live camera transform: the observer
 * vector is the one coordinate the user authors directly, simply by moving.
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { advanceContinuum } from '@/hypermath/continuum';

/** Radius of the crystal boundary; observer proximity is measured against it. */
export const CORE_RADIUS = 3.2;
const OUTER_RADIUS = CORE_RADIUS * 3.2;

export function EngineDriver({ core = new THREE.Vector3(0, 0, 0) }: { core?: THREE.Vector3 }) {
  const camera = useThree((state) => state.camera);
  const previous = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());
  const toCore = useRef(new THREE.Vector3());
  const agitation = useRef(0);

  useFrame((_, delta) => {
    const frame = audioEngine.analyse();
    const dt = frame.dt || 1 / 60;

    // --- L4: observer coupling ------------------------------------------------
    const distance = camera.position.distanceTo(core);
    const proximity = THREE.MathUtils.clamp(
      (distance - CORE_RADIUS) / Math.max(OUTER_RADIUS - CORE_RADIUS, 1e-3),
      0,
      1,
    );

    camera.getWorldDirection(forward.current);
    toCore.current.copy(core).sub(camera.position).normalize();
    const alignment = THREE.MathUtils.clamp(forward.current.dot(toCore.current), 0, 1);

    const travelled = camera.position.distanceTo(previous.current) / dt;
    previous.current.copy(camera.position);
    const instant = THREE.MathUtils.clamp(travelled / 12, 0, 1);
    agitation.current += (instant - agitation.current) * Math.min(dt * 4, 1);

    isnaadEngine.setObserver({
      proximity,
      alignment,
      agitation: agitation.current,
    });

    isnaadEngine.update(frame);

    // The two clock seas advance last in this callback, because they read both
    // the audio frame and the Isnaad array this frame produced. They run in
    // every scene, not only in مرج البحرين, so the clocks are one continuum
    // rather than a per-scene prop.
    //
    // They are advanced by R3F's REAL elapsed delta, not by the audio frame's
    // dt. frame.dt is derived from the AudioContext clock and is 0 until a user
    // gesture opens one, so the `|| 1/60` fallback above silently measures time
    // in FRAMES: on a slow renderer the seas would drift far behind wall-clock
    // and the whole point of a live sync would be lost. Clamped, because a
    // backgrounded tab returns a delta of many seconds and would otherwise
    // jump the clocks forward in one step.
    advanceContinuum(Math.min(delta, 1 / 15));
  }, -1000);

  return null;
}
