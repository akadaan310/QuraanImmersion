#!/usr/bin/env python3
"""Tests for dilation_registry.py.

The module's `selftest()` covers the three-phase lifecycle against closed
forms. This file adds the lambda-sweep behaviour, the coupling to
hilbert_field, and the persistence/edge cases that need a real filesystem.
"""
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dilation_registry import (  # noqa: E402
    CRITICAL_LAMBDA, DilationConfig, DilationRegistry, Phase, SiteStatus, selftest,
)
from hilbert_field import FieldSpec, HilbertField, conformal_inversion  # noqa: E402


class RegistryCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="tro-reg-"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make(self, **kw):
        coords = kw.pop("coords", None)
        density = kw.pop("density", None)
        cfg = DilationConfig(**kw)
        return DilationRegistry.create(self.root / "r", cfg, coords=coords,
                                       density=density, overwrite=True)


class TestSelfTest(RegistryCase):
    def test_module_selftest_passes(self):
        self.assertTrue(selftest(verbose=False, tmp_root=str(self.root / "st")))


class TestPhaseClassification(RegistryCase):
    def test_lambda_sweep_crosses_all_three_phases(self):
        cfg = DilationConfig(N=2, n_sites=4, lam=1.0)   # default band = 1e-9
        observed = [cfg.phase_of(lam) for lam in
                    (0.0, 1.0, 2.999999, 3.0, 3.0 + 1e-8, 3.001, 10.0)]
        self.assertEqual(observed, [
            Phase.SUB_CRITICAL, Phase.SUB_CRITICAL, Phase.SUB_CRITICAL,
            Phase.COLLAPSE,
            Phase.SUPER_CRITICAL, Phase.SUPER_CRITICAL, Phase.SUPER_CRITICAL,
        ])

    def test_band_is_symmetric_and_has_a_definite_width(self):
        cfg = DilationConfig(N=2, n_sites=4, lam=1.0, threshold_band=1e-9)
        # Comfortably inside, both sides.
        self.assertIs(cfg.phase_of(3.0 + 9e-10), Phase.COLLAPSE)
        self.assertIs(cfg.phase_of(3.0 - 9e-10), Phase.COLLAPSE)
        # Comfortably outside, both sides.
        self.assertIs(cfg.phase_of(3.0 + 1.1e-9), Phase.SUPER_CRITICAL)
        self.assertIs(cfg.phase_of(3.0 - 1.1e-9), Phase.SUB_CRITICAL)

    def test_the_exact_band_edge_is_not_reachable_by_arithmetic(self):
        """Documents a real limit rather than pretending it away.

        `3.0 + 1e-9` does not sit exactly 1e-9 from 3.0: the nearest float64 is
        1.0000000827e-9 away, so an inclusive `<=` test on the edge FAILS. This
        is the same knife-edge problem the band exists to solve, one level down,
        and it is why `threshold_band` must be chosen comfortably wider than the
        step size of any lambda sweep -- never equal to it.
        """
        self.assertGreater(abs((3.0 + 1e-9) - 3.0), 1e-9)
        cfg = DilationConfig(N=2, n_sites=4, lam=1.0, threshold_band=1e-9)
        self.assertIs(cfg.phase_of(3.0 + 1e-9), Phase.SUPER_CRITICAL)
        # The band is still ~2.3 million ulps wide near 3.0, so it is entirely
        # usable -- only its exact boundary is unaddressable.
        self.assertGreater(1e-9 / math.ulp(3.0), 1e6)

    def test_threshold_band_is_configurable_and_honoured(self):
        wide = DilationConfig(N=2, n_sites=4, lam=3.0, threshold_band=0.05)
        self.assertIs(wide.phase_of(3.04), Phase.COLLAPSE)
        self.assertIs(wide.phase_of(3.06), Phase.SUPER_CRITICAL)
        narrow = DilationConfig(N=2, n_sites=4, lam=3.0, threshold_band=1e-15)
        self.assertIs(narrow.phase_of(3.0 + 1e-12), Phase.SUPER_CRITICAL)


