/**
 * ٦ — مرج البحرين يلتقيان — QURANSPACE
 *
 * This is the merge point of the whole system, and the only scene whose
 * geometry is NOT an approximation.
 *
 * Two independent proper-time ensembles — بحر الساعات السفلى (the local
 * runtime's clocks) and بحر الساعات العليا (the distributed runtime's clocks) —
 * are advanced every frame by the verified engine in `@/hypermath`, each under
 * its OWN lambda, and uploaded to the GPU as two separate float textures. The
 * shader never blends across the barrier: it selects a texture by side, so
 * there is no code path along which one sea's proper time can reach the other.
 *
 * لا يبغيان is therefore a property of the data structure rather than of the
 * shading. `DualSeaContinuum.verifyBarrier()` counts cells on the wrong side
 * (always 0) and the test suite carries an isolation witness proving that
 * hammering one sea with taps leaves the other's tau BIT-IDENTICAL to a control
 * run.
 *
 * TAP: pointer or touch anywhere on a sea opens a clock well there. The same
 * gesture does opposite things depending on that sea's phase —
 *   sub-critical  nothing (uniform flow admits no local dilation)
 *   collapse      the well FREEZES its neighbourhood (density crosses rho_crit)
 *   super-critical the well ACCELERATES it without bound (radius -> 0)
 * which is the clearest way to feel the three-phase lifecycle by hand.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import { audioEngine } from '@/audio/AudioEngine';
import {
  DualSeaContinuum, BARRIER_HALF_WIDTH, BASIN_EXTENT,
} from '@/hypermath/DualSea';
import { useSession } from '@/state/store';
import type { SceneProps } from './types';

const GRID = 72;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

uniform sampler2D uLowerTex;
uniform sampler2D uUpperTex;
uniform float uBarrier;
uniform float uExtent;

varying vec2 vUv;
varying float vWorldX;
varying vec4 vSea;
varying float vSide;

// Map a basin coordinate onto the sampling coordinates of ITS OWN sea. There is
// deliberately no branch that can read the far sea's texture.
vec4 sampleSea(float x, float y) {
  float inner = uBarrier;
  float outer = uExtent;
  float v = (y + outer) / (2.0 * outer);
  if (x < 0.0) {
    float u = (-x - inner) / (outer - inner);
    return texture2D(uLowerTex, vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0)));
  }
  float u = (x - inner) / (outer - inner);
  return texture2D(uUpperTex, vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0)));
}

void main() {
  vUv = uv;
  float x = (uv.x * 2.0 - 1.0) * uExtent;
  float y = (uv.y * 2.0 - 1.0) * uExtent;
  vWorldX = x;
  vSide = x < 0.0 ? -1.0 : 1.0;

  vec3 p = position;
  if (abs(x) > uBarrier) {
    vSea = sampleSea(x, y);
    // Relief carries the clock RATE: a racing core stands proud, a frozen
    // region lies flat. R = normalized ln tau, G = normalized ln rate.
    float relief = vSea.g * (0.10 + uLevel * 0.28) + vSea.r * 0.05;
    p.z += relief;
    // Fine chop, so the surface still reads as water under a still recitation.
    p.z += snoise(vec3(p.xy * 6.0, uTime * 0.4)) * 0.012 * (0.3 + uIsnaadA.y);
  } else {
    vSea = vec4(0.0);
    p.z += sin(y * 24.0 + uTime * 2.0) * 0.006;
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

uniform float uBarrier;
uniform float uExtent;
uniform float uLowerPhase;
uniform float uUpperPhase;

varying vec2 vUv;
varying float vWorldX;
varying vec4 vSea;
varying float vSide;

// Palette per phase, so the eye reads the lifecycle without a legend:
//   0 sub-critical  cold teal      (uniform flow)
//   1 collapse      dim indigo     (clocks stopped)
//   2 super-critical hot amber     (racing inward)
vec3 phaseTint(float phase) {
  if (phase < 0.5) return vec3(0.10, 0.62, 0.68);
  if (phase < 1.5) return vec3(0.24, 0.20, 0.62);
  return vec3(0.95, 0.55, 0.16);
}

void main() {
  float dist = abs(vWorldX);

  // ---- البرزخ ----------------------------------------------------------
  // Not a blend. A hard gate: inside it, neither sea is sampled at all.
  if (dist <= uBarrier) {
    float core = 1.0 - smoothstep(0.0, uBarrier, dist);
    // Interference standing wave: the barrier lights where the seas press on it.
    float press = sin(vUv.y * 90.0 - uTime * 1.6) * 0.5 + 0.5;
    float charge = 0.18 + uIsnaadA.x * 0.5 + uTransient * 0.9;
    vec3 color = mix(uAccent, vec3(1.0), 0.35) * (core * charge * (0.4 + press * 0.8));
    gl_FragColor = vec4(tonemap(color * uIntensity), clamp(core * 0.85, 0.0, 1.0));
    return;
  }

  float phase = vSide < 0.0 ? uLowerPhase : uUpperPhase;
  vec3 tint = phaseTint(phase);

  float lnTau  = vSea.r;   // normalized within THIS sea's own range
  float lnRate = vSea.g;
  float rho    = vSea.b;
  float status = vSea.a;   // 0 ok, 0.5 frozen, 1 singular

  // Depth of water = how much proper time this cell has accumulated.
  vec3 deep    = vec3(0.01, 0.05, 0.10);
  vec3 surface = tint;
  vec3 color = mix(deep, surface, pow(lnTau, 0.65));

  // Rate glows: the faster the clock, the brighter its cell.
  color += tint * pow(lnRate, 2.0) * (0.35 + uIsnaadA.y * 1.1);

  // A frozen cell is unmistakably inert — no glow, no motion, just mass.
  if (status > 0.25 && status < 0.75) {
    color = mix(color, vec3(0.07, 0.07, 0.11), 0.82);
  }
  // A singular cell has left float64 entirely; mark it rather than fake a value.
  if (status >= 0.75) {
    color = mix(color, vec3(1.0, 0.95, 0.85), 0.7);
  }

  // Tap wells read as density above the sea's own baseline.
  color += tint * smoothstep(0.55, 1.0, rho) * 0.55;

  // Salinity banding, so the two bodies never look like one fluid.
  float band = sin((vSide < 0.0 ? vUv.y * 70.0 : vUv.y * 34.0) + uTime * 0.35) * 0.5 + 0.5;
  color *= 0.86 + 0.14 * band;

  color += uAccent * uClosure * 0.30;
  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

/**
 * Build a DataTexture backed by a sea's RGBA float payload.
 *
 * The buffer type is pinned to ArrayBuffer rather than the default
 * ArrayBufferLike: THREE.DataTexture will not accept a possibly-shared buffer.
 */
