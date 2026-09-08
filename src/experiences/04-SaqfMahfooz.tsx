/**
 * ٤ — السقف المحفوظ
 * A protective shell that deflects incoming orbital debris. Each fragment runs a
 * full inbound trajectory in the vertex shader and is turned at the shell
 * boundary; the deflection strength is the frame's total acoustic energy, so a
 * loud passage visibly hardens the roof.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const DEBRIS = 900;
const SHELL_RADIUS = 1.7;

const shieldVertex = /* glsl */ `
${GLSL_PRELUDE}
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;

void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const shieldFragment = /* glsl */ `
${GLSL_PRELUDE}
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;

// Hexagonal shell cells: the shield reads as a woven mesh, not a soap bubble.
float hexGrid(vec2 p) {
  p *= vec2(1.1547, 1.0);
  p.x += mod(floor(p.y), 2.0) * 0.5;
  vec2 f = abs(fract(p) - 0.5);
  return max(f.x, f.y * 0.866 + f.x * 0.5);
}

void main() {
  vec3 dir = normalize(vLocal);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  float lon = atan(dir.z, dir.x);

  float cell = hexGrid(vec2(lon * 6.0, lat * 9.0));
  float lattice = smoothstep(0.46, 0.5, cell);

  float rim = fresnel(vNormalW, vViewW, 2.6);
  float charge = 0.18 + uLevel * 0.9 + uIsnaadA.x * 0.5;

  // Impact bloom rides the transient: strikes light the surrounding cells.
  float impact = uTransient * (0.5 + 0.5 * sin(lon * 12.0 + uTime * 6.0));

  vec3 color = uAccent * (lattice * charge * 1.6 + rim * 0.9 + impact * 0.8);
  float alpha = clamp(lattice * (0.22 + charge * 0.5) + rim * 0.35, 0.0, 0.9);
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

const debrisVertex = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aDirection;
attribute float aSeed;
attribute float aSpeed;

varying float vDeflected;
varying float vHeat;

const float SHELL = ${SHELL_RADIUS.toFixed(2)};

void main() {
  // Each fragment falls inward on its own clock, then respawns far out.
  float cycle = fract(uTime * aSpeed * (0.06 + uIsnaadA.x * 0.10) + aSeed);
  float distance = mix(4.2, SHELL, cycle);

  float strength = clamp(uLevel * 1.3 + uIsnaadA.x * 0.6 + uPeak * 0.5, 0.0, 1.0);

  // Deflection begins just above the shell and turns the fragment tangentially.
  float grazing = smoothstep(SHELL + 0.55, SHELL + 0.02, distance);
  vDeflected = grazing * strength;

  vec3 radial = normalize(aDirection);
  vec3 tangent = normalize(cross(radial, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));

  float turn = grazing * strength * 1.25;
  vec3 pos = radial * max(distance, SHELL + 0.015 * strength)
           + tangent * turn * (0.5 + aSeed) * 0.9;

  vHeat = grazing * (0.3 + uTransient * 1.4);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (5.0 + aSeed * 9.0) * (1.0 / max(-mv.z, 0.1)) * (1.0 + vHeat * 2.0);
  gl_Position = projectionMatrix * mv;
}
`;

const debrisFragment = /* glsl */ `
${GLSL_PRELUDE}
varying float vDeflected;
varying float vHeat;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.1, r);

  vec3 cold = vec3(0.45, 0.48, 0.55);
  vec3 hot = mix(vec3(1.0, 0.55, 0.2), uAccent, 0.35);
  vec3 color = mix(cold, hot, clamp(vHeat * 1.6, 0.0, 1.0));

  gl_FragColor = vec4(tonemap(color * (0.7 + vHeat * 2.4)), core * (0.35 + vDeflected * 0.6));
}
`;

export function SaqfMahfoozScene({ accent }: SceneProps) {
  const shieldUniforms = useEngineUniforms(accent);
  const debrisUniforms = useEngineUniforms(accent);

  const debrisGeometry = useMemo(() => {
    const directions = new Float32Array(DEBRIS * 3);
    const seeds = new Float32Array(DEBRIS);
    const speeds = new Float32Array(DEBRIS);
    for (let i = 0; i < DEBRIS; i += 1) {
      const dir = new THREE.Vector3().randomDirection();
      directions[i * 3] = dir.x;
      directions[i * 3 + 1] = dir.y;
      directions[i * 3 + 2] = dir.z;
      seeds[i] = Math.random();
      speeds[i] = 0.6 + Math.random() * 1.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS * 3), 3));
    geo.setAttribute('aDirection', new THREE.BufferAttribute(directions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    return geo;
  }, []);

  return (
    <group>
      <mesh>
        <sphereGeometry args={[SHELL_RADIUS, 84, 84]} />
        <shaderMaterial
          uniforms={shieldUniforms}
          vertexShader={shieldVertex}
          fragmentShader={shieldFragment}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <points geometry={debrisGeometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={debrisUniforms}
          vertexShader={debrisVertex}
          fragmentShader={debrisFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