class TestSubCritical(RegistryCase):
    def test_uniform_flow_holds_across_dimensions_and_step_sizes(self):
        for N in (1, 3, 32):
            for dt, n in ((0.1, 10), (1e-4, 1000), (0.5, 4)):
                reg = self.make(N=N, n_sites=64, lam=2.5)
                reg.run(dt=dt, n_steps=n)
                tau = reg.tau_finite()
                self.assertTrue(np.allclose(tau, dt * n, rtol=1e-12),
                                f"N={N} dt={dt} n={n}: tau != t_global")
                reg.close()

    def test_rate_is_exactly_one_not_approximately(self):
        reg = self.make(N=5, n_sites=32, lam=1.0)
        self.assertTrue(np.all(reg.log_rate == 0.0))
        self.assertTrue(np.all(reg.rate_finite() == 1.0))
        reg.close()


class TestCollapse(RegistryCase):
    def test_step_function_partitions_strictly_by_density(self):
        n = 200
        density = np.linspace(0.0, 1.0, n)
        coords = np.zeros((n, 2))
        coords[:, 0] = np.linspace(0.1, 5.0, n)
        reg = self.make(N=2, n_sites=n, lam=3.0, rho_crit=0.5,
                        coords=coords, density=density)
        dense = density > 0.5
        self.assertTrue(np.all(reg.log_rate[dense] == -np.inf))
        self.assertTrue(np.all(reg.log_rate[~dense] == 0.0))
        self.assertTrue(np.all(reg.status[dense] == SiteStatus.FROZEN))
        reg.run(dt=0.01, n_steps=50)
        tau = reg.tau_finite()
        self.assertTrue(np.all(tau[dense] == 0.0), "frozen clocks must not creep")
        self.assertTrue(np.allclose(tau[~dense], 0.5, rtol=1e-12))
        reg.close()

    def test_a_frozen_clock_stays_frozen_over_many_steps(self):
        """Guards the regression where -inf was clipped to -709 and crept."""
        reg = self.make(N=2, n_sites=8, lam=3.0, rho_crit=-1.0)  # freeze everything
        self.assertTrue(np.all(reg.status == SiteStatus.FROZEN))
        reg.run(dt=1.0, n_steps=10000)
        self.assertTrue(np.all(reg.tau_finite() == 0.0))
        self.assertTrue(np.all(reg.log_tau == -np.inf))
        reg.close()


class TestSuperCritical(RegistryCase):
    def test_rate_matches_the_specified_exponential_where_float64_survives(self):
        """Where exp() is still representable, log_rate must reproduce it."""
        lam = 3.5
        radii = np.array([1.0, 0.5, 0.3, 0.25])       # exp(lam/r^2) all finite here
        coords = np.zeros((radii.size, 3)); coords[:, 0] = radii
        reg = self.make(N=3, n_sites=radii.size, lam=lam, r_ref=1.0, coords=coords)
        # dtau/dt = exp(lam/r^2) / exp(lam/r_ref^2), the normalization of eq. (4)
        expected = np.exp(lam / radii**2) / np.exp(lam / 1.0**2)
        self.assertTrue(np.allclose(reg.rate_finite(), expected, rtol=1e-9))
        reg.close()

    def test_core_outruns_boundary_by_the_predicted_ratio(self):
        lam = 4.0
        radii = np.array([1.0, 0.2])
        coords = np.zeros((2, 3)); coords[:, 0] = radii
        reg = self.make(N=3, n_sites=2, lam=lam, r_ref=1.0, coords=coords)
        reg.run(dt=1e-3, n_steps=10)
        # ln(tau_core/tau_ref) = ln(rate_core) - ln(rate_ref) for equal elapsed t
        predicted = lam * (1 / 0.2**2 - 1 / 1.0**2)
        self.assertAlmostEqual(reg.log_tau_ratio(1, 0), predicted, places=6)
        reg.close()

    def test_sites_inside_min_radius_are_marked_not_faked(self):
        coords = np.zeros((3, 2))
        coords[:, 0] = [1.0, 1e-200, 0.0]
        reg = self.make(N=2, n_sites=3, lam=3.5, min_radius=1e-150, coords=coords)
        self.assertEqual(reg.status[0], SiteStatus.OK)
        self.assertEqual(reg.status[1], SiteStatus.SINGULAR)
        self.assertEqual(reg.status[2], SiteStatus.SINGULAR)
        self.assertEqual(reg.summary()["n_singular"], 2)
        reg.close()

    def test_summary_reports_when_float64_would_have_died(self):
        radii = np.array([1.0, 0.01])
        coords = np.zeros((2, 3)); coords[:, 0] = radii
        reg = self.make(N=3, n_sites=2, lam=3.5, coords=coords)
        summary = reg.summary()
        self.assertTrue(summary["float64_would_overflow"])
        self.assertTrue(math.isfinite(summary["log_rate_max"]))
        self.assertEqual(summary["phase"], "SUPER_CRITICAL")
        reg.close()

    def test_inversion_agrees_with_the_field_engine_implementation(self):
        """The registry and hilbert_field must apply the SAME map."""
        rng = np.random.default_rng(11)
        coords = rng.normal(size=(32, 4)) + 2.0
        lam = 3.5
        reg = self.make(N=4, n_sites=32, lam=lam, coords=coords.copy())
        reg.apply_inversion()
        expected = np.array([conformal_inversion(x, lam) for x in coords])
        self.assertTrue(np.allclose(np.asarray(reg.coords), expected, rtol=1e-14))
        reg.close()


