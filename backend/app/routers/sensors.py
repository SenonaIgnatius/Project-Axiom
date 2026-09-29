from typing import List, Union, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.sensor import (
    SensorReadingInput,
    SensorBatchIngest,
    SensorIngestResponse,
    AssetHealthResponse,
)
from app.services.sensor_service import SensorService

router = APIRouter(prefix="", tags=["sensors"])


@router.get("/assets/{asset_id}/health", response_model=AssetHealthResponse)
async def get_asset_health_endpoint(asset_id: str, project_id: Optional[str] = None):
    """
    Returns real-time health score (0-100), status, anomaly z-score, and historical
    telemetry for linear-asset charting, backed by data/sensors.csv.
    """
    res = SensorService.get_asset_health(asset_id, project_id)
    return AssetHealthResponse(**res)


@router.post("/sensors/ingest", response_model=SensorIngestResponse)
async def ingest_sensor_readings(
    payload: Union[SensorBatchIngest, SensorReadingInput] = Body(...),
):
    """
    Simulates hardware ingestion endpoint for linear assets.
    """
    if isinstance(payload, SensorBatchIngest):
        readings = payload.readings
    else:
        readings = [payload]

    if not readings:
        raise HTTPException(status_code=400, detail="No readings in payload")

    asset_id = readings[0].asset_id
    health_data = SensorService.get_asset_health(asset_id, readings[0].project_id)

    return SensorIngestResponse(
        status="success",
        ingested_count=len(readings),
        asset_id=asset_id,
        latest_health_score=health_data["current_health_score"],
        asset_status=health_data["status"],
        data_source="simulated:data/sensors.csv",
    )


@router.post("/sensors/simulate/{asset_id}")
async def simulate_sensor_scenario(asset_id: str, scenario: str = "normal"):
    """
    Injects a SIMULATED reading (vibration spike, thermal overload, critical
    strain) on top of the asset's simulated telemetry, so the UI can show how
    the health score and risk score respond. "normal" clears it. In-memory only.
    """
    try:
        key = SensorService.simulate_scenario(asset_id, scenario)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    health = SensorService.get_asset_health(asset_id, key)
    return {
        "simulated": True,
        "scenario": scenario,
        "asset_id": asset_id,
        "project_id": key,
        "health": AssetHealthResponse(**health),
        "note": "Simulated scenario on simulated telemetry — no physical sensors are involved.",
    }
