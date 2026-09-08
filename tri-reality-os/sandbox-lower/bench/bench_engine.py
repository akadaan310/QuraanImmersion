#!/usr/bin/env python3
"""Benchmarks for SANDBOX-LOWER. Reports measured numbers on the ACTUAL host.

Run: python3 bench/bench_engine.py
"""
import math
import os
import platform
import shutil
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hilbert_field import FieldSpec, HilbertField, ConformalMetric, hardware_report
from dilation_registry import DilationConfig, DilationRegistry


def timeit(fn, repeats=5):
    """Best-of-N wall time; best-of resists scheduler noise better than a mean."""
    best = math.inf
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - start)
    return best


def bench_field_paths():
    print("\n--- Field operator: cost of each evaluation path ---")
    print(f"{'N':>8} {'Path A (exact)':>16} {'Path B (Hankel)':>17} {'Path C (RQMC 8k)':>18}")
    for N in (10, 100, 1000, 10000, 100000):
        spec = FieldSpec.isotropic(N, 0.0, 0.5)
        field = HilbertField(spec)
        x = np.full(N, 0.01)

        ta = timeit(lambda: field.psi_separable(x, 0.1), repeats=5)
        tb = timeit(lambda: field.psi_radial(0.5, 0.1, n_nodes=2048), repeats=3)
        # RQMC allocates an (M x N) sample block, so cap it where that is sane.
        tc = (timeit(lambda: field.psi_qmc(x, 0.1, n_samples=1 << 13, n_replicates=1),
                     repeats=1) if N <= 10000 else None)
        tc_str = f"{tc*1e3:>15.2f}ms" if tc else f"{'(skipped)':>18}"
        print(f"{N:>8} {ta*1e3:>13.3f}ms {tb*1e3:>14.3f}ms {tc_str}")

    print("\n  Path A is O(N) and exact -- no truncation error at any N.")
    print("  Path B is independent of N (N enters only as a Bessel order).")
    print("  A tensor-product grid at M=64 would need 64^N evaluations:")
    for N in (6, 20):
        print(f"    N={N:>3}: 64^{N} = {64.0**N:.2e} integrand evaluations")


def bench_batch_scaling():
    print("\n--- Batch evaluation: process-parallel speedup ---")
    cores = os.cpu_count() or 1
    N, B = 64, 4000
    spec = FieldSpec.isotropic(N, 0.0, 0.5)
    field = HilbertField(spec)
    rng = np.random.default_rng(0)
    xs = rng.normal(size=(B, N))

    serial = timeit(lambda: field.psi_batch(xs, 0.1, workers=1), repeats=3)
    print(f"{'workers':>9} {'wall':>10} {'speedup':>9} {'points/s':>12}")
    print(f"{1:>9} {serial*1e3:>8.1f}ms {1.0:>8.2f}x {B/serial:>11.0f}")
    for workers in (2, cores):
        if workers <= 1 or workers > cores:
            continue
        wall = timeit(lambda w=workers: field.psi_batch(xs, 0.1, workers=w), repeats=3)
        print(f"{workers:>9} {wall*1e3:>8.1f}ms {serial/wall:>8.2f}x {B/wall:>11.0f}")
    print(f"\n  Host has {cores} cores. Process spawn is ~30ms, so the parallel path")
    print("  is only taken above 256 points -- measured, not assumed (see psi_batch).")


