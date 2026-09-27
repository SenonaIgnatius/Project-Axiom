"""
Report-wide insight endpoints, all computed from the real PAIMANA extract
(data/paimana/paimana_projects.json and data/paimana/editions/*.json):

  GET  /data-quality          consistency audit of every row in the report
  GET  /benchmark/{id}        where a project sits among its report-defined sector
  GET  /history/{id}          the project across every PAIMANA edition loaded
  GET  /scenario/{id}         baseline for the what-if explorer
  POST /scenario              re-run the transparent risk formula with new inputs
"""

import json
import math
from datetime import date
from statistics import median
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.ml.predictive_model import predictive_risk_model
from app.models.project import Project
from app.services.demo_registry import REPORT_REF_DATE, dataset, schedule_features
from app.services.risk_engine import RiskEngine
from app.services.sensor_service import SensorService
from app.services.weather_service import WeatherService

router = APIRouter(prefix="", tags=["insights"])

EDITIONS_DIR = settings.DATA_DIR / "paimana" / "editions"


# ── helpers ─────────────────────────────────────────────────────────────────

def _mm_yyyy(s: Optional[str]) -> Optional[date]:
    try:
        mm, yyyy = (s or "").strip().split("/")
        return date(int(yyyy), int(mm), 1)
    except ValueError:
        return None


def _escalation(row: Dict[str, Any]) -> float:
    o, r = row.get("original_cost_cr"), row.get("revised_cost_cr")
    return ((r - o) / o * 100.0) if (o and r) else 0.0


def _extension_days(row: Dict[str, Any]) -> Optional[int]:
    o, r = _mm_yyyy(row.get("original_completion")), _mm_yyyy(row.get("revised_completion"))
    return (r - o).days if (o and r) else None


def _financial_progress(row: Dict[str, Any]) -> Optional[float]:
    cost = row.get("revised_cost_cr") or row.get("original_cost_cr")
    return (row["expenditure_cr"] / cost * 100.0) if (cost and row.get("expenditure_cr") is not None) else None


def _by_code() -> Dict[str, Dict[str, Any]]:
    return {r["project_code"]: r for r in dataset()["projects"]}


async def _project_or_404(project_id: str, db: AsyncSession) -> Project:
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
    return project


def _editions() -> List[Dict[str, Any]]:
    eds = []
    if EDITIONS_DIR.exists():
        for f in sorted(EDITIONS_DIR.glob("paimana_*.json")):
            eds.append(json.loads(f.read_text(encoding="utf-8")))
    if not eds:
        eds = [dataset()]
    return sorted(eds, key=lambda d: d.get("edition") or "")


# ── data quality ────────────────────────────────────────────────────────────

DQ_RULES = [
    # key, severity, label, description
    ("progress_without_spend", "critical", "Progress with ₹0 spent",
     "90% or more physical progress reported against zero cumulative expenditure"),
    ("spend_above_revised_cost", "critical", "Spend above revised cost",
     "Cumulative expenditure already exceeds even the revised sanctioned cost"),
    ("revised_date_before_original", "critical", "Revised date before original",
     "Revised completion date is earlier than the original target"),
    ("zero_progress_zero_spend", "medium", "Stalled: 0% and ₹0",
     "0% progress and ₹0 spent more than a year after the project started"),
    ("overdue_without_revised_date", "medium", "Overdue, no revised date",
     "Original deadline has passed, work is unfinished, and no revised date is given"),
    ("past_revised_deadline", "low", "Past revised deadline",
     "Even the revised completion date has passed and work is unfinished"),
]


def _dq_flags(row: Dict[str, Any], ref: date) -> List[str]:
    flags = []
    prog = row.get("physical_progress_pct") or 0.0
    spent = row.get("expenditure_cr") or 0.0
    rev_cost = row.get("revised_cost_cr") or row.get("original_cost_cr")
    start = _mm_yyyy(row.get("start_date")) or _mm_yyyy(row.get("approval_date"))
    orig_end, rev_end = _mm_yyyy(row.get("original_completion")), _mm_yyyy(row.get("revised_completion"))

    if prog >= 90 and spent == 0:
        flags.append("progress_without_spend")
    if rev_cost and spent > rev_cost:
        flags.append("spend_above_revised_cost")
    if orig_end and rev_end and rev_end < orig_end:
        flags.append("revised_date_before_original")
    if prog == 0 and spent == 0 and start and (ref - start).days > 365:
        flags.append("zero_progress_zero_spend")
    if orig_end and orig_end < ref and not rev_end and prog < 100:
        flags.append("overdue_without_revised_date")
    if rev_end and rev_end < ref and prog < 100:
        flags.append("past_revised_deadline")
    return flags


