#!/usr/bin/env python3
"""
Quantro Flight Systems · Q-11 MAVLink Mission Waypoint Exporter
Generates valid MAVLink Waypoint Protocol (WPL 110) files for QGroundControl,
Mission Planner, PX4, and ArduPilot autopilots.

Enables terrestrial analog rovers and Mars mission test vehicles to directly
execute traverses computed by the Mars Base Decision Engine.

License: MIT
"""

import sys
import os
import json
import argparse
from typing import List, Dict, Any, Optional

# MAVLink Mission Constants
MAV_CMD_NAV_WAYPOINT = 16
MAV_CMD_NAV_LOITER_UNLIM = 17
MAV_FRAME_GLOBAL_RELATIVE_ALT = 3
AUTOCONTINUE_TRUE = 1


def format_mavlink_waypoint_line(
    seq: int,
    current: int,
    frame: int,
    command: int,
    p1: float,
    p2: float,
    p3: float,
    p4: float,
    lat: float,
    lon: float,
    alt: float,
    autocontinue: int = AUTOCONTINUE_TRUE
) -> str:
    """Formats a single line according to QGroundControl WPL 110 specification."""
    return f"{seq}\t{current}\t{frame}\t{command}\t{p1:.6f}\t{p2:.6f}\t{p3:.6f}\t{p4:.6f}\t{lat:.8f}\t{lon:.8f}\t{alt:.6f}\t{autocontinue}"


def export_mavlink_mission(
    waypoints: List[Dict[str, Any]],
    home_lat: float,
    home_lon: float,
    home_alt_m: float = 0.0,
    cruise_speed_mps: float = 0.67
) -> str:
    """Converts a sequence of traverse coordinates into a standard MAVLink WPL 110 file."""
    lines = ["QGC WPL 110"]

    # Waypoint 0: Home Position (Current = 1)
    lines.append(format_mavlink_waypoint_line(
        seq=0, current=1, frame=0, command=MAV_CMD_NAV_WAYPOINT,
        p1=0.0, p2=0.0, p3=0.0, p4=0.0,
        lat=home_lat, lon=home_lon, alt=home_alt_m, autocontinue=1
    ))

    # Sequential Traversed Waypoints
    for idx, wp in enumerate(waypoints, start=1):
        lat = float(wp.get('lat', home_lat))
        lon = float(wp.get('lon', home_lon))
        alt = float(wp.get('elev_m', 2.0))  # Relative elevation offset above surface
        cmd = MAV_CMD_NAV_LOITER_UNLIM if wp.get('is_rest_stop') else MAV_CMD_NAV_WAYPOINT
        param1_hold_time = 300.0 if wp.get('is_rest_stop') else 0.0  # 5 min hold on rest stops

        lines.append(format_mavlink_waypoint_line(
            seq=idx, current=0, frame=MAV_FRAME_GLOBAL_RELATIVE_ALT, command=cmd,
            p1=param1_hold_time, p2=0.0, p3=0.0, p4=0.0,
            lat=lat, lon=lon, alt=alt, autocontinue=1
        ))

    return "\n".join(lines) + "\n"


def convert_brief_json_to_mavlink(brief_json_path: str, output_wpl_path: str) -> None:
    """Reads a Mars Decision Engine brief JSON export and writes out a .waypoints flight plan."""
    with open(brief_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    cands = data.get('top_candidates', [])
    if not cands:
        sys.stderr.write("No candidate sites found in brief.\n")
        return

    home = cands[0]
    waypoints = []
    for c in cands:
        waypoints.append({
            'lat': c.get('lat_deg'),
            'lon': c.get('lon_deg'),
            'elev_m': 2.0,
            'is_rest_stop': False
        })

    content = export_mavlink_mission(
        waypoints=waypoints,
        home_lat=home.get('lat_deg', 0.0),
        home_lon=home.get('lon_deg', 0.0),
        home_alt_m=0.0
    )

    with open(output_wpl_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Exported {len(waypoints)} waypoints to MAVLink mission: {output_wpl_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Quantro Q-11 MAVLink Waypoint Exporter')
    parser.add_argument('input_json', nargs='?', help='Input Mission Brief JSON')
    parser.add_argument('-o', '--output', default='mission.waypoints', help='Output .waypoints file')
    args = parser.parse_args()

    if args.input_json and os.path.exists(args.input_json):
        convert_brief_json_to_mavlink(args.input_json, args.output)
    else:
        # Sample mission export
        sample_wps = [
            {'lat': 18.38, 'lon': 77.58, 'elev_m': 2.0, 'is_rest_stop': False},
            {'lat': 18.42, 'lon': 77.62, 'elev_m': 2.0, 'is_rest_stop': True},
            {'lat': 18.48, 'lon': 77.69, 'elev_m': 2.0, 'is_rest_stop': False},
        ]
        res = export_mavlink_mission(sample_wps, home_lat=18.35, home_lon=77.50)
        sys.stdout.write(res)
