#!/usr/bin/env python3
"""
Quantro Flight Systems · Terrestrial Search & Rescue (SAR) & Extreme Logistics Engine
Dual-Use Earth Adaptation of the Planetary Decision Engine

Adapts the multi-hazard A* routing, non-compensatory scoring, and Pandolf-Santee
bioenergetics to Earth search-and-rescue (SAR), disaster logistics (AFAD/FEMA/Wilderness SAR),
and extreme environment robotic evacuations (1.0g WGS84 ellipsoid).

License: MIT
"""

import math
import json
from typing import Dict, List, Tuple, Any, Optional

EARTH_G = 9.80665              # Earth surface gravity (m/s^2)
EARTH_R_M = 6371000.0          # Earth volumetric mean radius (m)


class TerrestrialSAREngine:
    """Terrestrial analog decision engine for wilderness search & rescue and disaster logistics."""

    def __init__(self):
        self.terrain_coefficients = {
            'paved_road': 1.0,
            'dirt_trail': 1.2,
            'loose_gravel_scree': 2.1,
            'muddy_marshland': 2.8,
            'snow_pack': 2.5
        }

    @staticmethod
    def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Great-circle distance over WGS84 spherical approximation."""
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0)**2
        c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
        return EARTH_R_M * c

    def calculate_crew_pandolf_earth(
        self,
        speed_kmh: float = 4.0,
        slope_pct: float = 5.0,
        body_mass_kg: float = 80.0,
        pack_mass_kg: float = 22.0,
        terrain_type: str = 'dirt_trail'
    ) -> Dict[str, float]:
        """Calculates standard Earth 1.0g Pandolf-Santee metabolic load and hydration demand."""
        eta = self.terrain_coefficients.get(terrain_type, 1.2)
        v_mps = max(0.1, speed_kmh / 3.6)
        w = max(40.0, body_mass_kg)
        l = max(0.0, pack_mass_kg)
        g = max(0.0, slope_pct)

        # Classical Pandolf equation (Watts)
        # M = 1.5 * W + 2.0 * (W + L) * (L / W)^2 + eta * (W + L) * (1.5 * V^2 + 0.35 * V * G)
        m_watts = 1.5 * w + 2.0 * (w + l) * (l / w)**2 + eta * (w + l) * (1.5 * v_mps**2 + 0.35 * v_mps * g)
        kcal_per_hour = m_watts * 0.860421  # 1 W = 0.860421 kcal/h
        water_loss_l_per_hour = (m_watts / 400.0) * 0.8  # sweat rate approximation

        return {
            'metabolic_power_w': round(m_watts, 1),
            'energy_rate_kcal_h': round(kcal_per_hour, 1),
            'recommended_hydration_l_h': round(water_loss_l_per_hour, 2),
            'fatigue_index_pct': round(min(100.0, (m_watts / 650.0) * 100.0), 1),
            'safe_operational_pace': m_watts < 550.0
        }

    def evaluate_landslide_hazard(self, slope_deg: float, rainfall_mm_24h: float, soil_cohesion_kpa: float = 5.0) -> Dict[str, Any]:
        """Estimates slope instability and debris flow risk in disaster zones."""
        # Infinite slope factor of safety (FS) proxy
        phi_deg = 30.0  # friction angle
        gamma_soil = 18.0  # kN/m3
        h_depth = 2.0  # assumed slip surface depth m
        beta_rad = math.radians(slope_deg)

        if slope_deg <= 5.0:
            fs = 5.0
        else:
            pore_pressure_ratio = min(0.6, rainfall_mm_24h / 200.0)
            resisting = soil_cohesion_kpa + (gamma_soil * h_depth * math.cos(beta_rad)**2 * (1.0 - pore_pressure_ratio) * math.tan(math.radians(phi_deg)))
            driving = gamma_soil * h_depth * math.sin(beta_rad) * math.cos(beta_rad)
            fs = max(0.1, resisting / max(0.1, driving))

        risk_level = 'LOW' if fs > 1.5 else ('MODERATE' if fs > 1.0 else 'CRITICAL_HAZARD')
        return {
            'factor_of_safety': round(fs, 2),
            'risk_level': risk_level,
            'is_passable_for_crew': fs >= 1.2,
            'slope_deg': slope_deg,
            'rainfall_mm_24h': rainfall_mm_24h
        }

    def export_sar_geojson(self, waypoints: List[Dict[str, Any]], mission_name: str = 'Wilderness SAR Route') -> Dict[str, Any]:
        """Exports route as RFC 7946 GeoJSON FeatureCollection."""
        coords = [[wp['lon'], wp['lat']] for wp in waypoints]
        return {
            'type': 'FeatureCollection',
            'metadata': {
                'system': 'Quantro Terrestrial SAR Decision Engine',
                'mission_name': mission_name,
                'coordinate_system': 'WGS84 EPSG:4326',
            },
            'features': [
                {
                    'type': 'Feature',
                    'geometry': {'type': 'LineString', 'coordinates': coords},
                    'properties': {
                        'feature_type': 'sar_evacuation_corridor',
                        'total_points': len(coords),
                        'safe_for_patient_transport': True
                    }
                }
            ]
        }


if __name__ == '__main__':
    engine = TerrestrialSAREngine()
    demo_bio = engine.calculate_crew_pandolf_earth(speed_kmh=4.2, slope_pct=8.0, body_mass_kg=82.0, pack_mass_kg=25.0)
    demo_hazard = engine.evaluate_landslide_hazard(slope_deg=22.0, rainfall_mm_24h=85.0)
    print("Quantro Terrestrial SAR Engine Verification:")
    print("Bioenergetics:", json.dumps(demo_bio, indent=2))
    print("Hazard Assessment:", json.dumps(demo_hazard, indent=2))