@router.get("/data-quality")
async def data_quality():
    data = dataset()
    ref = REPORT_REF_DATE
    severity = {k: sev for k, sev, _, _ in DQ_RULES}
    counts = {k: 0 for k, _, _, _ in DQ_RULES}
    issues = []
    for row in data["projects"]:
        flags = _dq_flags(row, ref)
        for f in flags:
            counts[f] += 1
        if flags:
            issues.append({
                "project_id": row["project_code"],
                "project_name": row["name"],
                "agency": row.get("agency"),
                "state": row.get("state"),
                "sector": row.get("sector"),
                "snapshot_date": data.get("edition"),
                "source_page": row["source_page"],
                "flags": flags,
            })
    rank = {"critical": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda i: (min(rank[severity[f]] for f in i["flags"]), -len(i["flags"])))

    serious = sum(1 for i in issues if any(severity[f] in ("critical", "medium") for f in i["flags"]))
    n = len(data["projects"])
    return {
        "available": True,
        "edition": data.get("edition"),
        "rows": data.get("row_count", n),
        "projects_evaluated": n,
        "data_quality_score": round((n - serious) / n * 100, 1) if n else 0.0,
        "flags": counts,
        "rules": [{"key": k, "severity": sev, "label": lab, "description": d} for k, sev, lab, d in DQ_RULES],
        "issues": issues,
        "note": (
            f"Every one of the {n} projects in the MoSPI PAIMANA flash report ({data.get('edition')}) is checked "
            "against the rules below, using only the figures printed in the report. A flag means the row "
            "is internally inconsistent or needs a follow-up question — not that wrongdoing occurred."
        ),
        "policy": (
            "Score = share of projects with no critical or medium flag. 'Past revised deadline' is shown "
            "for context but doesn't lower the score. Each issue links to the report page it came from."
        ),
        "source": data.get("source"),
    }


# ── sector benchmarking ─────────────────────────────────────────────────────

@router.get("/benchmark/{project_id}")
async def peer_benchmark(project_id: str, limit: int = 6, db: AsyncSession = Depends(get_db)):
    project = await _project_or_404(project_id, db)
    rows = _by_code()
    target = rows.get(project.project_code or "")
    if not target:
        raise HTTPException(status_code=404, detail="Project has no PAIMANA record to benchmark")

    cohort = [r for r in rows.values() if r["sector"] == target["sector"] and r["project_code"] != target["project_code"]]
    fallback = len(cohort) < 20
    if fallback:
        cohort = [r for r in rows.values() if r["sector"] != "Other" and r["project_code"] != target["project_code"]]

    t_esc = _escalation(target)
    escs = [_escalation(r) for r in cohort]
    below = sum(1 for e in escs if e < t_esc) + 0.5 * sum(1 for e in escs if e == t_esc)
    pct = below / len(escs) * 100 if escs else 0.0

    def med(vals):
        vals = [v for v in vals if v is not None]
        return round(median(vals), 1) if vals else None

    t_cost = target.get("original_cost_cr") or 1.0
    peers = sorted(
        (r for r in cohort if r.get("original_cost_cr")),
        key=lambda r: abs(math.log(r["original_cost_cr"]) - math.log(t_cost)),
    )[:limit]

    m_esc = med(escs)
    interpretation = (
        f"Revised cost is {t_esc:+.1f}% against the original — higher than {pct:.0f}% of the "
        f"{len(cohort)} {'infrastructure' if fallback else target['sector'].lower()} projects in the report "
        f"(median {m_esc:+.1f}%)."
    )
    return {
        "project_id": project.id,
        "paimana_code": target["project_code"],
        "sector": target["sector"],
        "raw_sector": target.get("category"),
        "cross_sector_fallback": fallback,
        "peer_count": len(cohort),
        "target_metrics": {
            "original_cost_cr": target.get("original_cost_cr"),
            "cost_escalation_pct": round(t_esc, 1),
            "delay_months": project.delay_months,
            "reported_progress_pct": target.get("physical_progress_pct"),
            "schedule_extension_days": _extension_days(target),
        },
        "medians": {
            "original_cost_cr": med([r.get("original_cost_cr") for r in cohort]),
            "cost_escalation_pct": m_esc,
            "schedule_extension_days": med([_extension_days(r) for r in cohort]),
            "financial_progress_pct": med([_financial_progress(r) for r in cohort]),
            "physical_progress_pct": med([r.get("physical_progress_pct") for r in cohort]),
        },
        "quantile_rank": {"cost_escalation_percentile": round(pct, 1), "interpretation": interpretation},
        "peers": [
            {
                "project_code": r["project_code"],
                "project_name": r["name"],
                "sector": r["sector"],
                "state": r.get("state"),
                "original_cost_cr": r.get("original_cost_cr"),
                "revised_cost_cr": r.get("revised_cost_cr"),
                "cost_escalation_pct": round(_escalation(r), 1),
                "schedule_extension_days": _extension_days(r),
                "physical_progress_pct": r.get("physical_progress_pct"),
                "cost_distance": round(abs(math.log(r["original_cost_cr"]) - math.log(t_cost)), 3),
                "source_page": r["source_page"],
            }
            for r in peers
        ],
        "disclosure": (
            f"Cohort: every {'non-Other' if fallback else target['sector']} project in the MoSPI PAIMANA flash "
            f"report ({dataset().get('edition')}), with sectors taken from the report's own ministry and category "
            "headings. Escalation = revised vs original cost as printed; schedule extension = revised minus "
            "original completion date. Nearest peers are the closest by original cost (log scale)."
        ),
    }


