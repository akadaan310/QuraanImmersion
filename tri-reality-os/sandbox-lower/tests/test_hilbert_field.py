#!/usr/bin/env python3
"""Tests for hilbert_field.py.

The module's own `selftest()` is the primary falsification suite (it checks
every closed form against an independent source of truth). This file runs it
under unittest and adds the property-based and cross-module checks that do not
belong inside the module.
"""
import math
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hilbert_field import (  # noqa: E402
    ConformalMetric, FieldSpec, HilbertField, LogComplex,
    conformal_inversion, inversion_jacobian, selftest,
)


class TestSelfTest(unittest.TestCase):
    def test_module_selftest_passes(self):
        self.assertTrue(selftest(verbose=False))


class TestLogComplex(unittest.TestCase):
    def test_roundtrip_through_complex(self):
        for z in (1 + 0j, -3.5 + 2.25j, 1e-8 - 1e-8j, 1e120 + 0j):
            lc = LogComplex.from_complex(z)
            self.assertLess(abs(lc.to_complex() - z) / abs(z), 1e-14)

    def test_overflow_is_raised_not_silently_infinite(self):
        """A magnitude past float64 must raise, not return inf."""
        huge = LogComplex(5000.0, 0.3)
        with self.assertRaises(OverflowError):
            huge.to_complex()
        self.assertTrue(math.isfinite(huge.log_magnitude))

    def test_underflow_returns_exact_zero(self):
        self.assertEqual(LogComplex(-1e6, 1.0).to_complex(), 0j)

    def test_phase_stays_wrapped(self):
        for raw in (0.0, math.pi, 10 * math.pi, -37.5):
            lc = LogComplex(0.0, LogComplex._wrap(raw))
            self.assertLessEqual(abs(lc.phase), math.pi + 1e-12)

    def test_multiplication_adds_logs(self):
        a, b = LogComplex(2.0, 0.5), LogComplex(3.0, 1.0)
        self.assertAlmostEqual((a * b).log_magnitude, 5.0, places=12)


class TestPathsAgree(unittest.TestCase):
    """The three evaluation paths must agree wherever their domains overlap."""

    def test_paths_agree_at_nonzero_time(self):
        for N in (1, 3, 6):
            spec = FieldSpec.isotropic(N, 0.0, 0.6)
            field = HilbertField(spec)
            r = 0.9
            x = np.zeros(N); x[0] = r
            for t in (0.0, 0.35, 1.4):
                a = field.psi_separable(x, t)
                b = field.psi_radial(r, t, n_nodes=4096)
                self.assertLess(a.relative_error(b), 1e-7,
                                f"N={N} t={t}: A vs B disagree")

    def test_qmc_matches_closed_form_within_its_own_error_bar(self):
        rng = np.random.default_rng(17)
        for N in (3, 12):
            spec = FieldSpec.isotropic(N, 0.0, 0.5)
            field = HilbertField(spec)
            x = rng.normal(scale=0.2, size=N)
            exact = field.psi_separable(x, 0.0)
            est = field.psi_qmc(x, 0.0, n_samples=1 << 13, n_replicates=8, seed=3)
            self.assertLess(exact.relative_error(est.value),
                            max(6 * est.std_error, 1e-4))

    def test_nonseparable_dispersion_refuses_the_closed_form(self):
        """Path A must not silently answer for a dispersion it cannot handle."""
        spec = FieldSpec.isotropic(4, 0.0, 0.5, dispersion="massless")
        with self.assertRaises(ValueError):
            HilbertField(spec).psi_separable(np.zeros(4), 0.0)

    def test_radial_handles_dispersions_with_no_closed_form(self):
        for dispersion in ("massless", "relativistic"):
            spec = FieldSpec.isotropic(5, 0.0, 0.5, dispersion=dispersion)
            value = HilbertField(spec).psi_radial(0.8, 0.5, n_nodes=4096)
            self.assertTrue(math.isfinite(value.log_magnitude), dispersion)


class TestHighDimension(unittest.TestCase):
    def test_path_a_is_exact_at_dimensions_that_overflow_float64(self):
        """N=20000 has |Psi| ~ 10^4972 -- 4600 orders past float64's ceiling."""
        N = 20000
        spec = FieldSpec.isotropic(N, 0.0, 0.5)
        value = HilbertField(spec).psi_separable(np.zeros(N), 0.0)
        expected = N * 0.5 * math.log(math.pi)
        self.assertAlmostEqual(value.log_magnitude, expected, places=6)
        self.assertTrue(math.isfinite(value.log_magnitude))
        with self.assertRaises(OverflowError):
            value.to_complex()   # confirms it really is out of float64 range

    def test_cost_is_linear_not_exponential_in_N(self):
        """A grid would be M^N. Assert the measured cost stays ~linear."""
        import time
        timings = {}
        for N in (1000, 8000):
            spec = FieldSpec.isotropic(N, 0.0, 0.5)
            field = HilbertField(spec)
            x = np.zeros(N)
            start = time.perf_counter()
            for _ in range(20):
                field.psi_separable(x, 0.1)
            timings[N] = time.perf_counter() - start
        ratio = timings[8000] / max(timings[1000], 1e-9)
        self.assertLess(ratio, 40.0, f"8x the dimension cost {ratio:.1f}x the time")


