"""NASA Flight Software Qualification Test Suite (run: python tests/test_flight_qualification.py).
NASA NPR 7150.2D Class A/B Verification & FDIR Automated Stress Testing.
"""

import os
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'robotics'))

from fprime_flight_adapter import FPrimeFlightFrame, FlightTelemetryChannels, TLM_CHAN_POSITION
from fdir_watchdog import (
    FDIRWatchdog, STATE_STANDBY, STATE_TRAVERSE_ACTIVE,
    STATE_SHELTER_EVACUATION, STATE_SAFE_MODE, FAULT_IMU_TILT_EXCESSIVE
)


class TestFlightQualification(unittest.TestCase):
    def setUp(self):
        self.fdir = FDIRWatchdog(heartbeat_timeout_s=1.5)

    def test_fprime_serialization_and_crc32(self):
        nav_bytes = FlightTelemetryChannels.pack_navigation_telemetry(
            lat=18.384, lon=77.582, elev_m=-2450.0, heading_deg=180.0, speed_mps=0.8
        )
        frame = FPrimeFlightFrame(op_code=TLM_CHAN_POSITION, seq=42, payload_bytes=nav_bytes)
        wire_data = frame.serialize()

        # Wire length must be 20 (header) + 40 (payload) + 4 (crc32) = 64 bytes
        self.assertEqual(len(wire_data), 64)

        # Deserialize cleanly
        decoded = FPrimeFlightFrame.deserialize(wire_data)
        self.assertEqual(decoded.op_code, TLM_CHAN_POSITION)
        self.assertEqual(decoded.seq, 42)

        nav = FlightTelemetryChannels.unpack_navigation_telemetry(decoded.payload_bytes)
        self.assertAlmostEqual(nav['lat_deg'], 18.384, places=3)
        self.assertAlmostEqual(nav['elev_m'], -2450.0, delta=0.5)

    def test_fprime_single_event_upset_bitflip_rejection(self):
        """Simulates ionizing radiation Single-Event Upset (SEU) flipping a bit in memory."""
        nav_bytes = FlightTelemetryChannels.pack_navigation_telemetry(0.0, 0.0, 0.0, 0.0, 0.0)
        frame = FPrimeFlightFrame(op_code=TLM_CHAN_POSITION, seq=1, payload_bytes=nav_bytes)
        wire_data = bytearray(frame.serialize())

        # Corrupt 1 bit at byte 25
        wire_data[25] ^= 0x01

        # Checksum mismatch must raise ValueError
        with self.assertRaises(ValueError) as ctx:
            FPrimeFlightFrame.deserialize(bytes(wire_data))
        self.assertIn("CRC-32 Checksum Mismatch", str(ctx.exception))

    def test_fdir_nominal_and_heartbeat_timeout(self):
        self.fdir.feed_heartbeat()
        nom_pkt = {'imu': {'pitch_deg': 2.0, 'roll_deg': 1.0}}
        ok, mitigations = self.fdir.inspect_telemetry(nom_pkt)
        self.assertTrue(ok)
        self.assertEqual(mitigations, ["NOMINAL_FLIGHT_STATE"])

        # Simulate heartbeat timeout (> 1.5s)
        self.fdir.last_heartbeat_time = time.time() - 2.0
        ok, mitigations = self.fdir.inspect_telemetry(nom_pkt)
        self.assertFalse(ok)
        self.assertEqual(self.fdir.current_state, STATE_SAFE_MODE)
        self.assertIn("ACTION_LOCK_BRAKES_HEARTBEAT_LOSS", mitigations)

    def test_fdir_excessive_tilt_safe_mode(self):
        self.fdir.feed_heartbeat()
        tilt_pkt = {'imu': {'pitch_deg': 34.2, 'roll_deg': 2.0}}
        ok, mitigations = self.fdir.inspect_telemetry(tilt_pkt)
        self.assertFalse(ok)
        self.assertEqual(self.fdir.current_state, STATE_SAFE_MODE)
        self.assertIn("ACTION_LOCK_DRIVE_MOTORS_TILT_SAFETY", mitigations)

    def test_fdir_plss_depletion_evacuation(self):
        self.fdir.feed_heartbeat()
        self.fdir.transition_to(STATE_TRAVERSE_ACTIVE, "Traverse active")
        o2_pkt = {
            'imu': {'pitch_deg': 3.0, 'roll_deg': 1.0},
            'life_support_plss': {'o2_reserve_pct': 21.4}  # Breaches 25% minimum return reserve
        }
        ok, mitigations = self.fdir.inspect_telemetry(o2_pkt)
        self.assertFalse(ok)
        self.assertEqual(self.fdir.current_state, STATE_SHELTER_EVACUATION)
        self.assertIn("ACTION_TRIGGER_IMMEDIATE_WALKBACK_ABORT", mitigations)

    def test_deterministic_execution_latency(self):
        """Verifies that 1000 telemetry evaluation cycles execute in < 50ms total."""
        self.fdir.feed_heartbeat()
        pkt = {
            'imu': {'pitch_deg': 5.0, 'roll_deg': 3.0},
            'life_support_plss': {'o2_reserve_pct': 85.0},
            'bekker_terramechanics': {'sinkage_mm': 12.0, 'slip_risk_pct': 15}
        }
        start = time.perf_counter()
        for _ in range(1000):
            self.fdir.feed_heartbeat()
            self.fdir.inspect_telemetry(pkt)
        elapsed_ms = (time.perf_counter() - start) * 1000.0

        # Must be well below 50 ms for 1000 cycles (typical is 3-8 ms)
        self.assertLess(elapsed_ms, 50.0, f"Execution latency exceeded deadline: {elapsed_ms:.2f} ms")


if __name__ == '__main__':
    unittest.main()
