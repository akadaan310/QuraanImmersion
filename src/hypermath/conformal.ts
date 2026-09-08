/**
 * conformal.ts — the conformal geometry of QuranSpace.
 *
 * Ported from the verified Python engine. Two results are load-bearing and both
 * are machine-checked in __tests__/hypermath.test.ts:
 *
 * 1. THE RADIAL INVERSION IS AN INVOLUTION.
 *
 *        x  ->  x / ( ||x||^2 * lambda )
 *
 *    Let y = x/(lambda ||x||^2), so ||y|| = 1/(lambda ||x||). Then
 *        y/(lambda ||y||^2) = [x/(lambda||x||^2)] * lambda ||x||^2 = x .
 *    The map is its own inverse for EVERY lambda > 0. This is what makes the
 *    super-critical phase "inward": it exchanges the neighbourhood of the
 *    origin with the neighbourhood of infinity, and applying it twice returns
 *    the observer exactly where they started.
 *
 * 2. IT IS CONFORMAL, WITH FACTOR 1/(lambda ||x||^2).
 *
 *        J = (1/(lambda r^2)) ( I - 2 x x^T / r^2 )
 *
 *    where (I - 2 x_hat x_hat^T) is a Householder reflection, hence orthogonal.
 *    So J^T J = (lambda r^2)^-2 I: angles are preserved, all lengths scale by
 *    the same factor, and det J < 0 — inversion reverses orientation.
 *
 * The singularity at x = 0 is geometrically correct (the origin maps to the
 * point at infinity) and is raised, never returned as Infinity.
 */

/** Below this radius, 1/r^2 itself overflows and the site is genuinely singular. */
export const MIN_RADIUS = 1e-150;

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * x -> x / (||x||^2 * lambda), in the plane.
 * @throws if the point is at the origin, which maps to infinity.
 */
export function conformalInversion2D(p: Vec2, lambda: number): Vec2 {
  if (lambda <= 0) throw new Error(`lambda must be > 0, got ${lambda}`);
  const r2 = p.x * p.x + p.y * p.y;
  if (r2 < MIN_RADIUS * MIN_RADIUS) {
    throw new Error('conformal inversion is singular at the origin');
  }
  const scale = 1 / (r2 * lambda);
  return { x: p.x * scale, y: p.y * scale };
}

/** The conformal factor Omega = 1/(lambda r^2) by which the inversion scales lengths. */
export function inversionConformalFactor(radius: number, lambda: number): number {
  return 1 / (lambda * radius * radius);
}

/**
 * The radius fixed by the inversion: ||x|| = 1/sqrt(lambda).
 * Inside it, points are thrown outward; outside it, drawn inward. This is the
 * sphere the two seas' coalescence is measured against.
 */
export function inversionFixedRadius(lambda: number): number {
  return 1 / Math.sqrt(lambda);
}

/**
 * ln Omega for the 'well' profile: Omega = 1 + (lambda - 1) e^{-r^2}.
 * Held in log form so Omega^N cannot overflow at large N.
 */
export function logOmegaWell(radius: number, lambda: number): number {
  return Math.log1p((lambda - 1) * Math.exp(-radius * radius));
}

/**
 * Ricci scalar of a conformally flat metric g_ij = Omega^2 delta_ij:
 *
 *      R = -Omega^-2 [ 2(N-1) Lap(phi) + (N-1)(N-2) |grad phi|^2 ],  phi = ln Omega
 *
 * Verified against the exact closed form: the unit N-sphere in stereographic
 * coordinates, Omega = 2/(1+r^2), must give R = N(N-1) at every radius.
 */
export function ricciScalarSphere(radius: number, N: number): number {
  const r2 = radius * radius;
  const phiLaplacian = (-2 * N) / (1 + r2) + (4 * r2) / ((1 + r2) * (1 + r2));
  const gradSq = (4 * r2) / ((1 + r2) * (1 + r2));
  const omegaSq = 4 / ((1 + r2) * (1 + r2));
  return -(1 / omegaSq) * (2 * (N - 1) * phiLaplacian + (N - 1) * (N - 2) * gradSq);
}
