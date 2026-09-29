"""
Serves the real cost/time-overrun early-warning models trained by
scripts/train_overrun_models.py on the PAIMANA flash report.

The app never trains or predicts at request time: it reads the committed,
cross-validated artifacts in data/ml/ (out-of-fold predictions for every
project + the model-comparison report).
"""

import json
from functools import lru_cache
from typing import Any, Dict, Optional

from app.config import settings

ML_DIR = settings.DATA_DIR / "ml"


@lru_cache(maxsize=1)
def report() -> Optional[Dict[str, Any]]:
    p = ML_DIR / "model_report.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else None


@lru_cache(maxsize=1)
def predictions() -> Dict[str, Dict[str, Any]]:
    p = ML_DIR / "predictions.json"
    return json.load(open(p, encoding="utf-8")) if p.exists() else {}


def prediction(project_code: Optional[str]) -> Optional[Dict[str, Any]]:
    return predictions().get(project_code or "")


def on_watchlist(pred: Dict[str, Any]) -> bool:
    """High predicted risk (top 10%) for an overrun the report doesn't show yet."""
    r = report()
    if not r or not pred:
        return False
    th = r["watchlist_thresholds"]
    return (pred["p_cost_overrun"] >= th["cost_overrun"] and not pred["cost_overrun_actual"]) or (
        pred["p_time_overrun"] >= th["time_overrun"] and not pred["time_overrun_actual"]
    )