function makeSeaTexture(payload: Float32Array<ArrayBuffer>, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(payload, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function MarjBahraynScene({ accent }: SceneProps) {
  const lambdaLower = useSession((s) => s.lambdaLower);
  const lambdaUpper = useSession((s) => s.lambdaUpper);
  const setSeaStats = useSession((s) => s.setSeaStats);
  const registerTap = useSession((s) => s.registerTap);

  const continuum = useMemo(() => new DualSeaContinuum(GRID, GRID), []);

  const lowerTex = useMemo(() => makeSeaTexture(continuum.lower.texture, GRID), [continuum]);
  const upperTex = useMemo(() => makeSeaTexture(continuum.upper.texture, GRID), [continuum]);

  const uniforms = useEngineUniforms(accent, () => ({
    uLowerTex: { value: lowerTex },
    uUpperTex: { value: upperTex },
    uBarrier: { value: BARRIER_HALF_WIDTH },
    uExtent: { value: BASIN_EXTENT },
    uLowerPhase: { value: 0 },
    uUpperPhase: { value: 0 },
  }));

  useEffect(() => {
    continuum.setLambda('lower', lambdaLower);
  }, [continuum, lambdaLower]);

  useEffect(() => {
    continuum.setLambda('upper', lambdaUpper);
  }, [continuum, lambdaUpper]);

  useEffect(() => () => {
    lowerTex.dispose();
    upperTex.dispose();
  }, [lowerTex, upperTex]);

  const sinceReport = useRef(0);

  useFrame((_, delta) => {
    const frame = audioEngine.frame;

    // The recitation drives the global tick: coordinate time advances with the
    // voice, and each sea converts it into its own proper time.
    const dt = Math.min(delta, 1 / 20) * (0.35 + frame.level * 1.6);
    continuum.step(dt);
    continuum.writeTextures();
    lowerTex.needsUpdate = true;
    upperTex.needsUpdate = true;

    uniforms.uLowerPhase.value = continuum.lower.stats(0).phase;
    uniforms.uUpperPhase.value = continuum.upper.stats(0).phase;

    // Publish to the HUD at ~6 Hz. Stats walk both grids, so doing it every
    // frame would cost more than the simulation it reports on.
    sinceReport.current += delta;
    if (sinceReport.current > 0.16) {
      sinceReport.current = 0;
      setSeaStats(continuum.stats());
    }
  });

  const handleTap = (event: { stopPropagation: () => void; uv?: THREE.Vector2 }) => {
    event.stopPropagation();
    if (!event.uv) return;
    const x = (event.uv.x * 2 - 1) * BASIN_EXTENT;
    const y = (event.uv.y * 2 - 1) * BASIN_EXTENT;
    const sea = continuum.tap(x, y, 1.6);
    // A tap inside the برزخ returns null — nothing exists there to disturb.
    if (sea) registerTap(sea);
  };

  return (
    <mesh onPointerDown={handleTap} scale={1.9}>
      <planeGeometry args={[2 * BASIN_EXTENT, 2 * BASIN_EXTENT, 256, 256]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
