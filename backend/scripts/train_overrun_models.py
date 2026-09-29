"""
Trains Axiom's cost-overrun and time-overrun early-warning models on the real
MoSPI PAIMANA flash report (all ongoing projects), and compares a conventional
statistical model against machine-learning models — the comparison SIH26103
asks for.

    python scripts/train_overrun_models.py

Writes (committed, so the app works without re-training):
    data/ml/overrun_models.joblib   fitted models + feature pipeline
    data/ml/model_report.json       cross-validated comparison, drivers, definitions
    data/ml/predictions.json        out-of-fold risk for every project in the report

Targets (from the report's own figures):
    cost_overrun  revised cost >= 20% above original cost
    time_overrun  completion >= 12 months late: revised minus original completion,
                  or — for projects past their original date with no revised date and
                  not complete — the time already elapsed (a lower bound)

Features: ONLY facts known when a project is approved, so the model can warn at
sanction time rather than restating what already went wrong:
    sector, ministry, original cost, planned duration, approval-to-start gap,
    multi-state flag.
Expenditure, physical progress and revised figures are never used as inputs.
Project age / start year are deliberately left out of the main models: the report
lists only ongoing projects, so an old project past its original deadline is
late by definition, and a model given its age just learns the calendar. A
sensitivity check reports how much those "exposure" features would add.

Known limitation: the flash report contains only ongoing projects, so projects
that finished on time are absent (survivorship), and recent projects have had
less time to overrun (censoring). Historical PAIMANA editions / completed-project
records would remove both — see the report's "limitations".

Models compared (5-fold stratified cross-validation, repeated 3 times):
    Logistic regression  — the conventional statistical baseline
    Random forest        — ML
    Gradient boosting    — ML (XGBoost when installed, else scikit-learn)
All predictions shown in the app are out-of-fold: each project is scored by a
model that never saw it during training.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "paimana" / "paimana_projects.json"
OUT = ROOT / "data" / "ml"
REPORT_DATE = date(2025, 12, 31)
REF_Y = REPORT_DATE.year + (REPORT_DATE.month - 1) / 12
SEED = 42

try:
    from xgboost import XGBClassifier  # type: ignore
except Exception:  # pragma: no cover
    XGBClassifier = None

CATEGORICAL = ["sector", "ministry_group"]
NUMERIC = ["log_original_cost", "planned_duration_m", "approval_to_start_m", "multi_state"]
EXPOSURE = ["start_year", "age_years"]  # sensitivity check only
FEATURE_LABELS = {
    "sector": "Sector",
    "ministry_group": "Ministry",
    "log_original_cost": "Original cost (size)",
    "planned_duration_m": "Planned duration",
    "approval_to_start_m": "Approval-to-start gap",
    "start_year": "Start year",
    "multi_state": "Spans multiple states",
    "age_years": "Project age at report date",
}


def _ym(s):
    try:
        m, y = str(s).split("/")
        return int(y) + (int(m) - 1) / 12
    except Exception:
        return np.nan


def load_frame() -> pd.DataFrame:
    rows = json.load(open(DATA, encoding="utf-8"))["projects"]
    df = pd.DataFrame(rows)
    for c in ("approval_date", "start_date", "original_completion", "revised_completion"):
        df[c + "_y"] = df[c].map(_ym)

    # targets
    esc = (df["revised_cost_cr"] / df["original_cost_cr"] - 1) * 100
    df["cost_escalation_pct"] = esc.fillna(0.0)
    df["cost_overrun"] = (df["cost_escalation_pct"] >= 20).astype(int)

    delay = (df["revised_completion_y"] - df["original_completion_y"]) * 12
    unrevised_overdue = (
        df["revised_completion"].isna()
        & (df["original_completion_y"] < REF_Y)
        & (df["physical_progress_pct"].fillna(0) < 100)
    )
    delay = delay.where(~unrevised_overdue, (REF_Y - df["original_completion_y"]) * 12)
    df["delay_months"] = delay.fillna(0.0)
    df["time_overrun"] = (df["delay_months"] >= 12).astype(int)

    # approval-time features only
    df["log_original_cost"] = np.log10(df["original_cost_cr"].clip(lower=1))
    start = df["start_date_y"].fillna(df["approval_date_y"])
    df["planned_duration_m"] = ((df["original_completion_y"] - start) * 12).clip(lower=0)
    df["approval_to_start_m"] = ((df["start_date_y"] - df["approval_date_y"]) * 12).clip(lower=0).fillna(0)
    df["start_year"] = np.floor(start)
    df["age_years"] = (REF_Y - start).clip(lower=0)
    st = df["state"].fillna("").str.lower()
    df["multi_state"] = (st.str.contains("multi") | st.str.contains(",") | st.str.contains("pan india")).astype(int)
    top = df["ministry"].value_counts()
    keep = set(top[top >= 15].index)
    df["ministry_group"] = df["ministry"].where(df["ministry"].isin(keep), "Other ministries")
    df["sector"] = df["sector"].fillna("Other")

    ok = df[NUMERIC + EXPOSURE].notna().all(axis=1)
    dropped = int((~ok).sum())
    if dropped:
        print(f"  dropping {dropped} rows with missing dates/costs")
    return df[ok].reset_index(drop=True)


def preprocessor(scale: bool) -> ColumnTransformer:
    num = StandardScaler() if scale else "passthrough"
    return ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ("num", num, NUMERIC),
        ]
    )


def model_zoo(pos_rate: float):
    zoo = {
        "logistic_regression": (
            "Logistic regression",
            "conventional statistics",
            Pipeline([("prep", preprocessor(True)), ("clf", LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced"))]),
        ),
        "random_forest": (
            "Random forest",
            "machine learning",
            Pipeline([("prep", preprocessor(False)), ("clf", RandomForestClassifier(
                n_estimators=400, min_samples_leaf=5, class_weight="balanced_subsample", random_state=SEED, n_jobs=-1))]),
        ),
    }
    if XGBClassifier is not None:
        gb = XGBClassifier(
            n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, colsample_bytree=0.8,
            scale_pos_weight=(1 - pos_rate) / max(pos_rate, 1e-6), eval_metric="logloss", random_state=SEED, n_jobs=2,
        )
        name = "Gradient boosting (XGBoost)"
    else:
        gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, class_weight="balanced", random_state=SEED)
        name = "Gradient boosting"
    zoo["gradient_boosting"] = (name, "machine learning", Pipeline([("prep", preprocessor(False)), ("clf", gb)]))
    return zoo


def precision_at_top(y, p, frac=0.10):
    k = max(1, int(round(len(p) * frac)))
    idx = np.argsort(-p)[:k]
    return float(np.mean(np.asarray(y)[idx]))


def evaluate(df: pd.DataFrame, target: str):
    X, y = df[CATEGORICAL + NUMERIC], df[target].values
    pos = float(y.mean())
    zoo = model_zoo(pos)
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=3, random_state=SEED)
    results = {}
    for key, (label, family, pipe) in zoo.items():
        aucs, aps, briers, tops = [], [], [], []
        for tr, te in cv.split(X, y):
            pipe.fit(X.iloc[tr], y[tr])
            p = pipe.predict_proba(X.iloc[te])[:, 1]
            aucs.append(roc_auc_score(y[te], p))
            aps.append(average_precision_score(y[te], p))
            briers.append(brier_score_loss(y[te], p))
            tops.append(precision_at_top(y[te], p))
        results[key] = {
            "label": label,
            "family": family,
            "roc_auc": round(float(np.mean(aucs)), 3),
            "roc_auc_sd": round(float(np.std(aucs)), 3),
            "pr_auc": round(float(np.mean(aps)), 3),
            "brier": round(float(np.mean(briers)), 3),
            "precision_top10": round(float(np.mean(tops)), 3),
        }
        print(f"  {target:13s} {label:30s} AUC {results[key]['roc_auc']:.3f}±{results[key]['roc_auc_sd']:.3f}  "
              f"PR-AUC {results[key]['pr_auc']:.3f}  top-10% precision {results[key]['precision_top10']:.2f}")
    best = max(results, key=lambda k: results[k]["roc_auc"])
    base = results["logistic_regression"]["roc_auc"]
    return zoo, results, best, pos, base


def exposure_check(df, target):
    """ROC-AUC of the best model family if project age/start year were added (not used by the app)."""
    global NUMERIC
    saved = NUMERIC
    NUMERIC = saved + EXPOSURE
    try:
        X, y = df[CATEGORICAL + NUMERIC], df[target].values
        best = 0.0
        for key, (label, _, pipe) in model_zoo(float(y.mean())).items():
            p = cross_val_predict(pipe, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=SEED), method="predict_proba")[:, 1]
            best = max(best, roc_auc_score(y, p))
    finally:
        NUMERIC = saved
    past = (df["original_completion_y"] < REF_Y).astype(int)
    return {
        "auc_with_age_features": round(float(best), 3),
        "auc_deadline_passed_rule": round(float(roc_auc_score(df[target], past)), 3),
        "note": ("Adding project age/start year raises the score, but mostly because an ongoing project past its "
                 "original deadline is late by definition. The app uses the approval-time model."),
    }


def drivers(df, target, pipe):
    """Permutation importance (drop in ROC-AUC when a feature is shuffled) on the fitted best model."""
    X, y = df[CATEGORICAL + NUMERIC], df[target].values
    r = permutation_importance(pipe, X, y, scoring="roc_auc", n_repeats=10, random_state=SEED, n_jobs=1)
    out = []
    for i, f in enumerate(CATEGORICAL + NUMERIC):
        out.append({"feature": f, "label": FEATURE_LABELS[f], "importance": round(float(r.importances_mean[i]), 4)})
    out.sort(key=lambda d: -d["importance"])
    return out


def direction(df, target):
    """Plain-language direction of the numeric drivers: overrun rate in the top vs bottom third."""
    notes = {}
    for f in NUMERIC:
        if f == "multi_state":
            a = df.loc[df[f] == 1, target].mean()
            b = df.loc[df[f] == 0, target].mean()
            notes[f] = {"high": round(float(a), 3), "low": round(float(b), 3), "high_label": "multi-state", "low_label": "single state"}
            continue
        q1, q2 = df[f].quantile([1 / 3, 2 / 3])
        notes[f] = {
            "high": round(float(df.loc[df[f] >= q2, target].mean()), 3),
            "low": round(float(df.loc[df[f] <= q1, target].mean()), 3),
            "high_label": "top third", "low_label": "bottom third",
        }
    for f in CATEGORICAL:
        g = df.groupby(f)[target].agg(["mean", "size"])
        g = g[g["size"] >= 15].sort_values("mean", ascending=False)
        notes[f] = [{"value": str(i), "rate": round(float(r["mean"]), 3), "n": int(r["size"])} for i, r in g.iterrows()]
    return notes


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_frame()
    print(f"Training on {len(df)} projects from {DATA.name}")
    report = {
        "trained_on": len(df),
        "source": "MoSPI PAIMANA flash report, December 2025 (all ongoing projects)",
        "report_date": REPORT_DATE.isoformat(),
        "validation": "5-fold stratified cross-validation, repeated 3 times; predictions shown are out-of-fold",
        "features": [{"key": f, "label": FEATURE_LABELS[f]} for f in CATEGORICAL + NUMERIC],
        "excluded_inputs": ("Expenditure, physical progress and any revised figure (they would leak the outcome); "
                            "project age and start year (they mostly encode whether the deadline has already passed)."),
        "limitations": [
            "The flash report lists only ongoing projects: projects completed on time are absent, so rates are higher than across all sanctioned projects.",
            "Recent projects have had less time to overrun (censoring), which understates their risk.",
            "Only the flash report's columns are available; the full Common Upload Form (CUF) fields on the PAIMANA portal would likely add predictive power.",
            "Cross-sectional (one edition). Training on successive editions would allow true forward-looking validation.",
        ],
        "targets": {},
    }
    fitted = {}
    oof = {}
    definitions = {
        "cost_overrun": "Revised cost at least 20% above the original sanctioned cost",
        "time_overrun": "Completion at least 12 months late (revised vs original date; for overdue projects with no revised date, time already elapsed)",
    }
    for target in ("cost_overrun", "time_overrun"):
        zoo, results, best, pos, base = evaluate(df, target)
        X, y = df[CATEGORICAL + NUMERIC], df[target].values
        best_pipe = zoo[best][2]
        # out-of-fold probabilities from the best model, for every project
        p = cross_val_predict(best_pipe, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=SEED), method="predict_proba")[:, 1]
        oof[target] = p
        best_pipe.fit(X, y)
        lr = zoo["logistic_regression"][2].fit(X, y)
        fitted[target] = {"best": best_pipe, "best_key": best, "logistic": lr}
        best_auc = results[best]["roc_auc"]
        report["targets"][target] = {
            "definition": definitions[target],
            "positives": int(y.sum()),
            "base_rate": round(pos, 3),
            "models": results,
            "best_model": best,
            "ml_gain_over_statistics_auc": round(best_auc - base, 3),
            "verdict": (
                f"{results[best]['label']} beats logistic regression by {best_auc - base:+.3f} ROC-AUC."
                if best != "logistic_regression" and best_auc - base >= 0.01
                else "Logistic regression is as good as the ML models here — the simpler, more interpretable model is enough."
            ),
            "exposure_sensitivity": exposure_check(df, target),
            "drivers": drivers(df, target, best_pipe),
            "direction": direction(df, target),
        }

    # per-project "why": which group the project falls in for each feature, and
    # how often projects in that group overran (both targets)
    groups = {}
    for f in NUMERIC:
        if f == "multi_state":
            df["_g_" + f] = np.where(df[f] == 1, "multi-state", "single state")
        else:
            q1, q2 = df[f].quantile([1 / 3, 2 / 3])
            df["_g_" + f] = np.select([df[f] <= q1, df[f] >= q2], ["bottom third", "top third"], "middle third")
        groups[f] = df.groupby("_g_" + f)[["cost_overrun", "time_overrun"]].mean()
    for f in CATEGORICAL:
        df["_g_" + f] = df[f]
        groups[f] = df.groupby(f)[["cost_overrun", "time_overrun"]].mean()

    def show(f, v):
        if f == "log_original_cost":
            return f"₹{10 ** v:,.0f} cr"
        if f in ("planned_duration_m", "approval_to_start_m"):
            return f"{v:.0f} months"
        if f == "multi_state":
            return "yes" if v else "no"
        return str(v)

    oof_rank = {t: pd.Series(oof[t]).rank(pct=True).values for t in oof}
    preds = {}
    for i, r in df.iterrows():
        why = []
        for f in CATEGORICAL + NUMERIC:
            g = r["_g_" + f]
            why.append({
                "feature": f,
                "label": FEATURE_LABELS[f],
                "value": show(f, r[f]),
                "group": str(g),
                "cost_rate": round(float(groups[f].loc[g, "cost_overrun"]), 3),
                "time_rate": round(float(groups[f].loc[g, "time_overrun"]), 3),
            })
        preds[r["project_code"]] = {
            "p_cost_overrun": round(float(oof["cost_overrun"][i]), 3),
            "p_time_overrun": round(float(oof["time_overrun"][i]), 3),
            "cost_percentile": round(float(oof_rank["cost_overrun"][i]) * 100),
            "time_percentile": round(float(oof_rank["time_overrun"][i]) * 100),
            "cost_overrun_actual": int(r["cost_overrun"]),
            "time_overrun_actual": int(r["time_overrun"]),
            "cost_escalation_pct": round(float(r["cost_escalation_pct"]), 1),
            "delay_months": round(float(r["delay_months"]), 1),
            "why": why,
        }
    # watchlist thresholds: top 10% of predicted risk
    report["watchlist_thresholds"] = {
        t: round(float(np.quantile(oof[t], 0.9)), 3) for t in oof
    }
    report["overall_rates"] = {
        "cost_overrun": round(float(df["cost_overrun"].mean()), 3),
        "time_overrun": round(float(df["time_overrun"].mean()), 3),
    }
    joblib.dump({"models": fitted, "categorical": CATEGORICAL, "numeric": NUMERIC}, OUT / "overrun_models.joblib")
    json.dump(report, open(OUT / "model_report.json", "w", encoding="utf-8"), indent=1)
    json.dump(preds, open(OUT / "predictions.json", "w", encoding="utf-8"))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
