from pathlib import Path
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.project import Project
from app.models.satellite_image_cache import SatelliteImageCache
from app.services.satellite_service import simulate_sentinel2_change_detection
from app.services.image_diff_service import detect_change_region
from app.config import settings

logger = logging.getLogger("sentinel-satellite-router")
router = APIRouter(prefix="/satellite", tags=["satellite"])

@router.get("/{project_id}/change-detection")
async def get_satellite_change_detection(
    project_id: str, db: AsyncSession = Depends(get_db)
):
    """
    Returns Sentinel-2 Level-2A change detection analysis and imagery metadata.
    Reads ONLY from SatelliteImageCache database table and pre-existing static assets.
    Never executes outbound CDSE or tile network requests synchronously.
    """
    stmt = select(Project).where(Project.id == project_id)
    project = (await db.execute(stmt)).scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    result = simulate_sentinel2_change_detection(
        project_id=project.id,
        reported_progress=project.reported_progress
    )

    lat = project.latitude or 22.91431
    lng = project.longitude or 88.19824
    zoom = project.zoom or 14
    copernicus_url = f"https://browser.dataspace.copernicus.eu/?zoom={zoom}&lat={lat:.5f}&lng={lng:.5f}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX1%2F%2BgCguT%2BwC0%2BAwoBQEh4RnBYm7i1wvnDNkW1gKnnAO4s%2F05Jmu9q5GKxksbcUXg%2FKMfpfL%2B3eUiFUORL0nTVkyb%2F9Hn330hURQvJLMXhDkx5LgUG1rK3%2Ft&datasetId=S2_L2A_CDAS&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE"

    # Separate sources: preserve existing heuristic NDBI disclosure
    change_detection_source = result.get("methodology") or "Heuristic simulation calibrated per-project for demo purposes (not live change detection)"

    # Query local database cache (zero network calls)
    cache_stmt = select(SatelliteImageCache).where(SatelliteImageCache.project_id == project_id)
    cache_row = (await db.execute(cache_stmt)).scalar_one_or_none()

    placeholder_cloud_cover = float(result.pop("cloud_cover_pct", 2.1) or 2.1)
    result.pop("data_source", None)

    is_project_specific_pair = False

    if cache_row:
        image_source = "Copernicus Sentinel-2 L2A (CDSE Cached)"
        before_date = cache_row.before_scene_date or project.before_date or "2024-03-10"
        after_date = cache_row.after_scene_date or project.after_date or "2026-08-12"
        cloud_cover_before = cache_row.cloud_cover_before
        cloud_cover_after = cache_row.cloud_cover_after
        cloud_cover_pct = cache_row.cloud_cover_after if cache_row.cloud_cover_after is not None else placeholder_cloud_cover
        fetch_status = cache_row.fetch_status
        fetched_at = cache_row.fetched_at.isoformat() if cache_row.fetched_at else None
        before_image_path = cache_row.before_image_path
        after_image_path = cache_row.after_image_path
        is_project_specific_pair = True
    else:
        # Fallback: strictly check local filesystem for pre-existing static tiles without making network calls
        image_source = "Cached site imagery (capture source not yet confirmed)"
        before_date = project.before_date or "2024-03-10"
        after_date = project.after_date or "2026-08-12"
        cloud_cover_before = None
        cloud_cover_after = None
        cloud_cover_pct = placeholder_cloud_cover  # Never null, equals 2.1
        fetch_status = "uncached_fallback"
        fetched_at = None

        # Fallback location: the already-mounted satellite cache directory
        # (a separate "sentinel/public/satellite" path was referenced here
        # previously but never existed on disk, so this always 404'd).
        public_sat_dir = settings.SATELLITE_CACHE_DIR
        local_before = public_sat_dir / f"{project.id}_before.jpg"
        local_after = public_sat_dir / f"{project.id}_after.jpg"

        if local_before.exists() and local_after.exists():
            before_image_path = str(local_before)
            after_image_path = str(local_after)
            is_project_specific_pair = True
        else:
            # No project-specific pair — fall back to a sector-appropriate
            # generic tile rather than always defaulting to "roads" regardless
            # of what this project actually is.
            sector_key = (project.sector or "").strip().lower()
            sector_fallback = {
                "roads": "roads",
                "railways": "railways",
                "power": "power",
                "water": "water",
            }.get(sector_key, "roads")
            sector_before = public_sat_dir / f"{sector_fallback}_before.jpg"
            sector_after = public_sat_dir / f"{sector_fallback}_after.jpg"

            if sector_before.exists() and sector_after.exists():
                logger.warning(
                    f"No project-specific imagery for {project_id} — using {sector_fallback} sector fallback."
                )
                before_image_path = str(sector_before)
                after_image_path = str(sector_after)
            else:
                logger.warning(f"No cached Sentinel-2 imagery or local static tile found for {project_id}. Serving default asset.")
                before_image_path = str(public_sat_dir / "roads_before.jpg")
                after_image_path = str(public_sat_dir / "roads_after.jpg")

    detected_change_box = None
    if is_project_specific_pair:
        try:
            detected_change_box = detect_change_region(
                Path(before_image_path),
                Path(after_image_path),
                aoi_pct=project.aoi_json,
            )
        except Exception as e:
            logger.warning(f"Change-region diff failed for {project_id}: {e}")

    result.update({
        "detected_change_box": detected_change_box,
        "project_name": project.name,
        "latitude": lat,
        "longitude": lng,
        "before_date": before_date,
        "after_date": after_date,
        "verified_progress_pct": project.verified_progress,
        "copernicus_browser_url": copernicus_url,
        # Disambiguated independent source fields
        "image_source": image_source,
        "change_detection_source": change_detection_source,
        # Real cloud cover metrics + clearly renamed placeholder
        "cloud_cover_before": cloud_cover_before,
        "cloud_cover_after": cloud_cover_after,
        "cloud_cover_pct": cloud_cover_pct,
        "placeholder_cloud_cover_pct": placeholder_cloud_cover,
        # Imagery cache metadata
        "before_image_path": before_image_path,
        "after_image_path": after_image_path,
        "fetch_status": fetch_status,
        "fetched_at": fetched_at,
    })

    return result
