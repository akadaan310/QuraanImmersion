/**
 * الرتق — The Inverted Viewport.
 *
 * The universe is collapsed into one translucent crystal sphere and the observer
 * is stationed OUTSIDE it, looking inward. Cosmic rotation, planetary loops and
 * structural dynamics are projected from the inner glass boundary toward the
 * centre core, so the observer reads the cosmos as a contained, bounded object
 * rather than standing inside it.
 *
 * Everything a phenomenon renders is parented under `children` and therefore lives
 * inside that boundary.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_ENGINE_UNIFORMS, GLSL_NOISE, GLSL_UTILS } from '@/shaders/common';
import { createEngineUniforms, syncEngineUniforms } from '@/engine/uniforms';
import { CORE_RADIUS } from '@/engine/EngineDriver';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';

/* ------------------------------------------------------------ glass shell -- */

const shellVertex = /* glsl */ `
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

const shellFragment = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}
${GLSL_NOISE}

varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;

void main() {
  float rim = fresnel(vNormalW, vViewW, 2.4);

  // Crystal facets: a slow noise field frozen into the glass, agitated by L2.
  vec3 p = normalize(vLocal) * 3.4;
  float facets = fbm(p + vec3(0.0, uTime * 0.05, 0.0), 4);
  float veins = smoothstep(0.35, 0.62, abs(facets)) * (0.35 + uIsnaadA.y * 0.9);

  // الرتق: while the command vector is low the shell is sealed and near-opaque;
  // it clarifies as the recitation opens it.
  float seal = 1.0 - clamp(uIsnaadA.x * 0.55 + uLevel * 0.35, 0.0, 0.85);

  vec3 color = uAccent * (rim * 1.5 + veins * 0.6);
  color += vec3(0.03, 0.06, 0.10) * seal * 2.0;
  color += uAccent * uClosure * rim * 2.2;

  float alpha = clamp(rim * 0.72 + veins * 0.18 + seal * 0.10, 0.0, 0.95);
  gl_FragColor = vec4(tonemap(color), alpha);
}
`;

function CrystalShell({ accent, radius }: { accent: string; radius: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => createEngineUniforms(accent), [accent]);

  useFrame(() => {
    if (material.current) syncEngineUniforms(material.current.uniforms);
  });

  return (
    <mesh renderOrder={10}>
      <sphereGeometry args={[radius, 96, 96]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={shellVertex}
        fragmentShader={shellFragment}
        transparent
        depthWrite={false}
        side={THREE.FrontSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/* ------------------------------------------------------ inward projection -- */

const projectionFragment = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}
${GLSL_NOISE}

varying vec3 vLocal;

void main() {
  vec3 dir = normalize(vLocal);

  // Latitude bands = planetary loops projected from the boundary toward the core.
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  float lon = atan(dir.z, dir.x);

  float spin = uTime * (0.06 + uIsnaadA.y * 0.22);
  float bands = sin(lat * 14.0 + spin * 1.7) * 0.5 + 0.5;
  float meridians = sin(lon * 18.0 - spin * 2.4) * 0.5 + 0.5;

  float lattice = pow(bands, 6.0) * 0.5 + pow(meridians, 8.0) * 0.5;
  float drift = fbm(dir * 2.2 + vec3(spin * 0.4), 3) * 0.5 + 0.5;

  float energy = lattice * (0.16 + uIsnaadA.y * 0.55) + drift * 0.07;
  energy += uClosure * 0.28;

  // uIntensity is the framing weight: the boundary is a frame for the phenomenon
  // inside it, so the viewport dims it whenever a scene occupies the core.
  vec3 color = mix(vec3(0.02, 0.05, 0.09), uAccent, clamp(energy, 0.0, 1.0));
  color += uAccent * uTransient * 0.25 * lattice;

  gl_FragColor = vec4(tonemap(color * uIntensity), clamp(energy * 0.55, 0.0, 0.6) * uIntensity);
}
`;

const projectionVertex = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function InwardProjection({
  accent,
  radius,
  intensity,
}: {
  accent: string;
  radius: number;
  intensity: number;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => createEngineUniforms(accent), [accent]);

  useFrame(() => {
    if (!material.current) return;
    syncEngineUniforms(material.current.uniforms);
    material.current.uniforms.uIntensity.value = intensity;
  });

  return (
    <mesh renderOrder={-5}>
      <sphereGeometry args={[radius * 0.985, 72, 72]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={projectionVertex}
        fragmentShader={projectionFragment}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------- core node --- */

function CoreNucleus({ accent }: { accent: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const color = useMemo(() => new THREE.Color(accent), [accent]);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const material = mesh.current.material as THREE.MeshBasicMaterial;
    // The nucleus is the receiving end of every inward projection.
    const isnaad = isnaadEngine.snapshot;
    const drive = 0.22 + 0.9 * (isnaad.l1 * 0.4 + isnaad.l2 * 0.6) + isnaad.closure * 0.5;
    mesh.current.scale.setScalar(0.16 + drive * 0.22);
    mesh.current.rotation.y = clock.elapsedTime * 0.25;
    mesh.current.rotation.x = clock.elapsedTime * 0.13;
    material.opacity = 0.35 + drive * 0.55;
  });

  return (
    <mesh ref={mesh} renderOrder={5}>
      <icosahedronGeometry args={[1, 2]} />
      <meshBasicMaterial color={color} transparent wireframe opacity={0.6} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ root --- */

export function InvertedViewport({
  accent = '#22d3ee',
  radius = CORE_RADIUS,
  children,
}: {
  accent?: string;
  radius?: number;
  children?: ReactNode;
}) {
  // A phenomenon occupies the core: the nucleus stands down and the boundary
  // projection recedes to a frame, so the scene is what the observer reads.
  const occupied = Boolean(children);

  return (
    <group>
      <InwardProjection accent={accent} radius={radius} intensity={occupied ? 0.42 : 1} />
      {!occupied && <CoreNucleus accent={accent} />}
      {children}
      <CrystalShell accent={accent} radius={radius} />
    </group>
  );
}
