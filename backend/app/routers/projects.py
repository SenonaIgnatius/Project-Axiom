import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models.project import Project
from app.schemas.project import (
    ProjectRecordResponse,
    ProjectDetailResponse,
    ProjectCreate,
    SiteImagerySchema,
)
from app.services.risk_engine import RiskEngine
from app.services.demo_registry import build_demo_seed, site_aoi, evidence_route
from app.services.source_page_service import render_source_page

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=List[ProjectRecordResponse])
async def list_projects(
    sector: Optional[str] = Query(None, description="Filter by sector (Roads, Railways, Power, Water)"),
    risk_level: Optional[str] = Query(None, description="Filter by risk level (low, medium, high)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns list of all monitored infrastructure project records.
    Backed by static PAIMANA PDF extractions with engineered features.
    """
    stmt = select(Project)
    if sector and sector.lower() != "all":
        stmt = stmt.where(Project.sector.ilike(sector))
    if risk_level and risk_level.lower() != "all":
        stmt = stmt.where(Project.risk_level.ilike(risk_level))

    stmt = stmt.order_by(desc(Project.risk_score))
    result = await db.execute(stmt)
    projects = result.scalars().all()

    if not projects:
        await seed_default_projects(db)
        result = await db.execute(stmt)
        projects = result.scalars().all()

    # Train clustering on loaded projects
    RiskEngine.train_kmeans_and_validate(list(projects))

    response = []
    for p in projects:
        sat_est = p.satellite_estimated_progress or p.verified_progress or max(0.0, p.reported_progress - 6.0)
        photo_est = p.photo_estimated_progress or sat_est
        disc_sat = p.discrepancy_satellite or abs(p.reported_progress - sat_est)
        disc_photo = p.discrepancy_photo or abs(p.reported_progress - photo_est)
        comb_disc = p.combined_discrepancy or max(disc_sat, disc_photo)

        response.append(
            ProjectRecordResponse(
                id=p.id,
                evidenceRoute=evidence_route(p.id)[0],
                evidenceReason=evidence_route(p.id)[1],
                name=p.name,
                sector=p.sector,  # type: ignore
                state=p.state,
                reportMonth=p.report_month or "2026-08",
                sanctionedCost=p.sanctioned_cost,
                originalCost=p.original_cost or p.sanctioned_cost,
                revisedCost=p.revised_cost or p.sanctioned_cost,
                expenditure=p.expenditure,
                reportedProgress=p.reported_progress,
                verifiedProgress=p.verified_progress,
                satelliteEstimatedProgress=round(sat_est, 1),
                photoEstimatedProgress=round(photo_est, 1),
                discrepancySatellite=round(disc_sat, 1),
                discrepancyPhoto=round(disc_photo, 1),
                combinedDiscrepancy=round(comb_disc, 1),
                mismatchRedFlag=comb_disc >= 12.0,
                xgboostPDelay=round(p.xgboost_p_delay or 0.45, 3),
                xgboostPCostOverrun=round(p.xgboost_p_cost_overrun or 0.38, 3),
                shapTopFactors=p.shap_top_factors,
                riskScore=p.risk_score,
                riskLevel=p.risk_level,  # type: ignore
                status=p.status,  # type: ignore
                delayMonths=p.delay_months,
                startDate=p.start_date,
                expectedEndDate=p.expected_end_date,
                lastVerified=p.last_verified or "2026-08-15",
                budgetVariancePct=round(p.budget_variance_pct or 0.0, 1),
                scheduleSlippage=round(p.schedule_slippage or 0.0, 1),
                sectorBaselineDeviation=round(p.sector_baseline_deviation or 0.0, 1),
                clusterLabel=p.cluster_label or "Medium Risk Cluster",
                dataSource=p.data_source or "real:data/paimana/flash_report.pdf",
                revisedEndDate=p.revised_end_date,
                projectCode=p.project_code,
                officialName=p.official_name,
                agency=p.agency,
                reportState=p.report_state,
                sourcePage=p.source_page,
                alsoOnPages=p.also_on_pages,
                reportNote=p.report_note,
                verifiedBasis=p.verified_basis or "illustrative",
            )
        )
    return response


@router.get("/{project_id}", response_model=ProjectDetailResponse)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns project detail and site geometry backed by static records.
    """
    stmt = select(Project).where(Project.id == project_id)
    project = (await db.execute(stmt)).scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    site = None
    if project.latitude and project.longitude:
        site = SiteImagerySchema(
            lat=project.latitude,
            lng=project.longitude,
            zoom=project.zoom or 14,
            satVerified=project.sat_verified or False,
            beforeDate=project.before_date or "2026-02-15",
            afterDate=project.after_date or "2026-08-12",
            changeDetected=project.change_detected or project.verified_progress,
            ndbiDelta=round(project.ndbi_diff or 0.22, 3),
            aoi=site_aoi(project.id),  # None = project not identifiable in the image
        )

    sat_est = project.satellite_estimated_progress or project.verified_progress or max(0.0, project.reported_progress - 6.0)
    photo_est = project.photo_estimated_progress or sat_est
    disc_sat = project.discrepancy_satellite or abs(project.reported_progress - sat_est)
    disc_photo = project.discrepancy_photo or abs(project.reported_progress - photo_est)
    comb_disc = project.combined_discrepancy or max(disc_sat, disc_photo)

    return ProjectDetailResponse(
        id=project.id,
        evidenceRoute=evidence_route(project.id)[0],
        evidenceReason=evidence_route(project.id)[1],
        name=project.name,
        sector=project.sector,  # type: ignore
        state=project.state,
        reportMonth=project.report_month or "2026-08",
        sanctionedCost=project.sanctioned_cost,
        originalCost=project.original_cost or project.sanctioned_cost,
        revisedCost=project.revised_cost or project.sanctioned_cost,
        expenditure=project.expenditure,
        reportedProgress=project.reported_progress,
        verifiedProgress=project.verified_progress,
        satelliteEstimatedProgress=round(sat_est, 1),
        photoEstimatedProgress=round(photo_est, 1),
        discrepancySatellite=round(disc_sat, 1),
        discrepancyPhoto=round(disc_photo, 1),
        combinedDiscrepancy=round(comb_disc, 1),
        mismatchRedFlag=comb_disc >= 12.0,
        xgboostPDelay=round(project.xgboost_p_delay or 0.45, 3),
        xgboostPCostOverrun=round(project.xgboost_p_cost_overrun or 0.38, 3),
        shapTopFactors=project.shap_top_factors,
        riskScore=project.risk_score,
        riskLevel=project.risk_level,  # type: ignore
        status=project.status,  # type: ignore
        delayMonths=project.delay_months,
        startDate=project.start_date,
        expectedEndDate=project.expected_end_date,
        lastVerified=project.last_verified or "2026-08-15",
        budgetVariancePct=round(project.budget_variance_pct or 0.0, 1),
        scheduleSlippage=round(project.schedule_slippage or 0.0, 1),
        sectorBaselineDeviation=round(project.sector_baseline_deviation or 0.0, 1),
        clusterLabel=project.cluster_label or "Medium Risk Cluster",
        dataSource=project.data_source or "real:data/paimana/flash_report.pdf",
        revisedEndDate=project.revised_end_date,
        projectCode=project.project_code,
        officialName=project.official_name,
        agency=project.agency,
        reportState=project.report_state,
        sourcePage=project.source_page,
        alsoOnPages=project.also_on_pages,
        reportNote=project.report_note,
        verifiedBasis=project.verified_basis or "illustrative",
        site=site,
    )


@router.get("/{project_id}/source-page")
async def get_source_page(project_id: str, full: bool = False, db: AsyncSession = Depends(get_db)):
    """
    PNG of the PAIMANA flash-report page this project's reported figures come
    from, with the project's row highlighted.
    """
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
    if not project.source_page or not project.project_code:
        raise HTTPException(status_code=404, detail="No PAIMANA source page recorded for this project")
    path = render_source_page(project.project_code, project.source_page, full=full)
    if not path:
        raise HTTPException(status_code=500, detail="Could not render the source page")
    return FileResponse(path, media_type="image/png")


@router.post("/{project_id}/escalate")
async def escalate_project(project_id: str, db: AsyncSession = Depends(get_db)):
    """
    SIMULATED escalation: drafts the notice Axiom would send the implementing
    agency for a flagged project. Nothing is emailed, messaged or stored.
    """
    import hashlib
    from datetime import datetime

    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    now = datetime.utcnow()
    ref = "SEN-ESC-{}-{}".format(
        now.strftime("%Y%m%d"),
        hashlib.sha1(f"{project.id}{now.isoformat()}".encode()).hexdigest()[:6].upper(),
    )
    gap = abs((project.reported_progress or 0) - (project.verified_progress or 0))
    overrun = (project.revised_cost or 0) - (project.original_cost or 0)
    findings = [
        f"Reported physical progress: {project.reported_progress:.0f}% "
        f"(PAIMANA {project.report_month or ''}, PDF page {project.source_page})",
        f"Verified progress: {project.verified_progress:.1f}% "
        f"({'site photo, YOLOv8' if project.verified_basis == 'photo' else 'illustrative stand-in — live verification pending'})"
        f" — gap {gap:.1f} pts",
        f"Completion: originally {project.expected_end_date or 'n/a'}, now {project.revised_end_date or 'no revised date given'}"
        f" ({project.delay_months} months late)",
        f"Cost: ₹{project.original_cost:,.0f} cr → ₹{project.revised_cost:,.0f} cr "
        f"({'+' if overrun >= 0 else ''}₹{overrun:,.0f} cr); spent ₹{project.expenditure:,.0f} cr",
        f"Axiom composite risk score: {project.risk_score}/100 ({project.risk_level})",
    ]
    if project.report_note:
        findings.append(f"Data-quality flag: {project.report_note}")

    return {
        "simulated": True,
        "sent": False,
        "reference": ref,
        "drafted_at": now.strftime("%Y-%m-%d %H:%M UTC"),
        "to": project.agency or "Implementing agency",
        "cc": "Infrastructure & Project Monitoring Division, MoSPI",
        "subject": f"Request for progress clarification — {project.official_name or project.name} (PAIMANA {project.project_code})",
        "findings": findings,
        "requested_action": (
            "Please confirm the reported physical progress with dated site evidence "
            "(geotagged photographs or the latest measurement book entry) within 15 days."
        ),
        "note": "Simulated for demonstration — no message was sent and nothing was stored.",
    }


async def seed_default_projects(db: AsyncSession) -> int:
    """
    Seeds the demo projects. Reported figures come from the real PAIMANA flash
    report (Dec 2025) via data/paimana/paimana_projects.json.
    """
    # Real PAIMANA figures + team-set site metadata (see app/services/demo_registry.py)
    SEED_DATA = build_demo_seed()

    count = 0
    projects_list = []
    for item in SEED_DATA:
        stmt = select(Project).where(Project.id == item["id"])
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            projects_list.append(existing)
            continue

        score, risk_level, status, _ = RiskEngine.calculate_weighted_risk(
            budget_variance_pct=item["budget_variance_pct"],
            schedule_slippage=item["schedule_slippage"],
            photo_gap=abs(item["reported_progress"] - item["verified_progress"]),
            sensor_health_score=90.0,
            rainfall_exposure=20.0,
        )

        p = Project(
            id=item["id"],
            name=item["name"],
            sector=item["sector"],
            state=item["state"],
            sanctioned_cost=item["sanctioned_cost"],
            expenditure=item["expenditure"],
            reported_progress=item["reported_progress"],
            verified_progress=item["verified_progress"],
            delay_months=item["delay_months"],
            budget_variance_pct=item["budget_variance_pct"],
            schedule_slippage=item["schedule_slippage"],
            sector_baseline_deviation=item["sector_baseline_deviation"],
            last_verified=item["last_verified"],
            risk_score=score,
            risk_level=risk_level,
            status=status,
            latitude=item["latitude"],
            longitude=item["longitude"],
            zoom=item["zoom"],
            sat_verified=item["sat_verified"],
            before_date=item["before_date"],
            after_date=item["after_date"],
            change_detected=item["change_detected"],
            aoi_json=item["aoi_json"],
            data_source="real:data/paimana/flash_report.pdf",
            project_code=item["project_code"],
            official_name=item["official_name"],
            agency=item["agency"],
            report_state=item["report_state"],
            report_month=item["report_month"],
            original_cost=item["original_cost"],
            revised_cost=item["revised_cost"],
            start_date=item["start_date"],
            expected_end_date=item["expected_end_date"],
            revised_end_date=item["revised_end_date"],
            source_page=item["source_page"],
            also_on_pages=item["also_on_pages"],
            report_note=item["report_note"],
            verified_basis=item["verified_basis"],
        )
        db.add(p)
        projects_list.append(p)
        count += 1

    if projects_list:
        RiskEngine.train_kmeans_and_validate(projects_list)
    await db.commit()

    # Score every project through the same pipeline the project page uses, so the
    # register's badges and the detail page can never disagree.
    for proj in projects_list:
        try:
            await RiskEngine.assess_project_risk(proj.id, db)
        except Exception as e:  # never block seeding on one project
            logging.getLogger(__name__).warning(f"Initial risk assessment failed for {proj.id}: {e}")
    return count
