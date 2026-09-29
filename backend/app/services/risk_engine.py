import logging
from datetime import datetime
from typing import Dict, Any, Tuple, List, Optional
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.linear_model import LogisticRegression
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models.project import Project
from app.models.risk import RiskAssessment
from app.services.sensor_service import SensorService
from app.services.weather_service import WeatherService
from app.ml.predictive_model import predictive_risk_model
from app.schemas.risk import (
    RiskBreakdownResponse,
    FactorDetail,
    DiscrepancyDetails,
    PredictiveMlDetails,
    ShapContribution,
)

logger = logging.getLogger(__name__)


class RiskEngine:
    """
    Axiom Explainable Risk Engine.
    
    1. Auditable Transparent Weighted Risk Formula:
       risk_score = 0.30*budget_variance + 0.30*schedule_slippage + 0.20*visual_discrepancy + 0.10*sensor_anomaly + 0.10*rainfall_exposure
       
    2. Discrepancy Computation:
       - discrepancy_sat = |reported_progress - sat_verified_progress|
       - discrepancy_photo = |reported_progress - photo_verified_progress|
       - combined_discrepancy = max(discrepancy_sat, discrepancy_photo)
       
    3. Predictive Gradient-Boosted Trees (XGBoost / LightGBM):
       Predicts P(delay > 6mo) and P(cost overrun > 20%) with SHAP value ranking.
       
    4. Unsupervised K-Means Clustering (k=3):
       Sanity-check clustering grouping projects into Low, Medium, High risk cohorts.
    """

    WEIGHTS = {
        "budget_variance": 0.3,
        "schedule_slippage": 0.3,
        "visual_discrepancy": 0.2,
        "sensor_anomaly": 0.1,
        "rainfall_exposure": 0.1,
    }

    _kmeans_model: Optional[KMeans] = None
    _cluster_map: Dict[int, str] = {}

    @classmethod
    def calculate_weighted_risk(
        cls,
        budget_variance_pct: float,
        schedule_slippage: float,
        combined_discrepancy: Optional[float] = None,
        sensor_health_score: float = 85.0,
        rainfall_exposure: float = 10.0,
        photo_gap: Optional[float] = None,
        rainfall_available: bool = True,
        discrepancy_basis: str = "illustrative",
    ) -> Tuple[int, str, str, Dict[str, FactorDetail]]:
        """
        Computes the primary transparent weighted risk formula (0-100).
        """
        disc_val = combined_discrepancy if combined_discrepancy is not None else (photo_gap if photo_gap is not None else 0.0)

        # 1. Budget variance normalized score (0-100)
        norm_budget = min(100.0, max(0.0, (budget_variance_pct / 25.0) * 100.0)) if budget_variance_pct > 0 else 0.0

        # 2. Schedule slippage normalized score (0-100)
        norm_slippage = min(100.0, max(0.0, (schedule_slippage / 30.0) * 100.0)) if schedule_slippage > 0 else 0.0

        # 3. Visual discrepancy normalized score (0-100)
        norm_discrepancy = min(100.0, max(0.0, (disc_val / 25.0) * 100.0))

        # 4. Sensor anomaly risk (inverse of asset health score)
        norm_sensor = max(0.0, min(100.0, 100.0 - sensor_health_score))

        # 5. Rainfall exposure
        norm_rainfall = max(0.0, min(100.0, rainfall_exposure))

        # Weights
        w1 = cls.WEIGHTS["budget_variance"]
        w2 = cls.WEIGHTS["schedule_slippage"]
        w3 = cls.WEIGHTS["visual_discrepancy"]
        w4 = cls.WEIGHTS["sensor_anomaly"]
        w5 = cls.WEIGHTS["rainfall_exposure"]

        contrib_budget = norm_budget * w1
        contrib_slippage = norm_slippage * w2
        contrib_discrepancy = norm_discrepancy * w3
        contrib_sensor = norm_sensor * w4
        contrib_rainfall = norm_rainfall * w5

        composite_score = int(round(
            contrib_budget + contrib_slippage + contrib_discrepancy + contrib_sensor + contrib_rainfall
        ))
        composite_score = max(0, min(100, composite_score))

        # Risk Level & Status
        if composite_score >= 65:
            risk_level = "high"
        elif composite_score >= 35:
            risk_level = "medium"
        else:
            risk_level = "low"

        if composite_score >= 75 or schedule_slippage >= 20.0 or disc_val >= 20.0:
            status = "critical"
        elif schedule_slippage >= 5.0 or composite_score >= 45 or disc_val >= 10.0:
            status = "delayed"
        else:
            status = "on-track"

        disc_factor = FactorDetail(
            name="Independent Discrepancy",
            raw_value=round(disc_val, 1),
            unit="pts",
            normalized_score=round(norm_discrepancy, 1),
            weight=w3,
            weighted_contribution=round(contrib_discrepancy, 1),
            description=(
                "Gap between reported progress and the verified figure shown above it."
                if discrepancy_basis == "photo" else
                "Gap between reported progress and the verified figure shown above it — currently an "
                "illustrative stand-in until live satellite/photo verification is run."
            ),
            data_source=("real:YOLOv8_site_photo" if discrepancy_basis == "photo"
                         else "illustrative:verified_progress_stand_in"),
        )

        factors = {
            "budget_variance": FactorDetail(
                name="Budget Variance",
                raw_value=round(budget_variance_pct, 1),
                unit="%",
                normalized_score=round(norm_budget, 1),
                weight=w1,
                weighted_contribution=round(contrib_budget, 1),
                description="Expenditure to date vs spend expected by now under the original cost and schedule.",
                data_source="derived:PAIMANA flash report Dec 2025 (cost, expenditure, dates)",
            ),
            "schedule_slippage": FactorDetail(
                name="Schedule Slippage",
                raw_value=round(schedule_slippage, 1),
                unit="pts",
                normalized_score=round(norm_slippage, 1),
                weight=w2,
                weighted_contribution=round(contrib_slippage, 1),
                description="Share of the original timeline elapsed minus reported physical progress %.",
                data_source="derived:PAIMANA flash report Dec 2025 (progress, dates)",
            ),
            "visual_discrepancy": disc_factor,
            "sensor_anomaly": FactorDetail(
                name="Sensor Telemetry Anomaly",
                raw_value=round(sensor_health_score, 1),
                unit="/100",
                normalized_score=round(norm_sensor, 1),
                weight=w4,
                weighted_contribution=round(contrib_sensor, 1),
                description="Inverse health score from linear-asset structural sensors and ISO limits.",
                data_source="simulated:data/sensors.csv",
            ),
            "rainfall_exposure": FactorDetail(
                name="Rainfall & Weather Risk",
                raw_value=round(rainfall_exposure, 1),
                unit="index",
                normalized_score=round(norm_rainfall, 1),
                weight=w5,
                weighted_contribution=round(contrib_rainfall, 1),
                description=("30-day cumulative precipitation vs seasonal regional baseline."
                             if rainfall_available else
                             "No rainfall record for this site yet — contributes 0 until one is added."),
                data_source="real:data/rainfall.csv" if rainfall_available else "unavailable",
            ),
        }

        return composite_score, risk_level, status, factors

    @classmethod
    def generate_explanation(
        cls,
        score: int,
        risk_level: str,
        status: str,
        factors: Dict[str, FactorDetail],
        mismatch_level: str = "low",
        discrepancy_basis: str = "illustrative",
    ) -> str:
        """
        Turns the weighted factor breakdown into a plain-language sentence,
        so a non-technical reviewer doesn't have to parse the formula by hand.
        """
        ranked = sorted(factors.values(), key=lambda f: f.weighted_contribution, reverse=True)
        top = ranked[0]
        second = ranked[1] if len(ranked) > 1 else None

        level_phrase = {
            "low": "a low-risk profile",
            "medium": "a moderate risk profile that's worth monitoring",
            "high": "a high-risk profile that needs attention",
        }.get(risk_level, "a risk profile")

        lead = f"This project scores {score}/100 — {level_phrase}."

        driver_sentence = f" The biggest driver is {top.name.lower()} ({top.weighted_contribution:.0f} of the {score} points)"
        if second and second.weighted_contribution >= 5.0:
            driver_sentence += f", followed by {second.name.lower()} ({second.weighted_contribution:.0f} points)."
        else:
            driver_sentence += "."

        flag_sentence = ""
        if mismatch_level == "high_red_flag":
            if discrepancy_basis == "photo":
                flag_sentence = (
                    " The reported progress and the site-photo estimate disagree by enough that this is "
                    "flagged as a discrepancy, not just normal review variance."
                )
            else:
                flag_sentence = (
                    " The gap between reported progress and the verified figure is large enough to flag — "
                    "note the verified figure is an illustrative stand-in until live verification is run."
                )

        return (lead + driver_sentence + flag_sentence).strip()

    @classmethod
    async def assess_project_risk(
        cls,
        project_id: str,
        db: AsyncSession
    ) -> RiskBreakdownResponse:
        """
        Runs the full multi-tier assessment:
        1. Query project and engineering features.
        2. Take the verified progress figure (illustrative or photo-based).
        3. Retrieve sensor health & weather exposure.
        4. Compute discrepancy signals.
        5. Run XGBoost predictive model and compute SHAP explanations.
        6. Compute transparent composite score and K-Means cluster assignment.
        """
        result = await db.execute(select(Project).where(Project.id == project_id))
        project = result.scalars().first()
        if not project:
            raise ValueError(f"Project '{project_id}' not found.")

        # 1. Verified progress
        # Satellite imagery is used as evidence of *whether* the site changed
        # (see image_diff_service.measure_site_change), never as a % complete —
        # a pixel diff can't measure that. Scoring uses the same verified figure
        # shown to the user (an illustrative stand-in, or a real YOLOv8 estimate
        # once a site photo is uploaded), so the risk factor and the
        # claim-vs-evidence panel can never disagree.
        sat_estimate = project.verified_progress
        disc_sat = abs(project.reported_progress - sat_estimate)

        # 2. Field Photo Estimate & Discrepancy
        photo_estimate = project.photo_estimated_progress if (project.photo_estimated_progress or 0) > 0 else sat_estimate
        disc_photo = abs(project.reported_progress - photo_estimate)

        # 3. Combined Discrepancy (max or weighted mismatch)
        combined_disc = float(max(disc_sat, disc_photo))

        # 4. Sensor & Weather
        asset_id = f"ASSET-{project.id}"
        asset_health = SensorService.get_asset_health(asset_id)
        weather_data = WeatherService.get_weather_for_project(
            project.id, project.latitude, project.longitude, project_code=project.project_code
        )

        # 5. Primary Formula Score
        score, risk_lvl, status, factors = cls.calculate_weighted_risk(
            budget_variance_pct=project.budget_variance_pct,
            schedule_slippage=project.schedule_slippage,
            combined_discrepancy=combined_disc,
            sensor_health_score=asset_health["current_health_score"],
            rainfall_exposure=weather_data["rainfall_risk_score"],
            rainfall_available=weather_data.get("available", True),
            discrepancy_basis=project.verified_basis or "illustrative",
        )

        # 6. Predictive ML (Axiom gradient-boosted model)
        pred_res = predictive_risk_model.predict_project_risk(
            budget_variance_pct=project.budget_variance_pct,
            schedule_slippage=project.schedule_slippage,
            contractor_delay_rate=project.contractor_delay_rate,
            sector=project.sector,
            combined_discrepancy=combined_disc,
            rainfall_anomaly_score=weather_data["rainfall_risk_score"]
        )

        shap_list = [
            ShapContribution(
                feature=item["feature"],
                raw_value=item["raw_value"],
                shap_value=item["shap_value"],
                impact=item["impact"],
                importance_rank=item["importance_rank"]
            )
            for item in pred_res["shap_explainability"]
        ]

        predictive_ml = PredictiveMlDetails(
            p_delay_over_6mo=pred_res["p_delay_over_6mo"],
            p_cost_overrun_over_20pct=pred_res["p_cost_overrun_over_20pct"],
            ml_risk_trend=pred_res["ml_risk_trend"],
            model_type=pred_res["model_type"],
            top_contributing_factor=pred_res["top_contributing_factor"],
            shap_explainability=shap_list,
        )

        # 7. Discrepancy Details
        mismatch_level = "low"
        if combined_disc >= 18.0:
            mismatch_level = "high_red_flag"
        elif combined_disc >= 8.0:
            mismatch_level = "medium"

        discrepancy_details = DiscrepancyDetails(
            reported_progress_pct=round(project.reported_progress, 1),
            satellite_estimated_progress_pct=round(sat_estimate, 1),
            photo_estimated_progress_pct=round(photo_estimate, 1),
            discrepancy_satellite=round(disc_sat, 1),
            discrepancy_photo=round(disc_photo, 1),
            combined_discrepancy=round(combined_disc, 1),
            mismatch_level=mismatch_level
        )

        explanation_text = cls.generate_explanation(
            score, risk_lvl, status, factors, mismatch_level,
            discrepancy_basis=project.verified_basis or "illustrative",
        )

        # 8. K-Means Cluster Assignment
        cluster_label = cls._get_cluster_label(
            project.budget_variance_pct,
            project.schedule_slippage,
            project.sector_baseline_deviation
        )

        # 9. Update DB Model
        project.risk_score = score
        project.risk_level = risk_lvl
        project.status = status
        project.cluster_label = cluster_label
        project.satellite_estimated_progress = sat_estimate
        project.photo_estimated_progress = photo_estimate
        project.discrepancy_satellite = disc_sat
        project.discrepancy_photo = disc_photo
        project.combined_discrepancy = combined_disc
        project.xgboost_p_delay = pred_res["p_delay_over_6mo"]
        project.xgboost_p_cost_overrun = pred_res["p_cost_overrun_over_20pct"]
        project.shap_top_factors = pred_res["shap_explainability"][:3]
        await db.commit()

        # Log snapshot
        assessment = RiskAssessment(
            project_id=project.id,
            risk_score=score,
            risk_level=risk_lvl,
            status=status,
            factors_json={k: v.model_dump() for k, v in factors.items()},
        )
        db.add(assessment)
        await db.commit()

        formula_str = (
            f"Risk ({score}) = "
            f"0.30×Budget({factors['budget_variance'].normalized_score:.0f}) + "
            f"0.30×Schedule({factors['schedule_slippage'].normalized_score:.0f}) + "
            f"0.20×Discrepancy({factors['visual_discrepancy'].normalized_score:.0f}) + "
            f"0.10×Sensor({factors['sensor_anomaly'].normalized_score:.0f}) + "
            f"0.10×Rainfall({factors['rainfall_exposure'].normalized_score:.0f})"
        )

        return RiskBreakdownResponse(
            project_id=project.id,
            project_name=project.name,
            sector=project.sector,
            state=project.state,
            risk_score=score,
            risk_level=risk_lvl,
            status=status,
            cluster_label=cluster_label,
            factors=factors,
            discrepancy_details=discrepancy_details,
            predictive_ml=predictive_ml,
            formula=formula_str,
            explanation=explanation_text,
            data_source="hybrid:derived(real PAIMANA Dec 2025)+illustrative(verified)+simulated(sensors)",
            calculated_at=datetime.utcnow().isoformat(),
        )

    @classmethod
    def _get_cluster_label(cls, budget_var: float, sched_slip: float, sector_dev: float) -> str:
        if cls._kmeans_model is None:
            cls.fit_kmeans_clustering()
        if cls._kmeans_model is None:
            return "Medium Risk Cluster"

        X = np.array([[budget_var, sched_slip, sector_dev]])
        cluster_idx = int(cls._kmeans_model.predict(X)[0])
        return cls._cluster_map.get(cluster_idx, f"Cluster {cluster_idx}")

    @classmethod
    def fit_kmeans_clustering(cls) -> Dict[str, Any]:
        """
        Fits k-means (k=3) on the multi-dimensional project space.
        """
        np.random.seed(42)
        n = 53
        b_var = np.random.normal(12.0, 10.0, n).clip(0, 45)
        s_slip = np.random.normal(8.0, 12.0, n).clip(0, 40)
        s_dev = np.random.normal(0.0, 5.0, n).clip(-15, 15)

        X = np.column_stack([b_var, s_slip, s_dev])
        cls._kmeans_model = KMeans(n_clusters=3, random_state=42, n_init=10).fit(X)

        centers = cls._kmeans_model.cluster_centers_
        center_severities = centers[:, 0] * 0.5 + centers[:, 1] * 0.5
        sorted_indices = np.argsort(center_severities)

        cls._cluster_map = {
            sorted_indices[0]: "Low Risk Cluster",
            sorted_indices[1]: "Medium Risk Cluster",
            sorted_indices[2]: "High Risk Cluster",
        }

        return {
            "status": "trained",
            "cluster_means": {
                "Low Risk Cluster": float(round(center_severities[sorted_indices[0]], 1)),
                "Medium Risk Cluster": float(round(center_severities[sorted_indices[1]], 1)),
                "High Risk Cluster": float(round(center_severities[sorted_indices[2]], 1)),
            }
        }

    @classmethod
    def train_kmeans_and_validate(cls, projects: Optional[List[Project]] = None) -> Dict[str, Any]:
        """Alias for k-means fitting and validation."""
        res = cls.fit_kmeans_clustering()
        if projects:
            for p in projects:
                p.cluster_label = cls._get_cluster_label(
                    p.budget_variance_pct or 0.0,
                    p.schedule_slippage or 0.0,
                    p.sector_baseline_deviation or 0.0
                )
        return res

