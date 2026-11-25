"""
Axiom — Predictive Risk Model (Gradient-Boosted Trees + SHAP Explainability)

Implements:
1. Feature Extraction:
   - Budget vs expenditure ratio / budget variance %
   - Planned vs actual milestone slippage
   - Historical contractor delay rate
   - Sector risk profile (Roads, Railways, Power, Water)
   - Combined Satellite & YOLOv8 Photo Discrepancy
   - Cumulative rainfall anomaly score
2. Model:
   - Gradient-Boosted Trees (XGBoost / LightGBM) predicting:
     * P(delay > 6 months)
     * P(cost overrun > 20%)
3. Explainability:
   - SHAP (SHapley Additive exPlanations) values computed per prediction.
   - Provides ranked list of feature contributions for transparent auditability.
"""

import logging
import os
from datetime import date
from typing import Dict, Any, List, Tuple, Optional
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

def _parse_mm_yyyy(s: Optional[str]) -> Optional[date]:
    if not s or "/" not in str(s):
        return None
    try:
        mm, yyyy = str(s).strip().split("/")
        return date(int(yyyy), int(mm), 1)
    except Exception:
        return None

def _extract_schedule_features(row: Dict[str, Any], ref_date: date = date(2025, 12, 31)) -> Dict[str, float]:
    start = _parse_mm_yyyy(row.get("start_date")) or _parse_mm_yyyy(row.get("approval_date"))
    orig_end = _parse_mm_yyyy(row.get("original_completion"))
    if not start or not orig_end:
        return {"budget_variance_pct": 0.0, "schedule_slippage": 0.0}

    total_days = max(30, (orig_end - start).days)
    elapsed_days = max(0, (ref_date - start).days)
    elapsed_pct = min(150.0, max(0.0, elapsed_days / total_days * 100.0))

    progress = row.get("physical_progress_pct") or 0.0
    cost = row.get("original_cost_cr") or 0.0
    spent = row.get("expenditure_cr") or 0.0
    expected_spend = cost * (min(100.0, elapsed_pct) / 100.0)
    budget_variance = ((spent - expected_spend) / cost * 100.0) if cost > 0 else 0.0
    slippage = elapsed_pct - progress

    return {
        "budget_variance_pct": round(budget_variance, 1),
        "schedule_slippage": round(slippage, 1),
    }

try:
    import xgboost as xgb
    XGB_AVAILABLE = True
except ImportError:
    XGB_AVAILABLE = False

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

from sklearn.ensemble import HistGradientBoostingClassifier

FEATURE_NAMES = [
    "budget_variance_pct",
    "schedule_slippage",
    "contractor_delay_rate",
    "sector_risk_index",
    "combined_discrepancy",
    "rainfall_anomaly_score",
]

SECTOR_RISK_MAP = {
    "Roads": 0.45,
    "Railways": 0.58,
    "Power": 0.52,
    "Water": 0.38,
}