def bench_metric():
    print("\n--- Conformal metric: O(N) contraction vs the dense tensor ---")
    print(f"{'N':>7} {'dense (N^3)':>14} {'contract (N)':>15} {'dense memory':>14}")
    for N in (16, 64, 128):
        metric = ConformalMetric(N, profile="well")
        x = np.random.default_rng(1).normal(size=N)
        v = np.random.default_rng(2).normal(size=N)
        td = timeit(lambda: np.einsum("kij,i,j->k", metric.christoffel(x, 2.0), v, v), repeats=3)
        tc = timeit(lambda: metric.christoffel_contract(x, 2.0, v), repeats=50)
        print(f"{N:>7} {td*1e3:>11.3f}ms {tc*1e6:>12.1f}us {8*N**3/1e6:>11.1f}MB")
    print(f"{5000:>7} {'refused':>14} "
          f"{timeit(lambda: ConformalMetric(5000, 'well').christoffel_contract(np.ones(5000), 2.0, np.ones(5000)), repeats=20)*1e6:>12.1f}us "
          f"{8*5000**3/1e9:>11.0f}GB")
    print("\n  The dense tensor is refused above N=256 rather than exhausting RAM.")


def bench_registry():
    print("\n--- Dilation registry: memory-mapped clock stepping ---")
    root = Path("/tmp/_tro_bench_registry")
    print(f"{'sites':>9} {'phase':>16} {'us/step':>10} {'sites/s':>14} {'mmap':>9}")
    for n_sites in (10_000, 100_000, 1_000_000):
        for lam, label in ((1.5, "SUB_CRITICAL"), (3.5, "SUPER_CRITICAL")):
            shutil.rmtree(root, ignore_errors=True)
            radii = np.geomspace(1e-3, 4.0, n_sites)
            coords = np.zeros((n_sites, 3), dtype=np.float64)
            coords[:, 0] = radii
            cfg = DilationConfig(N=3, n_sites=n_sites, lam=lam)
            reg = DilationRegistry.create(root, cfg, coords=coords, overwrite=True)
            per_step = timeit(lambda: reg.step(1e-4), repeats=20)
            mmap_mb = (n_sites * (3 + 3) * 8 + n_sites) / 1e6
            print(f"{n_sites:>9} {label:>16} {per_step*1e6:>9.1f} "
                  f"{n_sites/per_step:>13.3e} {mmap_mb:>8.1f}MB")
            reg.close()
    shutil.rmtree(root, ignore_errors=True)
    print("\n  One np.logaddexp pass over a contiguous float64 array per step.")
    print("  Cost is identical in both phases: the divergence is in the VALUES,")
    print("  not in the work -- which is the entire point of staying in log space.")


def bench_overflow_frontier():
    print("\n--- Where naive float64 dies, and where log space keeps going ---")
    lam = 3.5
    print(f"{'radius':>12} {'lambda/r^2':>14} {'exp() naive':>16} {'log-space':>14}")
    for r in (0.5, 0.2, 0.1, 0.07, 0.05, 0.01, 1e-4, 1e-8):
        log_rate = lam / (r * r)
        with np.errstate(over="ignore"):
            naive = math.exp(log_rate) if log_rate < 709.78 else float("inf")
        naive_str = f"{naive:.3e}" if math.isfinite(naive) else "OVERFLOW"
        print(f"{r:>12.0e} {log_rate:>14.3e} {naive_str:>16} {log_rate:>14.3e}")
    print(f"\n  float64 exp() ceiling: ln(1.798e308) = 709.78")
    print(f"  => naive encoding dies at r = sqrt(lambda/709.78) = {math.sqrt(lam/709.78):.4f}")
    print(f"  => log-space encoding survives to r ~ 1e-154 (152 more decades)")


if __name__ == "__main__":
    report = hardware_report()
    print("=" * 74)
    print("SANDBOX-LOWER benchmark")
    print(f"  host    : {report['machine']} / {report['system']} / {report['cpu_count']} cores")
    print(f"  python  : {report['python']}   numpy: {report['numpy']}")
    print(f"  arm64   : {report['is_arm64']}    termux: {report['is_termux']}")
    if not report["is_arm64"]:
        print("  NOTE    : this is NOT an ARM64 host. Numbers below do not predict")
        print("            Samsung A16 performance; see README 'Portability'.")
    print("=" * 74)
    bench_field_paths()
    bench_batch_scaling()
    bench_metric()
    bench_registry()
    bench_overflow_frontier()
    print()