class TestPersistence(RegistryCase):
    def test_reopen_refuses_to_clobber_without_overwrite(self):
        cfg = DilationConfig(N=2, n_sites=8, lam=1.0)
        DilationRegistry.create(self.root / "p", cfg).close()
        with self.assertRaises(FileExistsError):
            DilationRegistry.create(self.root / "p", cfg)

    def test_state_survives_across_three_separate_opens(self):
        cfg = DilationConfig(N=3, n_sites=100, lam=2.0)
        reg = DilationRegistry.create(self.root / "q", cfg, overwrite=True)
        reg.run(dt=0.01, n_steps=10)
        reg.close()
        for expected_steps in (20, 30):
            reg = DilationRegistry.open_existing(self.root / "q")
            reg.run(dt=0.01, n_steps=10)
            reg.close()
            self.assertEqual(reg.n_steps, expected_steps)
        final = DilationRegistry.open_existing(self.root / "q")
        self.assertAlmostEqual(final.t_global, 0.30, places=12)
        self.assertTrue(np.allclose(final.tau_finite(), 0.30, rtol=1e-12))
        final.close()

    def test_export_frame_is_little_endian_float64(self):
        reg = self.make(N=2, n_sites=16, lam=1.0)
        reg.run(dt=0.25, n_steps=4)
        raw = reg.export_frame()
        self.assertEqual(len(raw), 16 * 8)
        self.assertTrue(np.allclose(np.frombuffer(raw, dtype="<f8"), 0.0, atol=1e-15))
        reg.close()


class TestFieldCoupling(RegistryCase):
    def test_density_from_the_field_engine_drives_the_collapse(self):
        """|Psi|^2 from hilbert_field is a legitimate phase-B density source."""
        N, n = 3, 128
        radii = np.linspace(0.05, 3.0, n)
        coords = np.zeros((n, N)); coords[:, 0] = radii

        field = HilbertField(FieldSpec.isotropic(N, 0.0, 0.5))
        log_psi = np.array([field.psi(x, 0.0).log_magnitude for x in coords])
        # Normalize |Psi|^2 to [0,1] in log space, then exponentiate safely.
        log_density = 2 * (log_psi - log_psi.max())
        density = np.exp(log_density)

        reg = self.make(N=N, n_sites=n, lam=CRITICAL_LAMBDA, rho_crit=0.5,
                        coords=coords, density=density)
        frozen = np.asarray(reg.status) == SiteStatus.FROZEN
        self.assertGreater(frozen.sum(), 0, "the wavepacket core should freeze")
        self.assertLess(frozen.sum(), n, "the tail should keep running")
        # The packet peaks at the origin, so frozen sites must be the inner ones.
        self.assertLess(radii[frozen].max(), radii[~frozen].min())
        reg.close()


class TestValidation(RegistryCase):
    def test_bad_shapes_and_steps_are_rejected(self):
        cfg = DilationConfig(N=3, n_sites=10, lam=1.0)
        with self.assertRaises(ValueError):
            DilationRegistry.create(self.root / "v", cfg,
                                    coords=np.zeros((9, 3)), overwrite=True)
        reg = self.make(N=2, n_sites=4, lam=1.0)
        with self.assertRaises(ValueError):
            reg.step(0.0)
        with self.assertRaises(ValueError):
            reg.step(-1.0)
        reg.close()

    def test_inversion_rejects_nonpositive_lambda(self):
        reg = self.make(N=2, n_sites=4, lam=1.0)
        reg.config.lam = -1.0
        with self.assertRaises(ValueError):
            reg.apply_inversion()
        reg.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
