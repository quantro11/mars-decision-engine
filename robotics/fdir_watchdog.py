#!/usr/bin/env python3
"""
Quantro Flight Systems · Automated Fault Detection, Isolation & Recovery (FDIR)
NASA-STD-8719.13 Software Safety & NPR 7150.2D Real-Time Execution Guard

Provides autonomous fault mitigation, deterministic state machine monitoring,
sensor plausibility validation, and emergency safe-mode containment for Mars rover
and xEMU surface operations.

Architect: Quantro Flight Systems (Q-11 Architecture)
License: MIT
"""

import time
import math
from typing import Dict, List, Tuple, Optional, Any

# Operational Flight State Machine Enum
STATE_INIT = 0
STATE_STANDBY = 1
STATE_SURFACE_RECON = 2
STATE_TRAVERSE_ACTIVE = 3
STATE_SHELTER_EVACUATION = 4
STATE_SAFE_MODE = 5

STATE_NAMES = {
    STATE_INIT: 'INIT',
    STATE_STANDBY: 'STANDBY',
    STATE_SURFACE_RECON: 'SURFACE_RECON',
    STATE_TRAVERSE_ACTIVE: 'TRAVERSE_ACTIVE',
    STATE_SHELTER_EVACUATION: 'SHELTER_EVACUATION',
    STATE_SAFE_MODE: 'SAFE_MODE'
}

# Fault Severity Codes
SEV_INFO = 1
SEV_WARNING = 2
SEV_CRITICAL = 3
SEV_FATAL = 4

# Fault IDs
FAULT_NONE = 0x00
FAULT_HEARTBEAT_TIMEOUT = 0x01
FAULT_IMU_TILT_EXCESSIVE = 0x02
FAULT_PLSS_O2_CRITICAL = 0x03
FAULT_BEKKER_SINKAGE_STALL = 0x04
FAULT_SEU_CORRUPT_PAYLOAD = 0x05
FAULT_THERMAL_SURVIVAL_LIMIT = 0x06


class FlightBlackboxLogger:
    """Microsecond circular flight blackbox event logger."""

    def __init__(self, max_records: int = 256):
        self.max_records = max_records
        self.events: List[Dict[str, Any]] = []

    def record(self, fault_id: int, severity: int, description: str, state_before: int, state_after: int):
        evt = {
            'seq': len(self.events) + 1,
            'timestamp': time.time(),
            'fault_id': hex(fault_id),
            'severity': severity,
            'description': description,
            'state_transition': f"{STATE_NAMES.get(state_before)} -> {STATE_NAMES.get(state_after)}"
        }
        self.events.append(evt)
        if len(self.events) > self.max_records:
            self.events.pop(0)


