/**
 * Shared GLSL chunks.
 *
 * Every phenomenon shader opens with GLSL_ENGINE_UNIFORMS so that the same audio
 * and Isnaad state is addressable by the same names in all twenty scenes.
 */

/** The uniform block written by `syncEngineUniforms` once per frame. */
export const GLSL_ENGINE_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uPeak;
uniform float uTransient;
uniform float uFlux;
uniform float uCentroid;
uniform float uSubBass;
uniform float uBass;
uniform float uLowMid;
uniform float uMid;
uniform float uHighMid;
uniform float uTreble;
uniform float uProgress;
uniform float uClosure;
uniform float uIntensity;
uniform vec3  uAccent;
// x = L1 الأمر, y = L2 الصوت, z = L3 الهدف
uniform vec3  uIsnaadA;
// x = L4 الشاهد, y = L5 المستمع, z = L6 الصدى
uniform vec3  uIsnaadB;
`;

export const GLSL_UTILS = /* glsl */ `
#ifndef ISNAAD_UTILS
#define ISNAAD_UTILS
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

mat2 rot2(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

float fresnel(vec3 normalW, vec3 viewW, float power) {
  return pow(1.0 - clamp(dot(normalize(normalW), normalize(viewW)), 0.0, 1.0), power);
}

vec3 tonemap(vec3 color) {
  color = max(color, vec3(0.0));
  return (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
}
#endif
`;

/** Ashima / Gustavson simplex noise, the workhorse for organic deformation. */
export const GLSL_NOISE = /* glsl */ `
#ifndef ISNAAD_NOISE
#define ISNAAD_NOISE
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}
#endif
`;

/** Prelude injected at the top of every phenomenon shader. */
export const GLSL_PRELUDE = GLSL_ENGINE_UNIFORMS + GLSL_UTILS + GLSL_NOISE;

/** A full-screen triangle vertex shader for raymarched / post-style scenes. */
export const GLSL_SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocalPosition;
void main() {
  vUv = uv;
  vLocalPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