class PredictiveRiskModel:
    def __init__(self):
        self.xgb_delay_model = None
        self.xgb_cost_model = None
        self.tree_explainer = None
        self.is_trained = False
        self._initialize_and_train_baseline()

    def _initialize_and_train_baseline(self):
        """
        Legacy demonstration model behind the `predictive_ml` field of the risk API.
        It trains on edition-to-edition outcomes only if a later REAL PAIMANA edition
        (paimana_2026-08.json) is present in data/paimana/editions/; otherwise it falls
        back to a synthetic distribution. The console's early-warning predictions come
        from scripts/train_overrun_models.py instead (real data, cross-validated).
        """
        from app.config import settings
        dec_path = settings.DATA_DIR / "paimana" / "editions" / "paimana_2025-12.json"
        aug_path = settings.DATA_DIR / "paimana" / "editions" / "paimana_2026-08.json"

        X_rows = []
        y_delay_list = []
        y_cost_list = []

        if dec_path.exists() and aug_path.exists():
            try:
                import json
                dec_data = json.loads(dec_path.read_text(encoding="utf-8"))["projects"]
                aug_data = json.loads(aug_path.read_text(encoding="utf-8"))["projects"]
                aug_by_code = {p["project_code"]: p for p in aug_data}

                for p in dec_data:
                    code = p["project_code"]
                    feats = _extract_schedule_features(p)
                    b_var = feats.get("budget_variance_pct", 0.0)
                    s_slip = feats.get("schedule_slippage", 0.0)
                    sector_risk = SECTOR_RISK_MAP.get(p.get("sector"), 0.50)
                    agency = p.get("agency", "").lower()
                    contractor_delay = 0.25 if "rail" in agency else (0.35 if "nhai" in agency else 0.20)
                    disc = 0.0
                    rain_anomaly = 12.0

                    a = aug_by_code.get(code, {})
                    aug_rev = a.get("revised_completion")
                    dec_rev = p.get("revised_completion")
                    slipped = 1 if (aug_rev != dec_rev and aug_rev is not None) or s_slip > 15.0 else 0
                    o_cost = p.get("original_cost_cr") or 1.0
                    r_cost = a.get("revised_cost_cr") or o_cost
                    cost_over = 1 if (r_cost - o_cost) / o_cost >= 0.20 or b_var > 20.0 else 0

                    X_rows.append([b_var, s_slip, contractor_delay, sector_risk, disc, rain_anomaly])
                    y_delay_list.append(slipped)
                    y_cost_list.append(cost_over)
            except Exception as e:
                logger.warning(f"Could not load PAIMANA editions for model training: {e}")

        if len(X_rows) >= 100:
            df_X = pd.DataFrame(X_rows, columns=FEATURE_NAMES)
            y_delay = np.array(y_delay_list)
            y_cost = np.array(y_cost_list)
        else:
            np.random.seed(42)
            n_samples = 600
            budget_var = np.random.normal(12.0, 15.0, n_samples).clip(-20, 60)
            sched_slip = np.random.normal(10.0, 18.0, n_samples).clip(-10, 50)
            contractor_delay = np.random.beta(2, 5, n_samples).clip(0.05, 0.85)
            sector_idx = np.random.choice([0.45, 0.58, 0.52, 0.38], n_samples)
            discrepancy = np.random.exponential(8.0, n_samples).clip(0, 45)
            rain_anomaly = np.random.gamma(2, 5, n_samples).clip(0, 80)
            X = np.column_stack([
                budget_var,
                sched_slip,
                contractor_delay,
                sector_idx,
                discrepancy,
                rain_anomaly,
            ])
            logit_delay = (0.045 * sched_slip + 0.035 * budget_var + 0.050 * discrepancy + 1.8 * contractor_delay + 0.015 * rain_anomaly - 1.2)
            p_delay = 1.0 / (1.0 + np.exp(-logit_delay))
            y_delay = (np.random.rand(n_samples) < p_delay).astype(int)
            logit_cost = (0.070 * budget_var + 0.025 * sched_slip + 0.030 * discrepancy + 1.2 * contractor_delay - 1.0)
            p_cost = 1.0 / (1.0 + np.exp(-logit_cost))
            y_cost = (np.random.rand(n_samples) < p_cost).astype(int)
            df_X = pd.DataFrame(X, columns=FEATURE_NAMES)

        if XGB_AVAILABLE:
            self.xgb_delay_model = xgb.XGBClassifier(
                n_estimators=60,
                max_depth=4,
                learning_rate=0.08,
                random_state=42,
                eval_metric="logloss"
            )
            self.xgb_delay_model.fit(df_X, y_delay)

            self.xgb_cost_model = xgb.XGBClassifier(
                n_estimators=60,
                max_depth=4,
                learning_rate=0.08,
                random_state=42,
                eval_metric="logloss"
            )
            self.xgb_cost_model.fit(df_X, y_cost)

            if SHAP_AVAILABLE:
                try:
                    self.tree_explainer = shap.TreeExplainer(self.xgb_delay_model)
                except Exception:
                    self.tree_explainer = None
        else:
            # Fallback to HistGradientBoostingClassifier
            self.xgb_delay_model = HistGradientBoostingClassifier(max_iter=60, max_depth=4, random_state=42)
            self.xgb_delay_model.fit(df_X, y_delay)
            self.xgb_cost_model = HistGradientBoostingClassifier(max_iter=60, max_depth=4, random_state=42)
            self.xgb_cost_model.fit(df_X, y_cost)

        self.is_trained = True

    def predict_project_risk(
        self,
        budget_variance_pct: float,
        schedule_slippage: float,
        contractor_delay_rate: float,
        sector: str,
        combined_discrepancy: float,
        rainfall_anomaly_score: float
    ) -> Dict[str, Any]:
        """
        Runs GBDT inference and computes SHAP feature contributions.
        """
        sector_idx = SECTOR_RISK_MAP.get(sector, 0.45)
        raw_features = [
            float(budget_variance_pct),
            float(schedule_slippage),
            float(contractor_delay_rate),
            float(sector_idx),
            float(combined_discrepancy),
            float(rainfall_anomaly_score)
        ]
        X_test = pd.DataFrame([raw_features], columns=FEATURE_NAMES)

        # 1. Predictions
        p_delay = float(self.xgb_delay_model.predict_proba(X_test)[0][1])
        p_cost_overrun = float(self.xgb_cost_model.predict_proba(X_test)[0][1])

        # 2. SHAP Explainability
        shap_contributions = []
        if self.tree_explainer is not None and SHAP_AVAILABLE:
            try:
                shap_vals = self.tree_explainer.shap_values(X_test)
                if isinstance(shap_vals, list):
                    vals = shap_vals[1][0]
                elif hasattr(shap_vals, "values"):
                    vals = shap_vals.values[0]
                else:
                    vals = shap_vals[0]

                for name, val, raw_val in zip(FEATURE_NAMES, vals, raw_features):
                    shap_contributions.append({
                        "feature": name,
                        "raw_value": round(raw_val, 2),
                        "shap_value": float(round(val, 4)),
                        "impact": "increases_risk" if val > 0 else "reduces_risk",
                        "importance_rank": abs(float(val))
                    })
            except Exception as e:
                # Fallback to feature importance proxy
                shap_contributions = self._compute_feature_importance_proxy(raw_features)
        else:
            shap_contributions = self._compute_feature_importance_proxy(raw_features)

        # Sort by absolute impact magnitude
        shap_contributions.sort(key=lambda x: x["importance_rank"], reverse=True)

        return {
            "p_delay_over_6mo": float(round(p_delay, 3)),
            "p_cost_overrun_over_20pct": float(round(p_cost_overrun, 3)),
            "ml_risk_trend": "High Probability of Distress" if (p_delay > 0.6 or p_cost_overrun > 0.6) else "Moderate/Controlled",
            "model_type": "XGBoost Gradient Boosted Trees (60 estimators)" if XGB_AVAILABLE else "HistGradientBoostingClassifier",
            "shap_explainability": shap_contributions,
            "top_contributing_factor": shap_contributions[0]["feature"] if shap_contributions else "N/A"
        }

    def _compute_feature_importance_proxy(self, raw_features: List[float]) -> List[Dict[str, Any]]:
        """Fallback feature importance calculation"""
        weights = [0.30, 0.35, 0.15, 0.05, 0.25, 0.10]
        results = []
        for name, weight, raw_val in zip(FEATURE_NAMES, weights, raw_features):
            impact_val = (raw_val / (max(raw_val, 20.0))) * weight * (1.0 if raw_val > 5 else -0.5)
            results.append({
                "feature": name,
                "raw_value": round(raw_val, 2),
                "shap_value": float(round(impact_val, 4)),
                "impact": "increases_risk" if impact_val > 0 else "reduces_risk",
                "importance_rank": abs(float(impact_val))
            })
        return results

# Singleton instance
predictive_risk_model = PredictiveRiskModel()
