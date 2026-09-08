/**
 * ١١ — طي السماء كطي السجل
 * A spatial grid rolled into a scroll. The fold is a genuine coordinate
 * transform in the vertex shader: the flat sheet is remapped onto a cylinder of
 * shrinking radius, so the grid does not fade away — it is taken up.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;
varying float vFold;
varying float vRolled;

void main() {
  vUv = uv;

  // The fold advances with the verse and is pulled tighter by the low band.
  float fold = clamp(uProgress * 0.75 + uIsnaadA.x * 0.2 + uBass * 0.25, 0.0, 1.0);
  vFold = fold;

  vec3 p = position;
  float sheetLength = 3.0;
  float u = (p.x + sheetLength * 0.5) / sheetLength; // 0 at the free edge, 1 at the spindle

  // Everything to the right of the fold front has already been taken up.
  float front = 1.0 - fold;
  float rolled = smoothstep(front + 0.02, front - 0.02, u);
  vRolled = rolled;

  if (rolled > 0.0) {
    // Arc length past the front determines the wrap angle; radius shrinks as the
    // scroll tightens, so successive turns nest instead of overlapping.
    float arc = (front - u) * sheetLength;
    float radius = 0.34 + 0.10 * (1.0 - fold);
    float angle = arc / max(radius, 0.05);

    vec3 spindle = vec3(-sheetLength * 0.5 + front * sheetLength, radius, 0.0);
    float turnRadius = radius * (1.0 - 0.06 * angle / TAU);

    vec3 curled = vec3(
      spindle.x + sin(angle) * turnRadius,
      spindle.y - cos(angle) * turnRadius,
      p.z
    );
    p = mix(p, curled, rolled);
  }

  // Residual spacetime ripple in the not-yet-folded sheet.
  p.y += (1.0 - rolled) * snoise(vec3(position.xz * 1.6, uTime * 0.3)) * (0.03 + uMid * 0.12);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;
varying float vFold;
varying float vRolled;

void main() {
  // Grid ruling of the record itself.
  vec2 cell = fract(vUv * vec2(64.0, 32.0)) - 0.5;
  float line = 1.0 - smoothstep(0.0, 0.06, min(abs(cell.x), abs(cell.y)));

  float ink = 0.10 + line * (0.55 + uIsnaadA.y * 1.2);

  vec3 flat_ = mix(vec3(0.02, 0.04, 0.08), uAccent, ink);
  vec3 curled = mix(vec3(0.06, 0.05, 0.03), vec3(0.95, 0.82, 0.55), ink * 0.8);

  vec3 color = mix(flat_, curled, vRolled);

  // The fold front burns as space is taken up.
  float frontHeat = exp(-pow((vRolled - 0.5) * 6.0, 2.0)) * (0.4 + uTransient * 1.6);
  color += uAccent * frontHeat;
  color += uAccent * uClosure * 0.5;

  gl_FragColor = vec4(tonemap(color * uIntensity * (0.5 + vFold * 0.7)), 1.0);
}
`;

export function TayySijillScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh rotation={[-Math.PI / 2.6, 0, 0]}>
      <planeGeometry args={[3, 2, 260, 120]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