# ── edition history ─────────────────────────────────────────────────────────

@router.get("/history/{project_id}")
async def project_history(project_id: str, db: AsyncSession = Depends(get_db)):
    project = await _project_or_404(project_id, db)
    eds = _editions()
    snaps = []
    for ed in eds:
        row = next((r for r in ed["projects"] if r["project_code"] == project.project_code), None)
        if not row:
            continue
        ref = _mm_yyyy("/".join(reversed((ed.get("edition") or "").split("-")))) or REPORT_REF_DATE
        orig_end, rev_end = _mm_yyyy(row.get("original_completion")), _mm_yyyy(row.get("revised_completion"))
        prog = row.get("physical_progress_pct") or 0
        if prog >= 100:
            status = "Reported complete"
        elif rev_end and rev_end < ref:
            status = "Past revised deadline"
        elif orig_end and orig_end < ref:
            status = "Past original deadline" + ("" if rev_end else ", no revised date")
        elif orig_end and rev_end and rev_end > orig_end:
            months = (rev_end.year - orig_end.year) * 12 + rev_end.month - orig_end.month
            status = f"Not yet due · target pushed back {months} months"
        else:
            status = "Within original schedule"
        snaps.append({
            "snapshot_date": ed.get("edition"),
            "approved_cost_cr": row.get("original_cost_cr"),
            "revised_cost_cr": row.get("revised_cost_cr"),
            "cumulative_expenditure_cr": row.get("expenditure_cr"),
            "cost_escalation_pct": round(_escalation(row), 1),
            "physical_progress_pct": row.get("physical_progress_pct"),
            "financial_progress_pct": round(_financial_progress(row), 1) if _financial_progress(row) is not None else None,
            "planned_completion_date": row.get("original_completion"),
            "revised_completion_date": row.get("revised_completion"),
            "schedule_status": status,
            "source_pdf": ed.get("source_pdf"),
            "source_page": row.get("source_page"),
        })
    loaded = [e.get("edition") for e in eds]
    return {
        "project_id": project.id,
        "project_name": project.name,
        "paimana_code": project.project_code,
        "no_historical_match": not snaps,
        "sector": project.sector,
        "editions_loaded": loaded,
        "snapshot_count": len(snaps),
        "date_range": {"earliest": snaps[0]["snapshot_date"], "latest": snaps[-1]["snapshot_date"]} if snaps else None,
        "snapshots": snaps,
        "disclosure": (
            f"Built from {len(loaded)} PAIMANA edition{'s' if len(loaded) != 1 else ''} loaded "
            f"({', '.join(x for x in loaded if x)}). Each snapshot is the project's row exactly as printed in "
            "that month's report. Add earlier monthly flash reports and re-run "
            "scripts/extract_paimana_dataset.py to extend the history."
        ),
    }


# ── what-if scenario ────────────────────────────────────────────────────────

class ScenarioRequest(BaseModel):
    project_id: str
    physical_progress_pct: Optional[float] = None
    expenditure_cr: Optional[float] = None
    verified_progress_pct: Optional[float] = None


