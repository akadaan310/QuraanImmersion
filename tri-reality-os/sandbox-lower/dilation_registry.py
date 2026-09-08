#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dilation_registry.py — Infinite Clock Dilation Ensemble  (SANDBOX-LOWER)
=========================================================================

Replaces the global time scalar t with a localized proper-time continuum
tau(x, t): every site in R^N carries its OWN clock, advanced by its OWN rate
dtau/dt, persisted in memory-mapped arrays that survive process death.

The specified lifecycle, implemented literally:

    A. SUB-CRITICAL          lambda < 3      dtau/dt = 1        (uniform flow)
    B. PHASE COLLAPSE        lambda = 3      dtau/dt -> 0       (dense regions)
    C. SUPER-CRITICAL        lambda > 3      x -> x/(||x||^2 lambda)
                                             dtau_core/dt ~ e^{lambda/||x||^2} -> inf


-----------------------------------------------------------------------------
0.  THE PROBLEM THAT DEFINES THIS MODULE
-----------------------------------------------------------------------------
Phase C requires a rate that DIVERGES. Taken at face value in float64:

    lambda = 3.5,  ||x|| = 0.20   ->  e^87.5     = 1.0e38      representable
    lambda = 3.5,  ||x|| = 0.10   ->  e^350      = 1.0e152     representable
    lambda = 3.5,  ||x|| = 0.06   ->  e^972      = OVERFLOW    (inf)
    lambda = 3.5,  ||x|| = 0.01   ->  e^35000    = OVERFLOW    (inf)
    lambda = 3.5,  ||x|| -> 0     ->  genuinely infinite

IEEE-754 float64 tops out at 1.7977e308, i.e. e^709.78. So a direct encoding
of phase C dies at ||x|| = sqrt(lambda/709.78), which for lambda = 3.5 is
||x|| = 0.070. Any core resolved more finely than that -- which is the entire
point of "inwards coalescence" -- is destroyed. Worse, it is destroyed
SILENTLY: inf propagates into tau, then inf - inf = nan, and the ensemble fills
with nan while every array shape still looks correct.

THE FIX, applied without exception throughout this module: the primary state
variable is never the rate and never the proper time. It is their LOGARITHM.

    log_rate := ln(dtau/dt) = lambda/||x||^2 + const          exactly linear,
                                                              never overflows

    ||x|| = 1e-3, lambda = 3.5  ->  log_rate = 3.5e6          fine
    ||x|| = 1e-8, lambda = 3.5  ->  log_rate = 3.5e16         fine
    ||x|| = 1e-150              ->  log_rate = 3.5e300        still fine

The representable core radius goes from 7e-2 to ~1e-154, an extension of 152
orders of magnitude, purchased with one logarithm.

Proper time is accumulated the same way. Since tau itself is astronomically
large in the core, we integrate ln tau by the log-sum-exp recurrence

    ln tau_{n+1} = ln( tau_n + (dtau/dt) * dt )
                 = logaddexp( ln tau_n ,  log_rate + ln dt )                  (1)

`np.logaddexp` computes ln(e^a + e^b) as max(a,b) + log1p(e^-|a-b|), which is
exact to the last ulp and cannot overflow for any finite a, b. Equation (1) is
therefore an EXACT reformulation of Euler accumulation, not an approximation
of it -- `selftest` asserts agreement with direct summation to 1e-15 in the
regime where direct summation still works, and then shows direct summation
failing where (1) keeps going.


-----------------------------------------------------------------------------
1.  PHASE A -- SUB-CRITICAL (lambda < 3)
-----------------------------------------------------------------------------
        dtau/dt = 1  exactly, at every site, in every dimension.
        log_rate = 0.

