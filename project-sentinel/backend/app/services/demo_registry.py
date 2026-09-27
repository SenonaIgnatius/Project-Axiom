"""
Demo project registry.

Every figure the app presents as "reported" (cost, expenditure, physical
progress, dates) comes from the real MoSPI PAIMANA flash report
(December 2025), via data/paimana/paimana_projects.json, which is produced
from the PDF by scripts/extract_paimana_dataset.py and keeps the page each
row came from.

This file only adds what the report does not contain:
  - site coordinates, zoom and AOI box (set by the team; approximate),
  - which cached before/after imagery belongs to the site,
  - an ILLUSTRATIVE "verified" figure, expressed as a gap below the reported
    figure, standing in until live satellite/photo verification is run.
    It is labelled as illustrative everywhere it is shown.
"""

import json
from datetime import date
from functools import lru_cache
from statistics import mean
from typing import Any, Dict, List, Optional

from app.config import settings

REPORT_LABEL = "MoSPI PAIMANA Flash Report, December 2025"
REPORT_MONTH = "2025-12"
REPORT_REF_DATE = date(2025, 12, 31)  # figures in the report are "as of" this month
DATASET_PATH = settings.DATA_DIR / "paimana" / "paimana_projects.json"

DEMO_SITES: List[Dict[str, Any]] = [
    dict(id="PS-PW-3308", code="602961", sector="Power", display_state="Odisha",
         display_name="Talcher Thermal Power Station Stage III (2×660 MW)",
         lat=20.9497, lng=85.2337, zoom=15, aoi=[22, 18, 52, 54],
         before_date="2026-02-12", after_date="2026-08-09", illustrative_gap=23.0),
    dict(id="PS-RL-2340", code="705429", sector="Railways", display_state="Uttarakhand",
         display_name="Rishikesh–Karnaprayag New Rail Line (125 km)",
         lat=30.2043, lng=78.8081, zoom=15, aoi=[26, 24, 46, 48],
         before_date="2026-02-09", after_date="2026-08-08", illustrative_gap=16.9),
    dict(id="PS-WT-4471", code="701415", sector="Water", display_state="Andhra Pradesh",
         display_name="Polavaram Irrigation Project",
         lat=17.2473, lng=81.6483, zoom=14, aoi=[6, 22, 84, 40],
         before_date="2026-02-15", after_date="2026-08-12", illustrative_gap=12.6),
    dict(id="PS-RD-1120", code="618412", sector="Roads", display_state="Jammu & Kashmir / Ladakh",
         display_name="Zojila Tunnel & Z-Morh Connecting Road (NH-1)",
         lat=34.2769, lng=75.4726, zoom=14, aoi=[8, 30, 76, 34],
         before_date="2026-02-06", after_date="2026-08-06", illustrative_gap=20.1,
         report_note=("The report files this project under Andhra Pradesh and lists ₹0 expenditure "
                      "and 0% physical progress for a tunnel under construction since 2020 — an "
                      "evident data-entry error in the source. The risk score below uses the "
                      "report's figures as published, so treat it with caution.")),
    dict(id="PS-RL-2217", code="705598", sector="Railways", display_state="Madhya Pradesh, Uttar Pradesh",
         display_name="Jhansi–Bina Third Railway Line (153 km)",
         lat=25.4484, lng=78.5685, zoom=14, aoi=[8, 30, 78, 34],
         before_date="2026-02-20", after_date="2026-08-14", illustrative_gap=2.8),
    dict(id="PS-RD-1088", code="618618", sector="Roads", display_state="Punjab",
         display_name="Amritsar–Bathinda Greenfield Highway, Pkg-3 (NH-754A)",
         lat=30.5476, lng=74.9455, zoom=14, aoi=[10, 28, 70, 40],
         before_date="2026-02-19", after_date="2026-08-13", illustrative_gap=4.2),
    dict(id="PS-PW-3355", code="612134", sector="Power", display_state="Rajasthan",
         display_name="Rajasthan REZ Ph-IV Transmission, Bikaner Complex (Part A)",
         lat=27.9333, lng=74.1667, zoom=14, aoi=[14, 20, 64, 52],
         before_date="2026-02-21", after_date="2026-08-15", illustrative_gap=1.7),
    dict(id="PS-RL-2502", code="702628", sector="Railways", display_state="Uttar Pradesh",
         display_name="Kanpur Metro Rail Project",
         lat=26.4499, lng=80.3319, zoom=15, aoi=[18, 26, 58, 44],
         before_date="2026-02-17", after_date="2026-08-14", illustrative_gap=2.4),
    dict(id="PS-RL-2401", code="705237", sector="Railways", display_state="GJ, HR, MH, RJ, UP",
         display_name="Western Dedicated Freight Corridor (Dadri terminal)",
         lat=28.5522, lng=77.5525, zoom=15, aoi=[20, 22, 56, 50],
         before_date="2026-02-22", after_date="2026-08-15", illustrative_gap=1.3),
    dict(id="PS-PW-3390", code="602096", sector="Power", display_state="Arunachal Pradesh, Assam",
         display_name="Subansiri Lower Hydroelectric Project (2000 MW)",
         lat=27.5522, lng=94.2481, zoom=15, aoi=[24, 20, 50, 52],
         before_date="2026-02-10", after_date="2026-08-10", illustrative_gap=16.5),
]


