"""
Unit Tests for Axiom Explainable Risk Engine & Dynamic Weight Renormalization
Validates transparent 5-factor formula and sensor weight renormalization.
"""

import pytest
from app.services.risk_engine import RiskEngine


def test_standard_weighted_formula():
    """Validates baseline 0.30/0.30/0.20/0.10/0.10 calculation."""
    score, risk_lvl, status, factors = RiskEngine.calculate_weighted_risk(
        budget_variance_pct=15.0,
        schedule_slippage=10.0,
        combined_discrepancy=5.0,
        sensor_health_score=85.0,
        rainfall_exposure=20.0,
        sensor_available=True,
        rainfall_available=True,
    )
    assert 0 <= score <= 100
    assert risk_lvl in ("low", "medium", "high")
    assert status in ("on-track", "delayed", "critical")
    assert factors["sensor_anomaly"].weight == pytest.approx(0.10, abs=0.01)


def test_simulated_sensors_renormalization():
    """
    CRITICAL: Validates that when sensor data is simulated or unavailable,
    sensor weight is 0.0 and remaining verifiable factors renormalize to sum to 1.0.
    """
    score, risk_lvl, status, factors = RiskEngine.calculate_weighted_risk(
        budget_variance_pct=15.0,
        schedule_slippage=10.0,
        combined_discrepancy=5.0,
        sensor_health_score=85.0,
        rainfall_exposure=20.0,
        sensor_available=False,  # Sensors disabled / uninstalled
        rainfall_available=True,
    )
    # Sensor factor should have 0 weight and 0 contribution
    assert factors["sensor_anomaly"].weight == 0.0
    assert factors["sensor_anomaly"].weighted_contribution == 0.0
    assert "unavailable" in factors["sensor_anomaly"].data_source

    # Other weights should sum to 1.0
    active_sum = (
        factors["budget_variance"].weight
        + factors["schedule_slippage"].weight
        + factors["visual_discrepancy"].weight
        + factors["rainfall_exposure"].weight
    )
    assert active_sum == pytest.approx(1.0, abs=0.01)
    # Budget variance weight should have increased from 0.30 to ~0.333
    assert factors["budget_variance"].weight > 0.30