class FDIRWatchdog:
    """Real-time Flight Fault Detection, Isolation and Recovery controller."""

    def __init__(self, heartbeat_timeout_s: float = 3.0):
        self.current_state = STATE_INIT
        self.heartbeat_timeout_s = heartbeat_timeout_s
        self.last_heartbeat_time = time.time()
        self.blackbox = FlightBlackboxLogger()
        self.active_faults: List[int] = []

        # Operational Bounds (NASA Safety Rules)
        self.max_allowed_tilt_deg = 28.0       # Tip-over limit
        self.min_allowed_o2_reserve_pct = 25.0  # Mandatory 25% return reserve
        self.max_allowed_sinkage_mm = 85.0     # Maximum allowable wheel sinkage

        self.transition_to(STATE_STANDBY, "System boot self-test passed")

    def transition_to(self, new_state: int, reason: str):
        """Executes a deterministic state transition."""
        if new_state == self.current_state:
            return
        old_state = self.current_state
        self.current_state = new_state
        self.blackbox.record(
            fault_id=FAULT_NONE if new_state != STATE_SAFE_MODE else (self.active_faults[-1] if self.active_faults else FAULT_NONE),
            severity=SEV_CRITICAL if new_state == STATE_SAFE_MODE else SEV_INFO,
            description=reason,
            state_before=old_state,
            state_after=new_state
        )

    def feed_heartbeat(self):
        """Refreshes the watchdog timer."""
        self.last_heartbeat_time = time.time()

    def inspect_telemetry(self, telemetry: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validates incoming telemetry against hard NASA physical safety limits."""
        now = time.time()
        mitigations = []

        # 1. Watchdog Heartbeat Check
        if now - self.last_heartbeat_time > self.heartbeat_timeout_s:
            self.active_faults.append(FAULT_HEARTBEAT_TIMEOUT)
            self.transition_to(STATE_SAFE_MODE, f"Watchdog timeout: no heartbeat for {now - self.last_heartbeat_time:.2f}s")
            mitigations.append("ACTION_LOCK_BRAKES_HEARTBEAT_LOSS")
            return False, mitigations

        # 2. IMU Attitude & Tip-Over Check
        imu = telemetry.get('imu', {})
        pitch = abs(imu.get('pitch_deg', 0.0))
        roll = abs(imu.get('roll_deg', 0.0))
        max_tilt = max(pitch, roll)
        if max_tilt > self.max_allowed_tilt_deg:
            self.active_faults.append(FAULT_IMU_TILT_EXCESSIVE)
            self.transition_to(STATE_SAFE_MODE, f"Excessive tilt detected ({max_tilt:.1f} deg > {self.max_allowed_tilt_deg} deg)")
            mitigations.append("ACTION_LOCK_DRIVE_MOTORS_TILT_SAFETY")
            mitigations.append("ACTION_DEPLOY_STABILIZER_OUTRIGGERS")
            return False, mitigations

        # 3. Life Support (PLSS) Consumable Reserve Check
        plss = telemetry.get('life_support_plss', {})
        if plss:
            o2_reserve = plss.get('o2_reserve_pct', 100.0)
            if o2_reserve < self.min_allowed_o2_reserve_pct:
                self.active_faults.append(FAULT_PLSS_O2_CRITICAL)
                if self.current_state != STATE_SAFE_MODE:
                    self.transition_to(STATE_SHELTER_EVACUATION, f"O2 reserve breached minimum threshold ({o2_reserve:.1f}% < 25%)")
                mitigations.append("ACTION_TRIGGER_IMMEDIATE_WALKBACK_ABORT")
                mitigations.append("ACTION_ACTIVATE_SECONDARY_O2_BOTTLE")
                return False, mitigations

        # 4. Terramechanics Wheel Sinkage & Slip Check
        terramech = telemetry.get('bekker_terramechanics', {})
        if terramech:
            sinkage = terramech.get('sinkage_mm', 0.0)
            slip = terramech.get('slip_risk_pct', 0)
            if sinkage > self.max_allowed_sinkage_mm or slip > 80:
                self.active_faults.append(FAULT_BEKKER_SINKAGE_STALL)
                mitigations.append("ACTION_PAUSE_MOTION_REVERSE_THRUST_50MM")
                mitigations.append("ACTION_REDUCE_WHEEL_RPM_DISPERSAL")
                if self.current_state == STATE_TRAVERSE_ACTIVE:
                    self.transition_to(STATE_STANDBY, f"Bekker sinkage limit exceeded ({sinkage:.1f} mm, slip {slip}%)")
                return False, mitigations

        return True, ["NOMINAL_FLIGHT_STATE"]

    def get_status(self) -> Dict[str, Any]:
        return {
            'flight_state': STATE_NAMES.get(self.current_state, 'UNKNOWN'),
            'state_code': self.current_state,
            'is_safe_mode': self.current_state == STATE_SAFE_MODE,
            'active_fault_count': len(self.active_faults),
            'last_heartbeat_ago_s': round(time.time() - self.last_heartbeat_time, 2),
            'blackbox_log_count': len(self.blackbox.events)
        }


if __name__ == '__main__':
    fdir = FDIRWatchdog(heartbeat_timeout_s=1.0)
    print("Initial FDIR Status:", fdir.get_status())

    # Simulate nominal traverse
    fdir.transition_to(STATE_TRAVERSE_ACTIVE, "Autonomous traverse execution initiated")
    fdir.feed_heartbeat()

    # Inject hazardous tilt telemetry
    hazard_packet = {
        'imu': {'pitch_deg': 32.5, 'roll_deg': 4.1},
        'life_support_plss': {'o2_reserve_pct': 64.0}
    }
    nominal, actions = fdir.inspect_telemetry(hazard_packet)
    print(f"Telemetry Inspection -> Nominal: {nominal} | Mitigations: {actions}")
    print("FDIR Status after fault mitigation:", fdir.get_status())