def _parse_mm_yyyy(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        mm, yyyy = s.strip().split("/")
        return date(int(yyyy), int(mm), 1)
    except (ValueError, AttributeError):
        return None


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _schedule_features(row: Dict[str, Any]) -> Dict[str, float]:
    """Same definitions as PaimanaParser._engineer_features, but on the report's real dates."""
    start = _parse_mm_yyyy(row["start_date"]) or _parse_mm_yyyy(row["approval_date"])
    orig_end = _parse_mm_yyyy(row["original_completion"])
    rev_end = _parse_mm_yyyy(row["revised_completion"])
    if not start or not orig_end:
        return {}

    total_days = max(30, (orig_end - start).days)
    elapsed_days = max(0, (REPORT_REF_DATE - start).days)
    elapsed_pct = min(150.0, max(0.0, elapsed_days / total_days * 100.0))

    progress = row["physical_progress_pct"] or 0.0
    cost = row["original_cost_cr"] or 0.0
    spent = row["expenditure_cr"] or 0.0
    expected_spend = cost * (min(100.0, elapsed_pct) / 100.0)
    budget_variance = ((spent - expected_spend) / cost * 100.0) if cost > 0 else 0.0

    if rev_end:
        delay_months = max(0, _months_between(orig_end, rev_end))
    elif REPORT_REF_DATE > orig_end:
        delay_months = _months_between(orig_end, REPORT_REF_DATE)  # overdue, no revised date given
    else:
        delay_months = 0

    elapsed_months = max(1.0, elapsed_days / 30.4)
    return {
        "elapsed_time_pct": round(elapsed_pct, 1),
        "budget_variance_pct": round(budget_variance, 1),
        "schedule_slippage": round(elapsed_pct - progress, 1),
        "delay_months": delay_months,
        "pace": progress / elapsed_months,
    }


@lru_cache(maxsize=1)
def _dataset() -> Dict[str, Any]:
    return json.loads(DATASET_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _sector_pace_baselines() -> Dict[str, float]:
    """
    Mean progress-per-month across every project in the report, by sector.
    Sectors come from the report's own ministry/category headings (see the
    extraction script) — not guessed from project names.
    """
    paces: Dict[str, List[float]] = {}
    for row in _dataset()["projects"]:
        feats = _schedule_features(row)
        if not feats or row.get("sector") in (None, "Other"):
            continue
        paces.setdefault(row["sector"], []).append(feats["pace"])
    return {s: mean(v) for s, v in paces.items() if v}


def dataset() -> Dict[str, Any]:
    """The live PAIMANA extract (newest edition)."""
    return _dataset()


def schedule_features(row: Dict[str, Any]) -> Dict[str, float]:
    """Public wrapper so other services use exactly the same feature definitions."""
    return _schedule_features(row)


def build_demo_seed() -> List[Dict[str, Any]]:
    by_code = {r["project_code"]: r for r in _dataset()["projects"]}
    baselines = _sector_pace_baselines()
    seed = []
    for site in DEMO_SITES:
        row = by_code.get(site["code"])
        if row is None:
            raise RuntimeError(f"PAIMANA code {site['code']} ({site['id']}) not found in {DATASET_PATH.name}")
        feats = _schedule_features(row)
        reported = float(row["physical_progress_pct"] or 0.0)
        verified = round(max(0.0, min(100.0, reported - site["illustrative_gap"])), 1)
        revised_cost = row["revised_cost_cr"] or row["original_cost_cr"]
        seed.append({
            "id": site["id"],
            "project_code": row["project_code"],
            "name": site["display_name"],
            "official_name": row["name"],
            "agency": row.get("agency"),
            "sector": site["sector"],
            "state": site["display_state"],
            "report_state": row.get("state"),
            "report_month": REPORT_MONTH,
            "original_cost": row["original_cost_cr"],
            "revised_cost": revised_cost,
            "sanctioned_cost": revised_cost,
            "expenditure": row["expenditure_cr"],
            "reported_progress": reported,
            "verified_progress": verified,
            "verified_basis": "illustrative",
            "start_date": row["start_date"],
            "expected_end_date": row["original_completion"],
            "revised_end_date": row["revised_completion"],
            "delay_months": feats.get("delay_months", 0),
            "budget_variance_pct": feats.get("budget_variance_pct", 0.0),
            "schedule_slippage": feats.get("schedule_slippage", 0.0),
            "sector_baseline_deviation": round(feats.get("pace", 0.0) - baselines.get(site["sector"], 0.0), 2),
            "source_page": row["source_page"],
            "also_on_pages": row.get("also_on_pages") or [],
            "report_note": site.get("report_note"),
            "last_verified": site["after_date"],
            "latitude": site["lat"],
            "longitude": site["lng"],
            "zoom": site["zoom"],
            "sat_verified": False,
            "before_date": site["before_date"],
            "after_date": site["after_date"],
            "change_detected": verified,
            "aoi_json": site["aoi"],
        })
    return seed