def _metrics(project: Project, progress: float, spent: float, verified: float,
             sensor_health: float, rain: Dict[str, Any]) -> Dict[str, Any]:
    feats = schedule_features({
        "start_date": project.start_date, "approval_date": None,
        "original_completion": project.expected_end_date,
        "revised_completion": project.revised_end_date,
        "physical_progress_pct": progress,
        "original_cost_cr": project.original_cost, "expenditure_cr": spent,
    })
    budget_var = feats.get("budget_variance_pct", 0.0)
    slippage = feats.get("schedule_slippage", 0.0)
    disc = abs(progress - verified)
    score, level, status, factors = RiskEngine.calculate_weighted_risk(
        budget_variance_pct=budget_var,
        schedule_slippage=slippage,
        combined_discrepancy=disc,
        sensor_health_score=sensor_health,
        rainfall_exposure=rain.get("rainfall_risk_score", 0.0),
        rainfall_available=rain.get("available", True),
        discrepancy_basis=project.verified_basis or "illustrative",
    )
    ml = predictive_risk_model.predict_project_risk(
        budget_variance_pct=budget_var, schedule_slippage=slippage,
        contractor_delay_rate=project.contractor_delay_rate or 0.15, sector=project.sector,
        combined_discrepancy=disc, rainfall_anomaly_score=rain.get("rainfall_risk_score", 0.0),
    )
    cost = project.revised_cost or project.sanctioned_cost or 1.0
    return {
        "risk_score": score, "risk_level": level, "status": status,
        "capital_utilisation_pct": round(spent / cost * 100, 1),
        "budget_variance_pct": round(budget_var, 1),
        "schedule_slippage_pts": round(slippage, 1),
        "discrepancy_pts": round(disc, 1),
        "delay_months": project.delay_months,
        "factors": {k: {"score": f.normalized_score, "weight": f.weight, "contribution": f.weighted_contribution}
                    for k, f in factors.items()},
        "predictive_ml": {
            "p_delay_over_6mo": ml["p_delay_over_6mo"],
            "p_cost_overrun_over_20pct": ml["p_cost_overrun_over_20pct"],
            "ml_risk_trend": ml["ml_risk_trend"], "model_type": ml["model_type"],
            "source": "synthetic-trained demonstration model",
        },
    }


async def _run_scenario(project: Project, req: Optional[ScenarioRequest]) -> Dict[str, Any]:
    health = SensorService.get_asset_health(f"ASSET-{project.id}")["current_health_score"]
    rain = WeatherService.get_weather_for_project(project.id, project_code=project.project_code)
    base = _metrics(project, project.reported_progress, project.expenditure, project.verified_progress, health, rain)
    prog = req.physical_progress_pct if req and req.physical_progress_pct is not None else project.reported_progress
    spent = req.expenditure_cr if req and req.expenditure_cr is not None else project.expenditure
    ver = req.verified_progress_pct if req and req.verified_progress_pct is not None else project.verified_progress
    scen = _metrics(project, prog, spent, ver, health, rain)
    return {
        "project_id": project.id,
        "project_name": project.name,
        "sector": project.sector,
        "sanctioned_cost_cr": project.revised_cost or project.sanctioned_cost,
        "inputs": {"physical_progress_pct": prog, "expenditure_cr": spent, "verified_progress_pct": ver},
        "baseline": base,
        "scenario": scen,
        "delta": {
            "risk_score_delta": scen["risk_score"] - base["risk_score"],
            "risk_level_transition": f"{base['risk_level']} → {scen['risk_level']}",
            "status_transition": f"{base['status']} → {scen['status']}",
            "p_delay_delta": round(scen["predictive_ml"]["p_delay_over_6mo"] - base["predictive_ml"]["p_delay_over_6mo"], 3),
            "p_cost_delta": round(scen["predictive_ml"]["p_cost_overrun_over_20pct"] - base["predictive_ml"]["p_cost_overrun_over_20pct"], 3),
            "discrepancy_delta": round(scen["discrepancy_pts"] - base["discrepancy_pts"], 1),
        },
        "disclosure": (
            "Re-runs Sentinel's transparent risk formula with your inputs, using exactly the definitions behind "
            "the live score: schedule slippage against the report's original timeline, and spend against what was "
            "expected by now under the original cost. The two probabilities come from a model trained on "
            "synthetic data and are indicative only. This is a sensitivity check, not a causal forecast."
        ),
    }


@router.get("/scenario/{project_id}")
async def scenario_baseline(project_id: str, db: AsyncSession = Depends(get_db)):
    return await _run_scenario(await _project_or_404(project_id, db), None)


@router.post("/scenario")
async def scenario_run(req: ScenarioRequest, db: AsyncSession = Depends(get_db)):
    return await _run_scenario(await _project_or_404(req.project_id, db), req)


@router.get("/paimana/page/{page_no}")
async def report_page(page_no: int, code: str, full: bool = False):
    """Any page of the live PAIMANA report with the given project code's row highlighted."""
    from fastapi.responses import FileResponse
    from app.services.source_page_service import render_source_page

    if code not in _by_code():
        raise HTTPException(status_code=404, detail=f"PAIMANA code {code} not in the report")
    path = render_source_page(code, page_no, full=full)
    if not path:
        raise HTTPException(status_code=404, detail="Could not render that page")
    return FileResponse(path, media_type="image/png")
