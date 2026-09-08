/**
 * The bridge between the analysed audio frame and GLSL.
 *
 * `syncEngineUniforms` is the ONLY place audio reaches the GPU. Scenes declare
 * uniforms with `createEngineUniforms` and never touch the AudioEngine directly,
 * which keeps all twenty phenomena in lockstep on the same measurement.
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';

export type EngineUniforms = Record<string, THREE.IUniform>;

export function createEngineUniforms(accent = '#22d3ee', extra: EngineUniforms = {}): EngineUniforms {
  return {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uPeak: { value: 0 },
    uTransient: { value: 0 },
    uFlux: { value: 0 },
    uCentroid: { value: 0 },
    uSubBass: { value: 0 },
    uBass: { value: 0 },
    uLowMid: { value: 0 },
    uMid: { value: 0 },
    uHighMid: { value: 0 },
    uTreble: { value: 0 },
    uProgress: { value: 0 },
    uClosure: { value: 0 },
    uIntensity: { value: 1 },
    uAccent: { value: new THREE.Color(accent) },
    uIsnaadA: { value: new THREE.Vector3() },
    uIsnaadB: { value: new THREE.Vector3() },
    ...extra,
  };
}

/** Copy this frame's measurement into a uniform block. Cheap, allocation-free. */
export function syncEngineUniforms(uniforms: EngineUniforms): void {
  const frame = audioEngine.frame;
  const isnaad = isnaadEngine.snapshot;

  uniforms.uTime.value = frame.time;
  uniforms.uLevel.value = frame.level;
  uniforms.uPeak.value = frame.peak;
  uniforms.uTransient.value = frame.transient;
  uniforms.uFlux.value = frame.flux;
  uniforms.uCentroid.value = frame.centroid;
  uniforms.uSubBass.value = frame.subBass;
  uniforms.uBass.value = frame.bass;
  uniforms.uLowMid.value = frame.lowMid;
  uniforms.uMid.value = frame.mid;
  uniforms.uHighMid.value = frame.highMid;
  uniforms.uTreble.value = frame.treble;
  uniforms.uProgress.value = frame.progress;
  uniforms.uClosure.value = isnaad.closure;

  (uniforms.uIsnaadA.value as THREE.Vector3).set(isnaad.l1, isnaad.l2, isnaad.l3);
  (uniforms.uIsnaadB.value as THREE.Vector3).set(isnaad.l4, isnaad.l5, isnaad.l6);
}

/**
 * Declare a scene's uniform block and keep it synchronised.
 * `extraFactory` runs once; put scene-specific uniforms there.
 */
export function useEngineUniforms(accent: string, extraFactory?: () => EngineUniforms): EngineUniforms {
  const uniforms = useMemo(
    () => createEngineUniforms(accent, extraFactory ? extraFactory() : {}),
    // Scene identity is the accent: a new phenomenon remounts with a new block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accent],
  );

  useFrame(() => syncEngineUniforms(uniforms));

  return uniforms;
}

/** Convenience for scenes that also need a raw idle animation when audio is silent. */
export function idleFloor(value: number, floor = 0.06): number {
  return Math.max(value, floor);
}
