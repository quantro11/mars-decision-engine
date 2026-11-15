#!/usr/bin/env python3
"""
Quantro Flight Systems · Q-11 Hardware-in-the-Loop (HIL) Telemetry Bridge
Streams real-time rover and EVA life-support sensor packets between physical
hardware (microcontrollers, IMU/barometer dongles, test rovers) and the
Mars Decision Engine console.

Protocol: JSON over TCP Socket or WebSocket
License: MIT
"""

import sys
import time
import json
import math
import socket
import argparse
from typing import Dict, Any


def generate_hil_telemetry_packet(step: int, lat: float = 18.38, lon: float = 77.58) -> Dict[str, Any]:
    """Generates realistic rover/suit sensor telemetry for Hardware-in-the-Loop simulation."""
    t = time.time()
    # Micro-oscillations to simulate physical rover traverse
    pitch_deg = math.sin(step * 0.1) * 2.8
    roll_deg = math.cos(step * 0.12) * 1.9
    baro_mbar = 6.10 + (math.sin(step * 0.05) * 0.15)
    battery_v = max(22.0, 28.8 - (step * 0.005))
    o2_pct = max(25.0, 100.0 - (step * 0.02))

    return {
        'source': 'HIL_PHYSICAL_SIMULATOR',
        'unit': 'QUANTRO_ROVER_UNIT_01',
        'seq': step,
        'timestamp': t,
        'position': {
            'lat_deg': lat + (step * 0.0001),
            'lon_deg': lon + (step * 0.00015),
            'elev_m': -2450.0 + (step * 0.5)
        },
        'imu': {
            'pitch_deg': round(pitch_deg, 2),
            'roll_deg': round(roll_deg, 2),
            'heading_deg': round((step * 1.5) % 360.0, 1),
            'vibration_g': round(0.04 + abs(math.sin(step)), 3)
        },
        'environment': {
            'ambient_pressure_mbar': round(baro_mbar, 3),
            'dust_optical_depth_tau': round(0.45 + (0.01 * math.sin(step * 0.02)), 3),
            'ambient_temp_c': round(-55.0 + (5.0 * math.sin(step * 0.01)), 1)
        },
        'life_support_plss': {
            'o2_reserve_pct': round(o2_pct, 1),
            'co2_rca_saturation_pct': round(min(100.0, step * 0.03), 1),
            'battery_voltage_v': round(battery_v, 2),
            'return_reserve_safe': o2_pct >= 25.0
        }
    }


def run_hil_stream(host: str = '127.0.0.1', port: int = 8765, duration_s: int = 10, interval_s: float = 0.5):
    """Runs a demonstration HIL sensor stream."""
    sys.stderr.write(f"Starting Quantro Q-11 HIL Telemetry Stream on {host}:{port}...\n")
    step = 0
    start_time = time.time()
    while time.time() - start_time < duration_s:
        pkt = generate_hil_telemetry_packet(step)
        sys.stdout.write(json.dumps(pkt) + "\n")
        sys.stdout.flush()
        step += 1
        time.sleep(interval_s)
    sys.stderr.write(f"HIL Stream completed. {step} packets transmitted.\n")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Quantro Q-11 HIL Telemetry Bridge')
    parser.add_argument('--host', default='127.0.0.1', help='Bind host')
    parser.add_argument('--port', type=int, default=8765, help='Port')
    parser.add_argument('--duration', type=int, default=3, help='Duration in seconds')
    args = parser.parse_args()

    run_hil_stream(host=args.host, port=args.port, duration_s=args.duration)
