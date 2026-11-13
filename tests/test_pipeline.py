"""Unit tests for data_pipeline helpers (run: python tests/test_pipeline.py)."""
import importlib.util
import math
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_module(name, rel_path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestDataPipeline(unittest.TestCase):
    def test_pipeline_scripts_parse_cleanly(self):
        import ast
        for rel in ("preprocess.py", "mola16.py", "download_mola16.py"):
            src_path = os.path.join(ROOT, "data_pipeline", rel)
            with open(src_path, encoding="utf-8") as f:
                ast.parse(f.read(), filename=rel)

    def test_mola16_constants_match_web_engine(self):
        mola16 = load_module("mola16", os.path.join("data_pipeline", "mola16.py"))
        # Planetary radius must match web engine volumetric mean radius (3389.5 km)
        self.assertEqual(mola16.MARS_R, 3389500.0)
        self.assertEqual(mola16.ELEV_MIN_M, -8200.0)
        self.assertEqual(mola16.ELEV_MAX_M, 21230.0)
        self.assertEqual((mola16.OUT_W, mola16.OUT_H), (2048, 1024))

    def test_build_5km_matches_shipped_meta(self):
        import json
        with open(os.path.join(ROOT, "web", "layers", "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        with open(os.path.join(ROOT, "data_pipeline", "build_5km.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("OUT_W, OUT_H = %d, %d" % (meta["width"], meta["height"]), src)
        self.assertAlmostEqual(meta["deg_per_px"], 360 / meta["width"])
        self.assertIn("cave", meta)

    def test_mola16_slope_and_reduce_with_numpy(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy not installed in minimal Python environment")
        mola16 = load_module("mola16", os.path.join("data_pipeline", "mola16.py"))
        flat = np.zeros((16, 32), dtype=np.float32)
        sl_flat = mola16.slope_deg(flat)
        self.assertEqual(sl_flat.shape, (16, 32))
        self.assertTrue(np.allclose(sl_flat, 0.0, atol=1e-5))

        # Meridional slope check: 100 m rise per latitude step -> expected atan(dy_rise / dy)
        dy = math.pi * mola16.MARS_R / 16
        ramp_y = np.arange(16, dtype=np.float32)[:, None] * 1000.0
        tilted = np.repeat(ramp_y, 32, axis=1)
        sl_tilt = mola16.slope_deg(tilted)
        expected_deg = math.degrees(math.atan(1000.0 / dy))
        self.assertAlmostEqual(float(sl_tilt[8, 16]), expected_deg, places=3)


if __name__ == "__main__":
    unittest.main()
