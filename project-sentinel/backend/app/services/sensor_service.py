import os
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

SENSORS_FILE = settings.DATA_DIR / "sensors.csv"


class SensorService:
    """
    Linear Asset Telemetry & Anomaly Detection Service (Static Dataset).
    
    Reads sensor time-series strictly from data/sensors.csv (simulated asset telemetry).
    Computes rolling z-score and threshold anomaly detection to produce deterministic
    Asset Health Scores (0-100).
    """

    _cached_df: Optional[pd.DataFrame] = None

    # In-memory scenario readings injected from the UI ("simulate" buttons),
    # keyed by project id. Never written to disk; cleared by the "normal" scenario.
    _overrides: Dict[str, Dict[str, float]] = {}

    SCENARIOS = {
        "vibration_spike": {"vibration_mm_s": 8.2},        # above the 7.1 mm/s critical limit
        "thermal_overload": {"temperature_c": 71.5},       # above the 68 °C critical limit
        "strain_critical": {"strain_microstrain": 1480.0}, # above the 1400 με critical limit
    }

    @staticmethod
    def _project_key(asset_id: str, project_id: Optional[str] = None) -> str:
        if project_id:
            return project_id
        for prefix in ("ASSET-", "AST-"):
            if asset_id.startswith(prefix):
                return asset_id[len(prefix):]
        return asset_id

    @classmethod
    def simulate_scenario(cls, asset_id: str, scenario: str) -> str:
        key = cls._project_key(asset_id)
        if scenario == "normal":
            cls._overrides.pop(key, None)
        elif scenario in cls.SCENARIOS:
            cls._overrides[key] = dict(cls.SCENARIOS[scenario])
        else:
            raise ValueError(f"Unknown scenario '{scenario}'")
        return key

    LIMITS = {
        "vibration": {"alert": 4.5, "critical": 7.1, "unit": "mm/s"},
        "temperature": {"alert": 55.0, "critical": 68.0, "unit": "deg_C"},
        "strain": {"alert": 800.0, "critical": 1400.0, "unit": "microstrain"},
        "tilt": {"alert": 1.5, "critical": 3.0, "unit": "deg"},
    }

    @classmethod
    def get_sensors_df(cls) -> pd.DataFrame:
        if cls._cached_df is None:
            if SENSORS_FILE.exists():
                cls._cached_df = pd.read_csv(SENSORS_FILE)
            else:
                logger.warning(f"Sensors CSV not found at {SENSORS_FILE}")
                cls._cached_df = pd.DataFrame()
        return cls._cached_df

    @classmethod
    def get_asset_health(cls, asset_id: str, project_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Reads asset telemetry from data/sensors.csv and computes:
        - current_health_score: 0-100
        - status: healthy, warning, critical
        - anomaly_z_score: statistical deviation
        - time-series history for charting
        """
        df = cls.get_sensors_df()

        # Find matching asset rows (empty frame when sensors.csv is absent)
        key = cls._project_key(asset_id, project_id)
        if df.empty:
            matched = df
        else:
            matched = df[(df["asset_id"] == asset_id) | (df["project_id"] == key)]

        if matched.empty:
            # No telemetry for this asset. Previously this borrowed the first asset
            # in the file (or hardcoded "healthy" values); say so instead. A neutral
            # health of 100 means no sensor penalty is added to the risk score.
            return {
                "asset_id": asset_id,
                "project_id": key,
                "available": False,
                "current_health_score": 100.0,
                "status": "unknown",
                "vibration_rms": None,
                "temperature_c": None,
                "strain_microstrain": None,
                "tilt_deg": None,
                "anomaly_z_score": 0.0,
                "data_source": "unavailable: no telemetry for this asset",
                "last_updated": "",
                "history": [],
            }

        override = cls._overrides.get(key)
        if override:
            injected = matched.iloc[-1].copy()
            injected["timestamp"] = (pd.to_datetime(injected["timestamp"]) + pd.Timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
            for col, val in override.items():
                injected[col] = val
            matched = pd.concat([matched, injected.to_frame().T], ignore_index=True)
            for col in ("vibration_mm_s", "temperature_c", "strain_microstrain", "tilt_deg"):
                matched[col] = pd.to_numeric(matched[col])

        # Latest window (last 30 points)
        recent = matched.tail(30)
        latest_row = recent.iloc[-1]

        vib_latest = float(latest_row["vibration_mm_s"])
        temp_latest = float(latest_row["temperature_c"])
        strain_latest = float(latest_row["strain_microstrain"])
        tilt_latest = float(latest_row["tilt_deg"])

        # Compute rolling z-scores over the asset's history
        vib_mean = float(matched["vibration_mm_s"].mean())
        vib_std = float(matched["vibration_mm_s"].std()) if len(matched) > 1 else 0.5
        z_vib = abs(vib_latest - vib_mean) / vib_std if vib_std > 1e-3 else 0.0

        strain_mean = float(matched["strain_microstrain"].mean())
        strain_std = float(matched["strain_microstrain"].std()) if len(matched) > 1 else 50.0
        z_strain = abs(strain_latest - strain_mean) / strain_std if strain_std > 1e-3 else 0.0

        max_z = max(z_vib, z_strain)

        # Threshold penalties
        penalties = 0.0
        if vib_latest >= cls.LIMITS["vibration"]["critical"]:
            penalties += 45.0
        elif vib_latest >= cls.LIMITS["vibration"]["alert"]:
            penalties += 20.0

        if strain_latest >= cls.LIMITS["strain"]["critical"]:
            penalties += 40.0
        elif strain_latest >= cls.LIMITS["strain"]["alert"]:
            penalties += 18.0

        if temp_latest >= cls.LIMITS["temperature"]["critical"]:
            penalties += 30.0
        elif temp_latest >= cls.LIMITS["temperature"]["alert"]:
            penalties += 15.0

        if tilt_latest >= cls.LIMITS["tilt"]["critical"]:
            penalties += 35.0
        elif tilt_latest >= cls.LIMITS["tilt"]["alert"]:
            penalties += 15.0

        # Anomaly penalty for statistical spikes (z > 2.0)
        z_penalty = max(0.0, (max_z - 1.5) * 10.0)

        health_score = max(0.0, min(100.0, 100.0 - (penalties + z_penalty)))

        if health_score >= 75.0:
            status = "healthy"
        elif health_score >= 45.0:
            status = "warning"
        else:
            status = "critical"

        history_points = [
            {
                "timestamp": str(r["timestamp"]),
                "health_score": round(max(0.0, min(100.0, 100.0 - (
                    (35.0 if r["vibration_mm_s"] > cls.LIMITS["vibration"]["alert"] else 0.0) +
                    (30.0 if r["strain_microstrain"] > cls.LIMITS["strain"]["alert"] else 0.0)
                ))), 1),
                "status": "warning" if (r["vibration_mm_s"] > 4.5 or r["strain_microstrain"] > 800) else "healthy",
                "vibration": round(float(r["vibration_mm_s"]), 2),
                "temperature": round(float(r["temperature_c"]), 1),
                "strain": round(float(r["strain_microstrain"]), 1),
                "tilt": round(float(r["tilt_deg"]), 2),
                "z_score": round(float(abs(r["vibration_mm_s"] - vib_mean) / vib_std), 2),
            }
            for _, r in recent.iterrows()
        ]

        return {
            "asset_id": asset_id,
            "project_id": str(latest_row.get("project_id", project_id or "")),
            "current_health_score": round(health_score, 1),
            "status": status,
            "vibration_rms": round(vib_latest, 2),
            "temperature_c": round(temp_latest, 1),
            "strain_microstrain": round(strain_latest, 1),
            "tilt_deg": round(tilt_latest, 2),
            "anomaly_z_score": round(max_z, 2),
            "available": True,
            "simulated_scenario": next((n for n, v in cls.SCENARIOS.items() if override == v), None) if override else None,
            "data_source": "simulated:data/sensors.csv",
            "last_updated": str(latest_row["timestamp"]),
            "history": history_points,
        }
