"""
Fetches REAL daily rainfall and temperature for each demo project's site
coordinates from the Open-Meteo historical archive (free, no API key) and
appends it to data/rainfall.csv, keyed by the project's PAIMANA code — the
same key the weather service already looks up.

Needs internet. Run once from backend/ on your own machine:
    python scripts/fetch_rainfall.py

Projects already present in rainfall.csv are skipped, so it is safe to re-run.
"""

import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services.demo_registry import build_demo_seed  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data" / "rainfall.csv"
START, END = "2023-01-01", "2025-12-31"
FIELDS = ["project_code", "date", "rainfall_mm", "temp_avg_c", "temp_max_c", "temp_min_c"]
API = "https://archive-api.open-meteo.com/v1/archive"


def existing_codes():
    if not OUT.exists():
        return set()
    with OUT.open(newline="", encoding="utf-8") as f:
        return {row["project_code"].replace(".0", "").strip() for row in csv.DictReader(f)}


def fetch(lat, lng):
    query = urllib.parse.urlencode({
        "latitude": lat, "longitude": lng, "start_date": START, "end_date": END,
        "daily": "precipitation_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min",
        "timezone": "Asia/Kolkata",
    })
    with urllib.request.urlopen(f"{API}?{query}", timeout=60) as r:
        return json.loads(r.read())["daily"]


def to_rows(code, daily):
    rows = []
    for i, day in enumerate(daily["time"]):
        rain = daily["precipitation_sum"][i]
        if rain is None:
            continue
        rows.append({
            "project_code": code,
            "date": day.replace("-", ""),
            "rainfall_mm": rain,
            "temp_avg_c": daily["temperature_2m_mean"][i],
            "temp_max_c": daily["temperature_2m_max"][i],
            "temp_min_c": daily["temperature_2m_min"][i],
        })
    return rows


def main():
    have = existing_codes()
    new_file = not OUT.exists()
    added = 0
    with OUT.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if new_file:
            writer.writeheader()
        for p in build_demo_seed():
            code = p["project_code"]
            if code in have:
                print(f"skip  {p['id']} ({code}) — already in rainfall.csv")
                continue
            try:
                rows = to_rows(code, fetch(p["latitude"], p["longitude"]))
            except Exception as e:  # keep going for the other projects
                print(f"FAIL  {p['id']} ({code}): {e}")
                continue
            writer.writerows(rows)
            added += 1
            print(f"ok    {p['id']} ({code}): {len(rows)} days")
            time.sleep(1)  # be polite to the free API
    print(f"\nAdded rainfall for {added} project(s). Restart the backend to pick it up.")


if __name__ == "__main__":
    main()