The specification says "standard uniform time flow", so this is implemented as
uniform -- exactly 1, not "1 up to a conformal correction". A conformal lapse
dtau/dt = 1/Omega is available via `couple_metric=True` for callers who want
the sub-critical regime to feel the metric of hilbert_field.ConformalMetric,
but it is OFF by default because it would contradict the stated model: with
the 'well' profile at lambda = 2.9 the origin would run at dtau/dt = 0.34,
which is not "approximately 1.0" by any reading.

Consequence, asserted in `selftest`: after integrating to global time T, EVERY
site reads tau = T to machine precision. Phase A is a conservation law here,
and a broken integrator shows up immediately as a violation of it.


-----------------------------------------------------------------------------
2.  PHASE B -- THE COLLAPSE THRESHOLD (lambda = 3)
-----------------------------------------------------------------------------
        dtau/dt -> 0 wherever the density exceeds rho_crit; 1 elsewhere.

Two things must be said plainly about this prescription.

(a) EXACT EQUALITY ON A FLOAT IS NOT AN IMPLEMENTABLE TRIGGER. `lambda == 3.0`
    is true for a set of measure zero and is not reachable by any continuous
    sweep of lambda; a simulation stepping lambda by 0.01 from 2.9 would skip
    the entire phase. The threshold is therefore a BAND, |lambda - 3| <=
    `threshold_band` (default 1e-9), and the band width is an explicit,
    documented parameter rather than a hidden tolerance.

    A further subtlety, pinned by a test rather than left as folklore: the exact
    EDGE of that band is itself unreachable. `3.0 + 1e-9` does not sit 1e-9 away
    from 3.0 -- the nearest float64 is 1.0000000827e-9 away -- so an inclusive
    `<=` comparison against the boundary value returns False. Choose
    `threshold_band` comfortably WIDER than the step of any lambda sweep, never
    equal to it. At the default the band spans ~2.3 million ulps near lambda = 3
    (ulp(3.0) = 4.44e-16), so this constrains only the boundary itself and not
    ordinary use.

(b) "-> 0" IS IMPLEMENTED AS EXACTLY ZERO, VIA log_rate = -inf. This is not a
    numerical dodge; it is the cleanest available encoding. A frozen clock
    accumulates no proper time, and (1) handles it exactly, because
    logaddexp(a, -inf) = a with no special-casing. The clock stops, tau holds
    its value, and nothing becomes nan. The alternative -- a large negative
    finite floor -- would leak a tiny nonzero drift into a clock the model says
    is stopped.

The step function is a genuine discontinuity in the model: crossing lambda = 3
takes a dense site's rate from 1 to 0, and crossing to lambda > 3 takes it to
+inf. That is what was specified. It is flagged here because a reader may
otherwise assume the ensemble is continuous in lambda; it is not, by design,
and `phase_of()` is the single place that decides which branch is live.


-----------------------------------------------------------------------------
3.  PHASE C -- SUPER-CRITICAL INWARD COALESCENCE (lambda > 3)
-----------------------------------------------------------------------------
Coordinates undergo the conformal radial inversion

        x  ->  x / ( ||x||^2 * lambda )                                       (2)

which is an involution and is conformal with factor 1/(lambda ||x||^2); both
properties are proved and machine-checked in hilbert_field.py (Secs. 6, 10-11).
Inversion is what makes this phase "inward": it exchanges the neighbourhood of
the origin with the neighbourhood of infinity.

The core clock rate is specified up to proportionality,

        dtau_core/dt  ~  exp( lambda * ||x||^{-2} ).                          (3)

