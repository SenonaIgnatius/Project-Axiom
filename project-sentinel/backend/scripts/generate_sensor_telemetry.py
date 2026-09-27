"""
Generates data/sensors.csv — SIMULATED structural telemetry for the demo
projects (no physical sensors are installed; the app labels this as simulated).

Values are not random noise: each asset's stress level is derived from that
project's real PAIMANA delay, budget variance and schedule slippage, so a
project that is badly behind shows a more stressed signal. Noise is seeded
from a stable hash of the project ID, so re-running produces identical output.

Usage (from backend/):  python scripts/generate_sensor_telemetry.py
"""

import sys
import zlib
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.demo_registry import build_demo_seed  # noqa: E402

N_POINTS = 30
END_DATE = datetime(2026, 8, 27)
OUT = Path(__file__).resolve().parent.parent / "data" / "sensors.csv"


def main():
    rows = []
    for p in build_demo_seed():
        stress = float(np.clip(np.mean([
            np.clip(p["delay_months"] / 36.0, 0, 1),
            np.clip(max(p["budget_variance_pct"], 0) / 50.0, 0, 1),
            np.clip(max(p["schedule_slippage"], 0) / 50.0, 0, 1),
        ]), 0, 1))
        rng = np.random.default_rng(zlib.crc32(p["id"].encode()))

        drift = np.linspace(0, stress * 0.6, N_POINTS)
        vib = np.clip(1.4 + stress * 4.3 + drift * (1.4 + stress * 4.3) * 0.5 + rng.normal(0, 0.15 + stress * 0.25, N_POINTS), 0.3, 9.5)
        temp = np.clip(25.0 + stress * 33.0 + drift * 8 + rng.normal(0, 1.0 + stress * 1.5, N_POINTS), 18, 78)
        strain = np.clip(230 + stress * 950 + drift * (230 + stress * 950) * 0.4 + rng.normal(0, 15 + stress * 40, N_POINTS), 80, 1600)
        tilt = np.clip(0.10 + stress * 2.4 + drift * 0.8 + rng.normal(0, 0.03 + stress * 0.08, N_POINTS), 0.02, 3.6)

        for i in range(N_POINTS):
            rows.append({
                "asset_id": f"AST-{p['id']}",
                "project_id": p["id"],
                "timestamp": (END_DATE - timedelta(days=N_POINTS - 1 - i)).strftime("%Y-%m-%d 06:00:00"),
                "vibration_mm_s": round(float(vib[i]), 3),
                "temperature_c": round(float(temp[i]), 2),
                "strain_microstrain": round(float(strain[i]), 2),
                "tilt_deg": round(float(tilt[i]), 3),
            })
    pd.DataFrame(rows).to_csv(OUT, index=False)
    print(f"wrote {len(rows)} rows for {len(rows) // N_POINTS} assets -> {OUT}")


if __name__ == "__main__":
    main()
