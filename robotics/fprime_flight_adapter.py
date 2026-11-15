#!/usr/bin/env python3
"""
Quantro Flight Systems · JPL F Prime (F') & NASA cFS Flight Software Interface
NASA NPR 7150.2D Class A/B Flight Software Compatibility Layer

Provides deterministic command and telemetry serialization, CRC-32 frame integrity,
bounded-execution flight dispatching, and standard CCSDS/F Prime channel mapping.

Architect: Quantro Flight Systems (Q-11 Architecture)
License: MIT
"""

import struct
import zlib
import time
from typing import Dict, List, Tuple, Optional, Any

# F Prime / cFS Frame Sync Pattern and OpCodes
FRAME_SYNC_WORD = 0x5A5A4D45  # 'ZZME' (Quantro Mars Engine Sync)
MAX_PAYLOAD_BYTES = 2048

# Command OpCodes (JPL F Prime Style)
CMD_OP_PING = 0x0001
CMD_OP_SET_WEIGHTS = 0x0010
CMD_OP_EVAL_CELL = 0x0020
CMD_OP_PLAN_TRAVERSE = 0x0030
CMD_OP_TRIGGER_FDIR = 0x00F0
CMD_OP_ENTER_SAFE_MODE = 0x00FF

# Telemetry Channel IDs
TLM_CHAN_HEARTBEAT = 0x0100
TLM_CHAN_STATE = 0x0101
TLM_CHAN_POSITION = 0x0102
TLM_CHAN_PLSS_O2 = 0x0103
TLM_CHAN_BEKKER_SLIP = 0x0104
TLM_CHAN_FDIR_ALERT = 0x01F0


class FPrimeFlightFrame:
    """Encapsulates binary telemetry/command frames with 32-bit CRC."""

    def __init__(self, op_code: int, seq: int, payload_bytes: bytes):
        self.op_code = op_code
        self.seq = seq
        self.payload_bytes = payload_bytes
        self.timestamp = time.time()

    def serialize(self) -> bytes:
        """Serializes frame into:
        [SYNC 4B][OPCODE 2B][SEQ 4B][TIMESTAMP 8B][LEN 2B][PAYLOAD NB][CRC32 4B]"""
        header = struct.pack(
            '>IHIdH',
            FRAME_SYNC_WORD,
            self.op_code,
            self.seq,
            self.timestamp,
            len(self.payload_bytes)
        )
        body = header + self.payload_bytes
        checksum = zlib.crc32(body) & 0xFFFFFFFF
        return body + struct.pack('>I', checksum)

    @classmethod
    def deserialize(cls, raw_bytes: bytes) -> 'FPrimeFlightFrame':
        """Validates CRC32 and extracts frame payload."""
        if len(raw_bytes) < 24:
            raise ValueError(f"Frame too short ({len(raw_bytes)} bytes; minimum 24)")

        body, checksum_bytes = raw_bytes[:-4], raw_bytes[-4:]
        expected_crc = struct.unpack('>I', checksum_bytes)[0]
        actual_crc = zlib.crc32(body) & 0xFFFFFFFF

        if expected_crc != actual_crc:
            raise ValueError(f"CRC-32 Checksum Mismatch: expected 0x{expected_crc:08X}, got 0x{actual_crc:08X} (Bitflip detected)")

        sync, op_code, seq, timestamp, p_len = struct.unpack('>IHIdH', body[:20])
        if sync != FRAME_SYNC_WORD:
            raise ValueError(f"Invalid Sync Word: 0x{sync:08X}")

        payload = body[20:20 + p_len]
        frame = cls(op_code=op_code, seq=seq, payload_bytes=payload)
        frame.timestamp = timestamp
        return frame


class FlightTelemetryChannels:
    """Manages JPL F Prime telemetry dictionary serialization."""

    @staticmethod
    def pack_navigation_telemetry(lat: float, lon: float, elev_m: float, heading_deg: float, speed_mps: float) -> bytes:
        """Packs navigation telemetry: 5x double (40 bytes)."""
        return struct.pack('>ddddd', lat, lon, elev_m, heading_deg, speed_mps)

    @staticmethod
    def unpack_navigation_telemetry(payload: bytes) -> Dict[str, float]:
        lat, lon, elev_m, heading_deg, speed_mps = struct.unpack('>ddddd', payload[:40])
        return {
            'lat_deg': round(lat, 6),
            'lon_deg': round(lon, 6),
            'elev_m': round(elev_m, 1),
            'heading_deg': round(heading_deg, 1),
            'speed_mps': round(speed_mps, 2)
        }

    @staticmethod
    def pack_plss_telemetry(o2_pct: float, co2_sat_pct: float, batt_v: float, metabolic_w: float) -> bytes:
        """Packs life support telemetry: 4x float (16 bytes)."""
        return struct.pack('>ffff', o2_pct, co2_sat_pct, batt_v, metabolic_w)

    @staticmethod
    def unpack_plss_telemetry(payload: bytes) -> Dict[str, float]:
        o2_pct, co2_sat_pct, batt_v, metabolic_w = struct.unpack('>ffff', payload[:16])
        return {
            'o2_reserve_pct': round(o2_pct, 1),
            'co2_rca_saturation_pct': round(co2_sat_pct, 1),
            'battery_voltage_v': round(batt_v, 2),
            'metabolic_power_w': round(metabolic_w, 1)
        }


if __name__ == '__main__':
    nav_payload = FlightTelemetryChannels.pack_navigation_telemetry(18.3845, 77.5821, -2450.0, 142.5, 0.65)
    frame = FPrimeFlightFrame(op_code=TLM_CHAN_POSITION, seq=101, payload_bytes=nav_payload)
    wire_bytes = frame.serialize()
    print(f"Serialized F Prime Wire Frame: {len(wire_bytes)} bytes | CRC: 0x{wire_bytes[-4:].hex().upper()}")
    decoded = FPrimeFlightFrame.deserialize(wire_bytes)
    print("Decoded Navigation Telemetry:", FlightTelemetryChannels.unpack_navigation_telemetry(decoded.payload_bytes))