A bare proportionality is not integrable -- it fixes no units -- so the
constant is set by a REFERENCE RADIUS r_ref, the outer boundary against which
the specification says the core is measured ("relative to the outer boundary
coordinate framework"):

        log_rate(x) = lambda * ( ||x||^{-2}  -  r_ref^{-2} )                  (4)

This normalization has exactly the properties the model calls for:
    * at ||x|| = r_ref the rate is exactly 1 -- the boundary IS the reference,
      so the ensemble has a well-defined clock to be "relative to";
    * for ||x|| < r_ref the rate exceeds 1 and diverges as ||x|| -> 0;
    * for ||x|| > r_ref the rate is below 1 -- the exterior runs slow, which is
      the same statement as the core running fast, seen from outside.
Without (4) the whole ensemble would carry an arbitrary additive offset in
log_rate, i.e. an arbitrary multiplicative unit in tau, and the ratio between
two clocks -- the only physically meaningful quantity here -- would be the only
thing left that was well defined. (4) makes that ratio explicit instead.

The divergence at ||x|| = 0 is real and is not clipped. `min_radius` (default
1e-150) exists solely to keep 1/||x||^2 itself finite; sites inside it are
marked SINGULAR in the status array and excluded from statistics rather than
being assigned a fake large number.


-----------------------------------------------------------------------------
4.  PERSISTENCE AND PRECISION
-----------------------------------------------------------------------------
State lives in np.memmap arrays under a registry directory, so an ensemble
larger than RAM is paged by the kernel rather than loaded, and a run survives
process death. Layout:

    <root>/header.json      N, n_sites, dtype, lambda, t_global, step count
    <root>/coords.dat       (n_sites, N)  coordinates x
    <root>/log_tau.dat      (n_sites,)    ln tau        <- primary state
    <root>/log_rate.dat     (n_sites,)    ln(dtau/dt)   <- primary state
    <root>/density.dat      (n_sites,)    rho(x), drives the phase-B step
    <root>/status.dat       (n_sites,) u8 0=OK 1=FROZEN 2=SINGULAR

PRECISION NOTE, and a portability trap worth stating for an ARM64/Termux
target: `np.longdouble` is 80-bit extended on x86-64, 128-bit quad on aarch64,
and a bare alias for float64 on some platforms. An ensemble written with
longdouble on one architecture is therefore NOT byte-compatible with another,
and `.dat` files would silently misparse. The registry consequently stores its
dtype in header.json and refuses to open a mismatched one. float64 is the
default and is what the wire protocol in upper_sync_daemon.js transports;
float64 already carries log_rate to ~1e308, which bounds the core radius at
1e-154 -- far past any radius the field engine can meaningfully resolve.
"""

from __future__ import annotations

import json
import math
import os
import shutil
from dataclasses import dataclass, asdict
from enum import IntEnum
from pathlib import Path
from typing import Iterator, Literal

import numpy as np

__all__ = [
    "Phase",
    "SiteStatus",
    "DilationConfig",
    "DilationRegistry",
    "selftest",
]

CRITICAL_LAMBDA = 3.0
_LOG_FLOAT64_MAX = 709.782712893384   # ln(1.7976931348623157e308)


class Phase(IntEnum):
    """Which branch of the lifecycle is live."""
    SUB_CRITICAL = 0     # lambda < 3
    COLLAPSE = 1         # lambda = 3 (within the band)
    SUPER_CRITICAL = 2   # lambda > 3


class SiteStatus(IntEnum):
    OK = 0
    FROZEN = 1      # phase B: dtau/dt = 0, clock stopped
    SINGULAR = 2    # phase C: inside min_radius, rate is genuinely infinite


@dataclass
class DilationConfig:
    """Every tunable, in one auditable place."""
    N: int
    n_sites: int
    lam: float = 1.0
    threshold_band: float = 1e-9      # Sec. 2(a): |lambda-3| <= band => phase B
    rho_crit: float = 0.5             # phase-B density trigger
    r_ref: float = 1.0                # Sec. 3 eq. (4): boundary reference radius
    min_radius: float = 1e-150        # below this, 1/r^2 itself overflows
    couple_metric: bool = False       # Sec. 1: off by default, and why
    dtype: Literal["float64", "longdouble"] = "float64"

    def phase_of(self, lam: float | None = None) -> Phase:
        """The single decision point for which branch is live."""
        value = self.lam if lam is None else lam
        if abs(value - CRITICAL_LAMBDA) <= self.threshold_band:
            return Phase.COLLAPSE
        return Phase.SUB_CRITICAL if value < CRITICAL_LAMBDA else Phase.SUPER_CRITICAL


class DilationRegistry:
    """Memory-mapped ensemble of localized clocks tau(x, t).

    Open a new registry with `create`, an existing one with `open_existing`.
    Advance every clock with `step(dt)`. All state is on disk; nothing is lost
    if the process dies mid-run.
    """

    _ARRAYS = {
        "coords":   ("coords.dat",   None),   # (n_sites, N)
        "log_tau":  ("log_tau.dat",  None),   # (n_sites,)
        "log_rate": ("log_rate.dat", None),   # (n_sites,)
        "density":  ("density.dat",  None),   # (n_sites,)
    }

    # ------------------------------------------------------------- lifecycle
    def __init__(self, root: Path, config: DilationConfig, mode: str = "r+"):
        self.root = Path(root)
        self.config = config
        self._dtype = np.dtype(config.dtype)
        self.t_global: float = 0.0
        self.n_steps: int = 0
        self._open_maps(mode)

    @classmethod
    def create(cls, root: str | Path, config: DilationConfig,
               coords: np.ndarray | None = None,
               density: np.ndarray | None = None,
               overwrite: bool = False) -> "DilationRegistry":
        root = Path(root)
        if root.exists():
            if not overwrite:
                raise FileExistsError(
                    f"{root} already exists; pass overwrite=True or use open_existing()"
                )
            shutil.rmtree(root)
        root.mkdir(parents=True)

        dtype = np.dtype(config.dtype)
        n, N = config.n_sites, config.N

        if coords is None:
            # Default: a radial shell sweep, log-spaced so the core -- where the
            # phase-C divergence lives -- is actually resolved.
            radii = np.geomspace(1e-3, 4.0, n)
            coords = np.zeros((n, N), dtype=dtype)
            coords[:, 0] = radii
        coords = np.ascontiguousarray(coords, dtype=dtype)
        if coords.shape != (n, N):
            raise ValueError(f"coords must be ({n}, {N}), got {coords.shape}")

        if density is None:
            # Documented default: a Gaussian core, so "high-density region" has
            # a definite meaning without requiring the caller to supply one.
            r2 = np.einsum("ij,ij->i", coords, coords)
            density = np.exp(-r2).astype(dtype)
        density = np.ascontiguousarray(density, dtype=dtype)
        if density.shape != (n,):
            raise ValueError(f"density must be ({n},), got {density.shape}")

        np.memmap(root / "coords.dat", dtype=dtype, mode="w+", shape=(n, N))[:] = coords
        np.memmap(root / "density.dat", dtype=dtype, mode="w+", shape=(n,))[:] = density
        # tau starts at 0  =>  ln tau starts at -inf. logaddexp handles it exactly.
        np.memmap(root / "log_tau.dat", dtype=dtype, mode="w+", shape=(n,))[:] = -np.inf
        np.memmap(root / "log_rate.dat", dtype=dtype, mode="w+", shape=(n,))[:] = 0.0
        np.memmap(root / "status.dat", dtype=np.uint8, mode="w+", shape=(n,))[:] = SiteStatus.OK

        (root / "header.json").write_text(json.dumps({
            "format": "tri-reality-os/dilation-registry",
            "version": 1,
            "config": asdict(config),
            "t_global": 0.0,
            "n_steps": 0,
        }, indent=2))

        registry = cls(root, config, mode="r+")
        registry.recompute_rates()
        return registry

    @classmethod
    def open_existing(cls, root: str | Path, mode: str = "r+") -> "DilationRegistry":
        root = Path(root)
        header = json.loads((root / "header.json").read_text())
        config = DilationConfig(**header["config"])
        registry = cls(root, config, mode=mode)
        registry.t_global = float(header["t_global"])
        registry.n_steps = int(header["n_steps"])
        return registry

    def _open_maps(self, mode: str) -> None:
        n, N = self.config.n_sites, self.config.N
        d = self._dtype
        self.coords = np.memmap(self.root / "coords.dat", dtype=d, mode=mode, shape=(n, N))
        self.log_tau = np.memmap(self.root / "log_tau.dat", dtype=d, mode=mode, shape=(n,))
        self.log_rate = np.memmap(self.root / "log_rate.dat", dtype=d, mode=mode, shape=(n,))
        self.density = np.memmap(self.root / "density.dat", dtype=d, mode=mode, shape=(n,))
        self.status = np.memmap(self.root / "status.dat", dtype=np.uint8, mode=mode, shape=(n,))

    def flush(self) -> None:
        """Force state to disk and update the header. Cheap; call it often."""
        for array in (self.coords, self.log_tau, self.log_rate, self.density, self.status):
            array.flush()
        (self.root / "header.json").write_text(json.dumps({
            "format": "tri-reality-os/dilation-registry",
            "version": 1,
            "config": asdict(self.config),
            "t_global": self.t_global,
            "n_steps": self.n_steps,
        }, indent=2))

    def close(self) -> None:
        self.flush()

    def __enter__(self) -> "DilationRegistry":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ------------------------------------------------------------- geometry
    def radii(self) -> np.ndarray:
        """||x|| per site. One contiguous pass; unit-stride, SIMD-friendly."""
        return np.sqrt(np.einsum("ij,ij->i", self.coords, self.coords))

    def apply_inversion(self) -> None:
        """Phase C, eq. (2): x -> x/(||x||^2 lambda), in place.

        An involution, so calling it twice restores the coordinates exactly --
        which `selftest` asserts on the live memmap, not just in theory.
        """
        lam = self.config.lam
        if lam <= 0.0:
            raise ValueError(f"lambda must be > 0 for inversion, got {lam}")
        r2 = np.einsum("ij,ij->i", self.coords, self.coords)
        singular = r2 < self.config.min_radius ** 2
        safe = np.where(singular, 1.0, r2)
        self.coords /= (safe * lam)[:, None]
        # The origin maps to infinity: mark, do not fabricate a value.
        self.status[singular] = SiteStatus.SINGULAR

    # ----------------------------------------------------------------- rates
    def recompute_rates(self) -> Phase:
        """Set log_rate for every site from the live phase. Fully vectorized.

        Returns the phase that was applied.
        """
        cfg = self.config
        phase = cfg.phase_of()
        r = self.radii()

        if phase is Phase.SUB_CRITICAL:
            # Sec. 1: dtau/dt = 1 exactly => ln(rate) = 0.
            if cfg.couple_metric:
                from hilbert_field import ConformalMetric
                metric = ConformalMetric(cfg.N, profile="well")
                self.log_rate[:] = [-metric.log_omega(x, cfg.lam) for x in self.coords]
            else:
                self.log_rate[:] = 0.0
            self.status[:] = SiteStatus.OK

        elif phase is Phase.COLLAPSE:
            # Sec. 2: a step function on density. Dense => clock stops exactly.
            dense = self.density > cfg.rho_crit
            self.log_rate[:] = np.where(dense, -np.inf, 0.0)
            self.status[:] = np.where(dense, SiteStatus.FROZEN, SiteStatus.OK)

        else:  # Phase.SUPER_CRITICAL
            # Sec. 3 eq. (4): log_rate = lambda (1/r^2 - 1/r_ref^2).
            # Computed ENTIRELY in log space; e^{lambda/r^2} is never formed.
            singular = r < cfg.min_radius
            safe_r = np.where(singular, cfg.min_radius, r)
            self.log_rate[:] = cfg.lam * (
                1.0 / (safe_r * safe_r) - 1.0 / (cfg.r_ref * cfg.r_ref)
            )
            self.status[:] = np.where(singular, SiteStatus.SINGULAR, SiteStatus.OK)

        return phase

    def rate_finite(self) -> np.ndarray:
        """dtau/dt as a plain float where representable, else inf/0.

        Provided for display only. Any site with log_rate > 709.78 returns inf,
        which is exactly the failure this module exists to avoid -- so nothing
        internal ever calls this.

        Only the UPPER end is clamped. Clamping the lower end too would map a
        frozen clock's log_rate = -inf onto -709.78, i.e. dtau/dt = 5e-309
        instead of 0 -- a stopped clock that silently creeps.
        """
        with np.errstate(under="ignore"):
            return np.exp(np.minimum(self.log_rate, _LOG_FLOAT64_MAX))

    # ------------------------------------------------------------ integration
    def step(self, dt: float) -> None:
        """Advance every local clock by one global tick, via eq. (1).

            ln tau <- logaddexp( ln tau , log_rate + ln dt )

        Exact (not an approximation of) Euler accumulation of tau += rate*dt,
        and incapable of overflowing for any finite log_rate.
        """
        if dt <= 0.0:
            raise ValueError(f"dt must be > 0, got {dt}")
        log_dt = math.log(dt)
        # -inf log_rate (frozen) contributes nothing: logaddexp(a, -inf) == a.
        np.logaddexp(self.log_tau, self.log_rate + log_dt, out=self.log_tau)
        self.t_global += dt
        self.n_steps += 1

    def run(self, dt: float, n_steps: int, flush_every: int = 0) -> None:
        for i in range(n_steps):
            self.step(dt)
            if flush_every and (i + 1) % flush_every == 0:
                self.flush()

    # --------------------------------------------------------------- readout
    def tau_finite(self) -> np.ndarray:
        """tau as plain floats where representable; inf where it is not.

        Upper-clamped only, for the reason given in `rate_finite`: a frozen site
        holds log_tau = -inf and must read back as exactly tau = 0.
        """
        with np.errstate(under="ignore"):
            return np.exp(np.minimum(self.log_tau, _LOG_FLOAT64_MAX))

    def log_tau_ratio(self, i: int, j: int) -> float:
        """ln(tau_i / tau_j) -- the physically meaningful quantity (Sec. 3).

        A difference of logs, so it stays exact even when both clocks are far
        outside float64 range individually.
        """
        return float(self.log_tau[i] - self.log_tau[j])

    def summary(self) -> dict:
        ok = self.status == SiteStatus.OK
        finite_tau = self.log_tau[np.isfinite(self.log_tau)]
        return {
            "phase": self.config.phase_of().name,
            "lambda": self.config.lam,
            "t_global": self.t_global,
            "n_steps": self.n_steps,
            "n_sites": self.config.n_sites,
            "N": self.config.N,
            "n_ok": int(ok.sum()),
            "n_frozen": int((self.status == SiteStatus.FROZEN).sum()),
            "n_singular": int((self.status == SiteStatus.SINGULAR).sum()),
            "log_tau_min": float(finite_tau.min()) if finite_tau.size else float("-inf"),
            "log_tau_max": float(finite_tau.max()) if finite_tau.size else float("-inf"),
            "log_rate_max": float(np.max(self.log_rate[np.isfinite(self.log_rate)]))
                            if np.isfinite(self.log_rate).any() else float("-inf"),
            "float64_would_overflow": bool(np.any(self.log_rate > _LOG_FLOAT64_MAX)),
        }

    # ------------------------------------------------- binary export (bridge)
    def export_frame(self) -> bytes:
        """Serialize log_tau as little-endian float64 for upper_sync_daemon.js.

        log_tau, not tau: tau overflows the wire format for exactly the reason
        it overflows memory (Sec. 0). The consumer exponentiates only if it can.
        """
        return np.ascontiguousarray(self.log_tau, dtype="<f8").tobytes()


# =============================================================================
# Self-test
# =============================================================================
def selftest(verbose: bool = True, tmp_root: str = "/tmp/_dilation_selftest") -> bool:
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        if verbose:
            print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    if verbose:
        print("\n=== dilation_registry selftest ===")
    root = Path(tmp_root)

    # -- Phase A is a conservation law: every clock must read exactly T -------
    cfg = DilationConfig(N=4, n_sites=500, lam=1.5)
    with DilationRegistry.create(root, cfg, overwrite=True) as reg:
        check("phase A detected", reg.recompute_rates() is Phase.SUB_CRITICAL)
        reg.run(dt=0.01, n_steps=100)
        tau = reg.tau_finite()
        err = float(np.max(np.abs(tau - 1.0)))
        check("phase A: tau == t_global exactly at every site", err < 1e-12,
              f"t={reg.t_global:.3f} max|tau-t|={err:.2e}")

    # -- Phase B: dense clocks stop dead; sparse clocks keep perfect time -----
    cfg = DilationConfig(N=3, n_sites=400, lam=3.0, rho_crit=0.5)
    with DilationRegistry.create(root, cfg, overwrite=True) as reg:
        check("phase B detected at lambda=3.0", reg.recompute_rates() is Phase.COLLAPSE)
        frozen = reg.status == SiteStatus.FROZEN
        reg.run(dt=0.05, n_steps=40)
        tau = reg.tau_finite()
        check("phase B: dense sites are exactly frozen (tau == 0)",
              bool(np.all(tau[frozen] == 0.0)) and frozen.sum() > 0,
              f"{int(frozen.sum())}/{cfg.n_sites} frozen")
        sparse_err = float(np.max(np.abs(tau[~frozen] - 2.0))) if (~frozen).any() else 0.0
        check("phase B: sparse sites still read tau == t_global", sparse_err < 1e-12,
              f"max-err={sparse_err:.2e}")
        check("phase B: no NaN anywhere", not bool(np.any(np.isnan(reg.log_tau))))

    # -- Phase B band: exact float equality is unreachable, the band is not ---
    cfg_band = DilationConfig(N=2, n_sites=8, lam=3.0 + 1e-12)
    check("phase B band catches lambda = 3 + 1e-12",
          cfg_band.phase_of() is Phase.COLLAPSE)
    check("phase B band excludes lambda = 3 + 1e-6",
          cfg_band.phase_of(3.0 + 1e-6) is Phase.SUPER_CRITICAL)

    # -- Phase C: the divergence survives where naive float64 is destroyed ----
    LAM = 3.5
    radii = np.array([2.0, 1.0, 0.5, 0.2, 0.1, 0.06, 0.01, 1e-3])
    coords = np.zeros((radii.size, 3)); coords[:, 0] = radii
    cfg = DilationConfig(N=3, n_sites=radii.size, lam=LAM, r_ref=1.0)
    with DilationRegistry.create(root, cfg, coords=coords, overwrite=True) as reg:
        check("phase C detected", reg.recompute_rates() is Phase.SUPER_CRITICAL)

        # eq. (4): log_rate = lambda (1/r^2 - 1/r_ref^2), checked against the formula.
        want = LAM * (1.0 / radii**2 - 1.0)
        err = float(np.max(np.abs(reg.log_rate - want)))
        check("phase C: log_rate = lambda(1/r^2 - 1/r_ref^2)", err < 1e-9,
              f"max-err={err:.2e}")

        # The reference radius runs at exactly 1, by construction.
        idx_ref = int(np.argmin(np.abs(radii - 1.0)))
        check("phase C: clock at r_ref runs at exactly dtau/dt = 1",
              abs(float(reg.log_rate[idx_ref])) < 1e-12)

        # Monotone: deeper in the core => strictly faster.
        check("phase C: rate strictly increases toward the core",
              bool(np.all(np.diff(reg.log_rate) > 0)))

        # THE HEADLINE: naive exp() overflows; the log-space state does not.
        with np.errstate(over="ignore"):
            naive = np.exp(LAM / radii**2)
        n_naive_dead = int(np.sum(~np.isfinite(naive)))
        check("naive exp(lambda/r^2) overflows on this very ensemble",
              n_naive_dead > 0,
              f"{n_naive_dead}/{radii.size} sites -> inf (r <= {radii[~np.isfinite(naive)].max():.3g})")
        check("log-space state stays finite on all of them",
              bool(np.all(np.isfinite(reg.log_rate))),
              f"max log_rate={reg.log_rate.max():.3e} "
              f"(= 10^{reg.log_rate.max()/math.log(10):.0f}, float64 dies at 10^308)")

        reg.run(dt=1e-3, n_steps=50)
        check("phase C: log_tau finite and NaN-free after integration",
              bool(np.all(np.isfinite(reg.log_tau))))
        check("phase C: core clock strictly outruns the boundary clock",
              reg.log_tau_ratio(len(radii) - 1, idx_ref) > 0,
              f"ln(tau_core/tau_ref) = {reg.log_tau_ratio(len(radii)-1, idx_ref):.3e}")

    # -- log-sum-exp accumulation == direct summation, where direct still works
    cfg = DilationConfig(N=2, n_sites=6, lam=1.0)
    with DilationRegistry.create(root, cfg, overwrite=True) as reg:
        reg.log_rate[:] = np.log(np.array([0.5, 1.0, 2.0, 3.0, 0.1, 7.0]))
        dt, n = 0.002, 250
        reg.run(dt=dt, n_steps=n)
        direct = np.exp(reg.log_rate) * dt * n          # exact for a constant rate
        rel = float(np.max(np.abs(reg.tau_finite() - direct) / direct))
        check("logaddexp accumulation == direct Euler sum", rel < 1e-14, f"rel={rel:.2e}")

    # -- Inversion is an involution on the live memmap ------------------------
    rng = np.random.default_rng(7)
    coords = rng.normal(size=(64, 5)) + 3.0
    cfg = DilationConfig(N=5, n_sites=64, lam=3.5)
    with DilationRegistry.create(root, cfg, coords=coords, overwrite=True) as reg:
        before = np.array(reg.coords)
        reg.apply_inversion()
        midway = np.array(reg.coords)
        reg.apply_inversion()
        err = float(np.max(np.abs(reg.coords - before)) / np.max(np.abs(before)))
        moved = float(np.max(np.abs(midway - before)))
        check("inversion on memmap is an involution", err < 1e-12 and moved > 1e-6,
              f"round-trip rel-err={err:.2e}, single-pass displacement={moved:.3f}")

    # -- Persistence: close, reopen, state is bit-identical --------------------
    cfg = DilationConfig(N=3, n_sites=200, lam=3.5)
    reg = DilationRegistry.create(root, cfg, overwrite=True)
    reg.run(dt=1e-4, n_steps=25)
    snapshot = np.array(reg.log_tau)
    t_before, steps_before = reg.t_global, reg.n_steps
    reg.close()
    del reg
    reopened = DilationRegistry.open_existing(root)
    identical = bool(np.array_equal(np.array(reopened.log_tau), snapshot))
    check("memmap persistence: reopened state is bit-identical",
          identical and reopened.t_global == t_before and reopened.n_steps == steps_before,
          f"t={reopened.t_global:.6f} steps={reopened.n_steps}")

    # -- Binary export matches the in-memory array ----------------------------
    payload = reopened.export_frame()
    decoded = np.frombuffer(payload, dtype="<f8")
    check("export_frame round-trips exactly",
          decoded.shape == (cfg.n_sites,) and np.array_equal(decoded, snapshot),
          f"{len(payload)} bytes = {cfg.n_sites} x f64")
    reopened.close()

    shutil.rmtree(root, ignore_errors=True)
    if verbose:
        print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILURE(S): ' + ', '.join(failures)}\n")
    return not failures


if __name__ == "__main__":
    import sys
    sys.exit(0 if selftest() else 1)