class TestConformalGeometry(unittest.TestCase):
    def test_sphere_curvature_is_exact_for_many_dimensions(self):
        for N in (2, 3, 4, 10, 50, 200):
            metric = ConformalMetric(N, profile="sphere")
            for r in (0.0, 0.3, 1.0, 7.0):
                x = np.zeros(N); x[0] = r
                self.assertAlmostEqual(
                    metric.ricci_scalar(x, 1.0) / (N * (N - 1)), 1.0, places=10,
                    msg=f"S^{N} at r={r}")

    def test_flat_metric_has_zero_curvature(self):
        metric = ConformalMetric(6, profile="flat")
        self.assertAlmostEqual(metric.ricci_scalar(np.ones(6), 2.0), 0.0, places=12)

    def test_log_volume_element_is_N_phi(self):
        metric = ConformalMetric(300, profile="well")
        x = np.full(300, 0.1)
        self.assertAlmostEqual(metric.log_volume_element(x, 2.5),
                               300 * metric.log_omega(x, 2.5), places=9)

    def test_dense_christoffel_is_refused_at_scale_rather_than_ooming(self):
        with self.assertRaises(MemoryError):
            ConformalMetric(5000, profile="well").christoffel(np.ones(5000), 2.0)

    def test_proper_length_of_a_straight_line_in_flat_space(self):
        metric = ConformalMetric(3, profile="flat")
        path = np.linspace(0, 1, 200)[:, None] * np.array([3.0, 4.0, 0.0])
        self.assertAlmostEqual(metric.proper_length(path, 1.0), 5.0, places=6)

    def test_inversion_singularity_is_raised_not_returned_as_inf(self):
        with self.assertRaises(ZeroDivisionError):
            conformal_inversion(np.zeros(4), 3.5)
        with self.assertRaises(ZeroDivisionError):
            inversion_jacobian(np.zeros(4), 3.5)

    def test_inversion_maps_unit_sphere_to_radius_one_over_lambda(self):
        """||x||=1  =>  ||inv(x)|| = 1/lambda, for every N."""
        rng = np.random.default_rng(5)
        for N in (2, 8, 64):
            x = rng.normal(size=N)
            x /= np.linalg.norm(x)
            for lam in (0.7, 3.0, 3.5, 12.0):
                y = conformal_inversion(x, lam)
                self.assertAlmostEqual(float(np.linalg.norm(y)), 1.0 / lam, places=12)

    def test_inversion_exchanges_interior_and_exterior(self):
        """The defining property of 'inward coalescence': near <-> far."""
        lam = 3.5
        pivot = 1.0 / math.sqrt(lam)          # the fixed sphere ||x|| = 1/sqrt(lam)
        inner = np.array([pivot / 10, 0.0, 0.0])
        outer = np.array([pivot * 10, 0.0, 0.0])
        self.assertGreater(np.linalg.norm(conformal_inversion(inner, lam)), pivot)
        self.assertLess(np.linalg.norm(conformal_inversion(outer, lam)), pivot)


class TestBatchEvaluation(unittest.TestCase):
    def test_batch_matches_scalar_and_shapes_are_validated(self):
        spec = FieldSpec.isotropic(8, 0.0, 0.5)
        field = HilbertField(spec)
        rng = np.random.default_rng(2)
        xs = rng.normal(size=(400, 8))
        batch = field.psi_batch(xs, 0.2, workers=4)
        self.assertEqual(batch.shape, (400, 2))
        for i in (0, 137, 399):
            single = field.psi(xs[i], 0.2)
            self.assertAlmostEqual(batch[i, 0], single.log_magnitude, places=12)
            self.assertAlmostEqual(batch[i, 1], single.phase, places=12)
        with self.assertRaises(ValueError):
            field.psi_batch(rng.normal(size=(10, 7)), 0.0)


class TestSpecValidation(unittest.TestCase):
    def test_invalid_specs_are_rejected(self):
        with self.assertRaises(ValueError):
            FieldSpec(N=0, k0=np.zeros(0), sigma_k=np.zeros(0))
        with self.assertRaises(ValueError):
            FieldSpec(N=3, k0=np.zeros(3), sigma_k=np.zeros(3))       # sigma = 0
        with self.assertRaises(ValueError):
            FieldSpec(N=3, k0=np.zeros(2), sigma_k=np.ones(3))        # shape
        with self.assertRaises(ValueError):
            FieldSpec(N=3, k0=np.full(3, np.nan), sigma_k=np.ones(3))

    def test_anisotropic_spec_refuses_the_radial_path(self):
        spec = FieldSpec(N=4, k0=np.array([1.0, 0, 0, 0]), sigma_k=np.ones(4) * 0.5)
        self.assertFalse(spec.is_isotropic)
        with self.assertRaises(ValueError):
            HilbertField(spec).psi_radial(1.0, 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
