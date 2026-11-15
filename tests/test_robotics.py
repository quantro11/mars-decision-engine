"""Unit tests for robotics helpers (run: python tests/test_robotics.py)."""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'robotics'))

from mars_decision_ros2_node import MarsDecisionKernel
from mavlink_mission_exporter import export_mavlink_mission, format_mavlink_waypoint_line
from hil_telemetry_bridge import generate_hil_telemetry_packet


class TestRoboticsPackage(unittest.TestCase):
    def setUp(self):
        self.kernel = MarsDecisionKernel()

    def test_atmospheric_column_and_gcr(self):
        # At datum (0 m), atmospheric column should be ~16.4 g/cm2
        col0 = self.kernel.calc_atmospheric_column(0.0)
        self.assertAlmostEqual(col0, 16.4, delta=0.1)

        # Higher elevation should have lower atmospheric mass
        col2k = self.kernel.calc_atmospheric_column(2000.0)
        self.assertLess(col2k, col0)

        # GCR dose should decrease with sky-view horizon blockage
        flat_dose = self.kernel.calc_gcr_dose(0.0, horizon_slope_deg=0.0)
        canyon_dose = self.kernel.calc_gcr_dose(0.0, horizon_slope_deg=30.0)
        self.assertLess(canyon_dose, flat_dose)

    def test_non_compensatory_veto(self):
        # Elevation above +2 km must trigger hard EDL veto
        crit_high = {'elev_m': 2500.0, 'slope_deg': 2.0, 'lat_deg': 0.0, 'ice': 0.9}
        score, valid = self.kernel.evaluate_cell_non_compensatory(crit_high)
        self.assertFalse(valid)
        self.assertEqual(score, 0.0)

        # Operational slope above 15 deg must trigger veto
        crit_steep = {'elev_m': -1000.0, 'slope_deg': 18.0, 'lat_deg': 0.0, 'ice': 0.9}
        score, valid = self.kernel.evaluate_cell_non_compensatory(crit_steep)
        self.assertFalse(valid)
        self.assertEqual(score, 0.0)

        # Valid lowlands site must pass
        crit_ok = {'elev_m': -2000.0, 'slope_deg': 2.5, 'lat_deg': 10.0, 'ice': 0.5}
        score, valid = self.kernel.evaluate_cell_non_compensatory(crit_ok)
        self.assertTrue(valid)
        self.assertGreater(score, 0.0)

    def test_pandolf_bioenergetics_038g(self):
        res = self.kernel.calculate_plss_pandolf(speed_mps=0.8, grade_frac=0.05)
        self.assertIn('metabolic_power_w', res)
        self.assertIn('o2_consumption_g_min', res)
        self.assertGreater(res['metabolic_power_w'], 50.0)
        self.assertLess(res['metabolic_power_w'], 600.0)

    def test_multihazard_astar_pathing(self):
        grid = [[0.1 for _ in range(5)] for _ in range(5)]
        hazards = [[False for _ in range(5)] for _ in range(5)]
        hazards[1][1] = True  # block cell (1, 1)

        path = self.kernel.plan_multihazard_astar(grid, (0, 0), (2, 2), hazard_mask=hazards)
        self.assertTrue(len(path) > 0)
        self.assertEqual(path[0], (0, 0))
        self.assertEqual(path[-1], (2, 2))
        self.assertNotIn((1, 1), path)

    def test_mavlink_wpl110_format(self):
        waypoints = [
            {'lat': 18.38, 'lon': 77.58, 'elev_m': 2.0, 'is_rest_stop': False},
            {'lat': 18.42, 'lon': 77.62, 'elev_m': 2.0, 'is_rest_stop': True},
        ]
        wpl = export_mavlink_mission(waypoints, home_lat=18.35, home_lon=77.50)
        lines = wpl.strip().split('\n')
        self.assertEqual(lines[0], 'QGC WPL 110')
        self.assertEqual(len(lines), 4)  # Header + Home + 2 WPs

        # Check column count (should be 12 tab-separated fields)
        cols = lines[1].split('\t')
        self.assertEqual(len(cols), 12)
        self.assertEqual(cols[0], '0')  # index 0
        self.assertEqual(cols[1], '1')  # current wp

    def test_hil_packet_generation(self):
        pkt = generate_hil_telemetry_packet(step=10)
        self.assertEqual(pkt['source'], 'HIL_PHYSICAL_SIMULATOR')
        self.assertEqual(pkt['unit'], 'QUANTRO_ROVER_UNIT_01')
        self.assertIn('imu', pkt)
        self.assertIn('position', pkt)
        self.assertIn('life_support_plss', pkt)
        self.assertTrue(pkt['life_support_plss']['return_reserve_safe'])


if __name__ == '__main__':
    unittest.main()
