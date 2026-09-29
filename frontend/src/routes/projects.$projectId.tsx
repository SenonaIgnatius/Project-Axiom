import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { progressGap, inrCrore, GAP_THRESHOLD } from "@/data/projects";
import {
  RiskTag,
  StatusTag,
  Meter,
  GapBar,
} from "@/components/console";
import { SatFrame } from "@/components/satellite";
import {
  getProject,
  getRiskBreakdown,
  getAssetHealth,
  classifySitePhoto,
  getOverrunPrediction,
  type OverrunPrediction,
  type SiteChange,
  type PhotoIntegrity,
  type IntegrityCheck,
  simulateTelemetryScenario,
  getSatelliteChangeDetection,
  getPeerBenchmark,
  getProjectHistory,
  getScenarioBaseline,
  runScenarioSimulation,
  escalateProject,
  sourcePageUrl,
  reportRowUrl,
  satelliteImageUrl,
  RiskBreakdown,
  EscalationNotice,
  AssetHealth,
  PhotoClassification,
  SatelliteAnalysis,
  PeerBenchmarkResponse,
  ProjectHistoryResponse,
  ScenarioResponse,
} from "@/lib/api";
import type { ProjectRecord, EvidenceRoute } from "@/data/projects";
import { SourceRow, ReportNote, StatusPill, LoadError } from "@/components/provenance";

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ params }) => {
    try {
      return { ...(await getProject(params.projectId)), error: null as string | null };
    } catch (e: any) {
      // A missing project and an unreachable backend are different problems — say which.
      return { project: null as any, site: undefined, error: String(e?.message || e) };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.project
          ? `${loaderData.project.name} · Axiom`
          : "Project record · Axiom",
      },
    ],
  }),
  component: () => {
    const data = Route.useLoaderData();
    if (!data.project) {
      if (data.error && !data.error.startsWith("404")) {
        return (
          <div className="mx-auto max-w-[1400px] px-6 py-16">
            <LoadError what="this project" error={data.error} />
          </div>
        );
      }
      return <RecordNotFound />;
    }
    // key: navigating project → project reuses this route, so without a key the
    // page kept the first project's state (and images) for every later one.
    return <ProjectDetail key={data.project.id} />;
  },
});

/** "+12.3" / "-4.0" — never "+-4.0". */
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

function RecordNotFound() {
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-24">
      <div className="label-xs">record 404</div>
      <h1 className="mt-3 text-4xl">No such project record</h1>
      <Link
        to="/projects"
        className="mt-6 inline-block border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background"
      >
        Back to register
      </Link>
    </div>
  );
}

function ProjectDetail() {
  const { project: initialProject, site } = Route.useLoaderData();
  const [p, setP] = useState<ProjectRecord>(initialProject);
  const [riskBreakdown, setRiskBreakdown] = useState<RiskBreakdown | null>(null);
  const [assetHealth, setAssetHealth] = useState<AssetHealth | null>(null);
  const [satAnalysis, setSatAnalysis] = useState<SatelliteAnalysis | null>(null);
  const [peerBenchmark, setPeerBenchmark] = useState<PeerBenchmarkResponse | null>(null);
  const [historyData, setHistoryData] = useState<ProjectHistoryResponse | null>(null);
  const [selectedSnapshotIdx, setSelectedSnapshotIdx] = useState<number>(0);

  // Scenario Explorer state
  const [scenarioData, setScenarioData] = useState<ScenarioResponse | null>(null);
  const [simProgress, setSimProgress] = useState<number>(p.reportedProgress);
  const [simVerified, setSimVerified] = useState<number>(p.verifiedProgress);
  const [simExpenditure, setSimExpenditure] = useState<number>(p.expenditure);
  const [simRunning, setSimRunning] = useState<boolean>(false);

  // Escalation (simulated) state
  const [notice, setNotice] = useState<EscalationNotice | null>(null);
  const [early, setEarly] = useState<OverrunPrediction | null>(null);
  const [drafting, setDrafting] = useState(false);

  // Panel load failures are shown, never silently replaced with other numbers
  type Panel = "risk" | "imagery" | "telemetry" | "benchmark" | "history" | "scenario" | "escalation" | "early";
  const [errors, setErrors] = useState<Partial<Record<Panel, string>>>({});
  const fail = (key: Panel) => (e: any) => setErrors((prev) => ({ ...prev, [key]: String(e?.message || e) }));
  
  // Photo verification upload state
  const [uploading, setUploading] = useState(false);
  const [photoResult, setPhotoResult] = useState<PhotoClassification | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Sensor simulation state
  const [simulating, setSimulating] = useState(false);

  const assetId = `ASSET-${p.id}`;

  useEffect(() => {
    // Load live risk breakdown, satellite analysis, and sensor health
    getRiskBreakdown(p.id)
      .then((rb) => {
        setRiskBreakdown(rb);
        setP((prev) => ({ ...prev, riskScore: rb.risk_score, riskLevel: rb.risk_level, status: rb.status }));
      })
      .catch(fail("risk"));

    getSatelliteChangeDetection(p.id).then(setSatAnalysis).catch(fail("imagery"));
    getAssetHealth(assetId).then(setAssetHealth).catch(fail("telemetry"));
    getPeerBenchmark(p.id).then(setPeerBenchmark).catch(fail("benchmark"));
    getOverrunPrediction(p.id).then(setEarly).catch(fail("early"));

    getProjectHistory(p.id)
      .then((hist) => {
        setHistoryData(hist);
        if (hist.snapshots.length > 0) setSelectedSnapshotIdx(hist.snapshots.length - 1);
      })
      .catch(fail("history"));

    getScenarioBaseline(p.id)
      .then((sc) => {
        setScenarioData(sc);
        setSimProgress(p.reportedProgress);
        setSimVerified(p.verifiedProgress);
        setSimExpenditure(p.expenditure);
      })
      .catch(fail("scenario"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const gap = progressGap(p);
  const absGap = Math.abs(gap);
  const util = (p.expenditure / (p.revisedCost || p.sanctionedCost)) * 100;
  // One threshold, computed from the two numbers on screen, used everywhere on this page.
  const isRedFlag = absGap >= GAP_THRESHOLD;
  const fromPhoto = p.verifiedBasis === "photo";

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const preview = URL.createObjectURL(file);
    setPhotoPreview(preview);
    setUploading(true);
    setPhotoError(null);
    try {
      const res = await classifySitePhoto(file, p.id, true);
      setPhotoResult(res);
      // Pick up the photo-based verified figure exactly as the backend stored it.
      const { project: fresh } = await getProject(p.id);
      setP((prev) => ({ ...prev, ...fresh }));
      const updatedRb = await getRiskBreakdown(p.id);
      setRiskBreakdown(updatedRb);
      setP((prev) => ({ ...prev, riskScore: updatedRb.risk_score, riskLevel: updatedRb.risk_level, status: updatedRb.status }));
      setScenarioData(await getScenarioBaseline(p.id));
    } catch (err: any) {
      setPhotoError(err.message || "Failed to classify image with YOLOv8");
    } finally {
      setUploading(false);
    }
  };

  const handleSimulateSensor = async (
    scenario: "normal" | "vibration_spike" | "thermal_overload" | "strain_critical"
  ) => {
    setSimulating(true);
    try {
      await simulateTelemetryScenario(assetId, scenario);
      setAssetHealth(await getAssetHealth(assetId));
      const updatedRb = await getRiskBreakdown(p.id);
      setRiskBreakdown(updatedRb);
      setP((prev) => ({ ...prev, riskScore: updatedRb.risk_score, riskLevel: updatedRb.risk_level, status: updatedRb.status }));
    } catch (err) {
      fail("telemetry")(err);
    } finally {
      setSimulating(false);
    }
  };

  const handleApplySimulation = async () => {
    setSimRunning(true);
    try {
      const res = await runScenarioSimulation({
        project_id: p.id,
        physical_progress_pct: simProgress,
        verified_progress_pct: simVerified,
        expenditure_cr: simExpenditure,
      });
      setScenarioData(res);
    } catch (err) {
      fail("scenario")(err);
    } finally {
      setSimRunning(false);
    }
  };

  const handleResetSimulation = async () => {
    setSimRunning(true);
    try {
      const res = await getScenarioBaseline(p.id);
      setScenarioData(res);
      setSimProgress(p.reportedProgress);
      setSimVerified(p.verifiedProgress);
      setSimExpenditure(p.expenditure);
    } catch (err) {
      fail("scenario")(err);
    } finally {
      setSimRunning(false);
    }
  };

  const handleEscalate = async () => {
    setDrafting(true);
    try {
      setNotice(await escalateProject(p.id));
    } catch (err) {
      fail("escalation")(err);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6">
      {/* Header */}
      <div className="border-b border-border py-12">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/projects"
            className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Register
          </Link>
          <span className="font-mono text-[11px] tracking-widest text-muted-foreground">
            / {p.id}
          </span>
          <span className="font-mono text-[11px] border border-border px-2 py-0.5 text-muted-foreground">
            PAIMANA {p.reportMonth} · code {p.projectCode}
          </span>
        </div>
        <h1 className="mt-4 max-w-4xl text-3xl sm:text-4xl">{p.name}</h1>
        {p.officialName && p.officialName !== p.name && (
          <p className="mt-2 max-w-4xl font-mono text-[11px] leading-relaxed text-muted-foreground">
            As listed in the report: {p.officialName}
            {p.agency ? ` · ${p.agency}` : ""}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
            {p.sector}
          </span>
          <span className="text-sm text-muted-foreground">{p.state}</span>
          <RiskTag level={p.riskLevel} />
          <StatusTag status={p.status} />
          <span className="font-mono text-[11px] text-muted-foreground">
            {p.delayMonths ? `${p.delayMonths} mo behind schedule` : "on schedule"}
          </span>
          <EvidenceTag route={p.evidenceRoute} photoDone={fromPhoto} />
          {riskBreakdown?.cluster_label && (
            <span className="font-mono text-[11px] border border-border px-2 py-0.5 text-muted-foreground bg-surface">
              {riskBreakdown.cluster_label}
            </span>
          )}
        </div>

        {/* Project Timeline & Milestone Dates */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 border border-border p-4 bg-surface/40 font-mono text-xs">
          <div>
            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Start (per report)</span>
            <strong className="text-foreground text-sm font-mono">{p.startDate || "—"}</strong>
          </div>
          <div className="border-l border-border pl-4">
            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Original Target</span>
            <strong className="text-foreground text-sm font-mono">{p.expectedEndDate || "—"}</strong>
          </div>
          <div className="border-l border-border pl-4">
            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Revised Target</span>
            <strong className={`text-sm font-mono ${p.delayMonths > 0 ? "text-amber-400" : "text-foreground"}`}>
              {p.revisedEndDate || "not revised"}
            </strong>
          </div>
          <div className="border-l border-border pl-4">
            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">
              {fromPhoto ? "Photo Verified On" : "Latest Site Imagery"}
            </span>
            <strong className="text-foreground text-sm font-mono">{p.lastVerified || "—"}</strong>
          </div>
        </div>
      </div>

      {/* Financial + Progress Summary Ledger */}
      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-5">
        {[
          {
            k: "Revised Cost",
            v: `₹${inrCrore(p.revisedCost || p.sanctionedCost)} cr`,
            n: p.originalCost && p.revisedCost && p.revisedCost !== p.originalCost
              ? `original ₹${inrCrore(p.originalCost)} cr`
              : "unchanged from original",
          },
          { k: "Expenditure", v: `₹${inrCrore(p.expenditure)} cr`, n: "per the report" },
          { k: "Spent vs Revised Cost", v: `${util.toFixed(0)}%`, n: `physical progress ${p.reportedProgress}%` },
          { k: "Composite Risk Score", v: `${p.riskScore}/100`, n: p.riskLevel },
          { k: "Reported − Verified", v: `${absGap.toFixed(1)} pts`, n: fromPhoto ? "photo-verified" : "verified figure illustrative" },
        ].map((s) => (
          <div key={s.k} className="border-r border-border px-5 py-6 last:border-r-0">
            <div className="label-xs">{s.k}</div>
            <div className="mt-2 font-display text-2xl font-extrabold tabular-nums">
              {s.v}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">{s.n}</div>
          </div>
        ))}
      </div>

      {/* 🔴 Discrepancy Alert Banner */}
      {isRedFlag && (
        <div className="my-8 border-2 border-red-500/80 bg-red-500/10 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-widest font-bold text-red-400 border border-red-500/60 px-2 py-0.5">
                Reported vs verified gap above {GAP_THRESHOLD} points
              </span>
              <h3 className="mt-2 text-xl font-bold text-foreground">
                Reported progress ({p.reportedProgress}%) vs verified figure ({p.verifiedProgress}%)
              </h3>
              <p className="mt-2 text-xs text-muted-foreground max-w-3xl leading-relaxed">
                {fromPhoto ? (
                  <>
                    The report says <strong>{p.reportedProgress}%</strong>; the uploaded site photo (YOLOv8) puts it at{" "}
                    <strong>{p.verifiedProgress}%</strong>. A gap this size is flagged for review.
                  </>
                ) : (
                  <>
                    The verified figure here is an <strong>illustrative stand-in</strong> until a site photo is verified
                    in Layer 05 — treat this alert as a demonstration of the check, not a finding about the project.
                  </>
                )}
              </p>
            </div>
            <div className="text-right font-mono">
              <div className="text-xs text-muted-foreground uppercase">Gap</div>
              <div className="text-3xl font-display font-extrabold text-red-400">
                {absGap.toFixed(1)} pts
              </div>
            </div>
          </div>
        </div>
      )}

      <ReportNote note={p.reportNote} />

      {/* 01. Independent Discrepancy Computation Layer */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 01 · Claim vs Evidence</div>
            <h2 className="mt-3 text-2xl">Reported vs Verified Progress</h2>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            |Reported − Verified| · review threshold {GAP_THRESHOLD} pts
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="border border-border p-5 bg-surface/30">
            <div className="label-xs">1. Reported on Paper</div>
            <div className="mt-3 font-display text-3xl font-bold tabular-nums">
              {p.reportedProgress.toFixed(1)}%
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              MoSPI PAIMANA flash report · p. {p.sourcePage}
            </div>
          </div>

          <div className="border border-border p-5 bg-surface/30">
            <div className="label-xs">2. Verified Figure</div>
            <div className="mt-3 font-display text-3xl font-bold tabular-nums text-blue-400">
              {p.verifiedProgress.toFixed(1)}%
            </div>
            <div className="mt-2">
              {fromPhoto ? (
                <StatusPill status="real">from site photo</StatusPill>
              ) : (
                <StatusPill status="illustrative">illustrative stand-in</StatusPill>
              )}
            </div>
          </div>

          <div className="border border-border p-5 bg-surface/30">
            <div className="label-xs">3. YOLOv8 Photo Estimate</div>
            <div className="mt-3 font-display text-3xl font-bold tabular-nums text-emerald-400">
              {photoResult?.photo_verified_estimate != null ? `${photoResult.photo_verified_estimate.toFixed(1)}%` : "—"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {photoResult
                ? photoResult.project_updated === false
                  ? "Photo failed the integrity check · not used (Layer 05)"
                  : "From the photo verified in Layer 05"
                : "No photo verified yet · upload in Layer 05"}
            </div>
          </div>

          <div className="border border-border p-5 bg-surface/50">
            <div className="label-xs">Gap</div>
            <div className={`mt-3 font-display text-3xl font-bold tabular-nums ${isRedFlag ? "text-red-400" : "text-foreground"}`}>
              {absGap.toFixed(1)} pts
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {isRedFlag ? "Flagged for review" : `Below the ${GAP_THRESHOLD}-point threshold`}
            </div>
          </div>
        </div>

        <SourceRow
          code={p.projectCode}
          page={p.sourcePage}
          excerptUrl={sourcePageUrl(p.id)}
          fullUrl={sourcePageUrl(p.id, true)}
          officialName={p.officialName}
          agency={p.agency}
        />
      </section>

      {/* 02. Auditable Transparent Weighted Risk Formula */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 02 · Auditable Risk Scoring</div>
            <h2 className="mt-3 text-2xl">Transparent Risk Composition</h2>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            Deterministic 5-Factor Model
          </div>
        </div>

        {errors.risk && <LoadError what="the risk breakdown" error={errors.risk} />}
        {riskBreakdown ? (
          <div className="mt-8 space-y-6">
            {riskBreakdown.explanation && (
              <p className="max-w-3xl text-sm leading-relaxed text-foreground/90">{riskBreakdown.explanation}</p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              {Object.entries(riskBreakdown.factors).map(([key, factor]) => (
                <div key={key} className="border border-border p-4 bg-surface/40">
                  <div className="label-xs">{factor.name}</div>
                  <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                    {factor.normalized_score.toFixed(0)}
                    <span className="text-xs font-normal text-muted-foreground">/100</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Weight: {(factor.weight * 100).toFixed(0)}% · +{factor.weighted_contribution.toFixed(1)} pts
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {factor.description}
                  </p>
                  <div className="mt-2 font-mono text-[10px] text-muted-foreground/80 break-words">
                    {factor.data_source}
                  </div>
                </div>
              ))}
            </div>

            <div className="border border-dashed border-border p-4 font-mono text-xs text-muted-foreground">
              <span className="font-bold text-foreground">Formula: </span>
              {riskBreakdown.formula}
            </div>
          </div>
        ) : !errors.risk && (
          <div className="mt-6 font-mono text-xs text-muted-foreground">
            Loading risk breakdown…
          </div>
        )}
      </section>

      {/* 03. Early-warning prediction (real models trained on the whole report) */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 03 · Early-Warning Prediction</div>
            <h2 className="mt-3 text-2xl">Would This Project Have Been Flagged at Approval?</h2>
          </div>
          <div className="flex flex-col items-start gap-1.5 font-mono text-[11px] sm:items-end">
            <StatusPill status="real">real data · cross-validated</StatusPill>
            <Link to="/models" className="text-[10px] text-muted-foreground underline hover:text-foreground">
              How the models were trained and compared →
            </Link>
          </div>
        </div>

        {errors.early && <LoadError what="the early-warning prediction" error={errors.early} />}

        {early ? (
          <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-12">
            <div className="space-y-4 md:col-span-5">
              {(
                [
                  ["Cost overrun ≥ 20%", early.p_cost_overrun, early.cost_percentile, early.overall_rates.cost_overrun,
                    early.cost_overrun_actual, `report: ${early.cost_escalation_pct >= 0 ? "+" : ""}${early.cost_escalation_pct}% cost`, "cost_overrun"],
                  ["Delay ≥ 12 months", early.p_time_overrun, early.time_percentile, early.overall_rates.time_overrun,
                    early.time_overrun_actual, early.delay_months > 0 ? `report: ${Math.round(early.delay_months)} months late` : "report: not late", "time_overrun"],
                ] as const
              ).map(([label, prob, pctile, base, actual, actualText, key]) => (
                <div key={key} className="border border-border bg-surface/30 p-5">
                  <div className="flex items-baseline justify-between">
                    <span className="label-xs">{label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{early.best_models[key]}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="font-display text-4xl font-extrabold tabular-nums">{Math.round(prob * 100)}%</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      riskier than {pctile}% of projects · base rate {Math.round(base * 100)}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 w-full bg-border">
                    <div
                      className={`h-full rounded-r-[4px] ${prob >= 0.6 ? "bg-red-400" : prob >= 0.35 ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.max(2, prob * 100)}%` }}
                    />
                  </div>
                  <div className="mt-3 font-mono text-[11px]">
                    <span className={actual ? "text-red-400" : "text-emerald-400"}>
                      {actual ? "It did overrun" : "No overrun yet"}
                    </span>
                    <span className="text-muted-foreground"> · {actualText}</span>
                  </div>
                </div>
              ))}
              {early.watchlist && (
                <div className="border-l-2 border-sky-400 bg-sky-500/10 p-3 font-mono text-[11px] text-sky-400">
                  On the early-warning watchlist: high predicted risk for an overrun the report doesn't show yet.
                </div>
              )}
            </div>

            <div className="border border-border bg-surface/30 p-5 md:col-span-7">
              <div className="label-xs">Why — how often similar projects overran</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                For each input the model uses, the group this project falls in and that group's overrun rate across
                all {"1,392"} projects in the report.
              </p>
              <table className="mt-4 w-full font-mono text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-medium">Input</th>
                    <th className="py-2 text-left font-medium">This project</th>
                    <th className="py-2 text-right font-medium">Cost overrun</th>
                    <th className="py-2 text-right font-medium">Delay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {early.why.map((w) => (
                    <tr key={w.feature}>
                      <td className="py-2 text-muted-foreground">{w.label}</td>
                      <td className="py-2 text-foreground/90">
                        {w.value}
                        {w.group !== w.value && <span className="text-muted-foreground"> · {w.group}</span>}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${w.cost_rate > early.overall_rates.cost_overrun * 1.2 ? "text-red-400" : ""}`}>
                        {Math.round(w.cost_rate * 100)}%
                      </td>
                      <td className={`py-2 text-right tabular-nums ${w.time_rate > early.overall_rates.time_overrun * 1.2 ? "text-red-400" : ""}`}>
                        {Math.round(w.time_rate * 100)}%
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border">
                    <td className="py-2 text-muted-foreground" colSpan={2}>All projects</td>
                    <td className="py-2 text-right tabular-nums">{Math.round(early.overall_rates.cost_overrun * 100)}%</td>
                    <td className="py-2 text-right tabular-nums">{Math.round(early.overall_rates.time_overrun * 100)}%</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{early.note}</p>
            </div>
          </div>
        ) : (
          !errors.early && <div className="mt-6 font-mono text-xs text-muted-foreground">Loading…</div>
        )}
      </section>

      {/* 04. Site imagery + change detection */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 04 · Site Imagery</div>
            <h2 className="mt-3 text-2xl">Before / After Change Detection</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">
              {satAnalysis?.image_source || "Cached site imagery"}
            </span>
            {site && (
              <a
                href={satAnalysis?.copernicus_browser_url || `https://browser.dataspace.copernicus.eu/?zoom=${site.zoom}&lat=${site.lat.toFixed(5)}&lng=${site.lng.toFixed(5)}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-foreground bg-foreground text-background hover:bg-transparent hover:text-foreground px-3 py-1 font-mono text-xs uppercase tracking-wider transition inline-flex items-center gap-1.5 font-bold"
              >
                <span>Open in Copernicus Data Space</span>
                <span>↗</span>
              </a>
            )}
          </div>
        </div>

        {errors.imagery && <LoadError what="site imagery" error={errors.imagery} />}

        {p.evidenceRoute === "field_photo" && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-l-2 border-sky-400 bg-sky-500/10 p-4">
            <div className="max-w-3xl">
              <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-sky-400">
                Satellite can't verify this project · routed to field photos
              </div>
              <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                {p.evidenceReason} So Axiom doesn't measure change here; a geotagged site photo that passes the
                location and time checks is the required evidence for this project.
              </p>
            </div>
            <a
              href="#field-photo"
              className="border border-sky-400 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-400 hover:bg-sky-400 hover:text-background"
            >
              {fromPhoto ? "Photo evidence on file ↓" : "Upload site photo ↓"}
            </a>
          </div>
        )}

        {site ? (
          <>
            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <SatFrame
                site={site}
                imageUrl={satelliteImageUrl(satAnalysis?.before_image_path)}
                variant="before"
                label="Before"
                date={satAnalysis?.before_date || site.beforeDate}
                alt={`Earlier image of the ${p.name} site area`}
              />
              <SatFrame
                site={site}
                imageUrl={satelliteImageUrl(satAnalysis?.after_image_path)}
                variant="after"
                label="After"
                date={satAnalysis?.after_date || site.afterDate}
                changeBox={satAnalysis?.detected_change_box}
                siteSpecific={satAnalysis?.site_change ? satAnalysis.site_change.evidence_level !== "none" : true}
                alt={`Later image of the ${p.name} site area`}
              />
            </div>

            {satAnalysis?.site_change && <SiteChangePanel sc={satAnalysis.site_change} />}
            <p className="mt-4 max-w-3xl font-mono text-[11px] leading-relaxed text-muted-foreground">
              {site.aoi === null
                ? "The project's structure can't be identified in these images (e.g. work in tunnels, or not yet visible at this resolution), so no site area is drawn and no change is measured — the images are shown for location context only. "
                : satAnalysis?.detected_change_box
                ? "The box is computed from these two images — a grayscale pixel difference over a 24×24 grid, taking the largest connected cluster of change — searched only inside the site area, so a river elsewhere in frame can't be mistaken for construction. The evidence reading above says whether that change stands out from the surroundings at all. "
                : "No localised change was detected inside the site area for this pair. "}
              Image capture source and dates are still being confirmed, so these are not labelled Sentinel-2; the
              Copernicus link opens the real Sentinel-2 archive for this location.
              {satAnalysis?.cloud_cover_after != null && ` Cloud cover: ${satAnalysis.cloud_cover_after}%.`}
            </p>
          </>
        ) : (
          <p className="mt-6 font-mono text-[12px] text-muted-foreground">
            No site area registered for this record yet.
          </p>
        )}
      </section>

      {/* 05. Field-Photo Verification (YOLOv8) */}
      <section id="field-photo" className="scroll-mt-20 border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 05 · Ground Truth Field Photography</div>
            <h2 className="mt-3 text-2xl">Site-Photo Verification (YOLOv8)</h2>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            {p.evidenceRoute === "field_photo" && (
              <span
                className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                  fromPhoto
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-sky-500/40 bg-sky-500/10 text-sky-400"
                }`}
              >
                {fromPhoto ? "Required evidence · on file" : "Required evidence for this project"}
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground">Team-trained YOLOv8 classifier</span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-12">
          <div className="md:col-span-5 space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Upload a site photograph. The backend first checks <strong>where and when</strong> it was taken (GPS
              and capture time in the file) and whether it's a repeat upload, then runs the team's{" "}
              <strong>YOLOv8</strong> classifier. Only a photo that passes can replace the verified figure and move the
              risk score.
            </p>
            <div className="border border-dashed border-border p-6 text-center hover:bg-surface/50 transition">
              {photoPreview && (
                <div className="mb-4">
                  <img
                    src={photoPreview}
                    alt="Uploaded inspection site"
                    className="mx-auto max-h-48 rounded border border-border object-cover"
                  />
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    Uploaded site photograph
                  </p>
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                disabled={uploading}
                id="photo-upload"
                className="hidden"
              />
              <label
                htmlFor="photo-upload"
                className="cursor-pointer inline-block border border-foreground px-4 py-2 font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background"
              >
                {uploading ? "Running YOLOv8 Model..." : photoPreview ? "Upload Different Photo" : "Select Site Photo to Verify"}
              </label>
              <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                JPG or PNG
              </div>
            </div>

            {photoError && (
              <div className="border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400 font-mono">
                {photoError}
              </div>
            )}
          </div>

          <div className="md:col-span-7">
            {photoResult ? (
              <div className="border border-border p-5 bg-surface/30 space-y-4">
                {photoResult.integrity && (
                  <IntegrityPanel integrity={photoResult.integrity} updated={!!photoResult.project_updated} />
                )}
                <div className="flex items-center justify-between">
                  <div className="label-xs">YOLOv8 Vision Inference Result</div>
                  <span className={`font-mono text-xs uppercase px-2 py-0.5 border ${
                    photoResult.label === "completed"
                      ? "text-green-400 border-green-500/40 bg-green-500/10"
                      : "text-yellow-400 border-yellow-500/40 bg-yellow-500/10"
                  }`}>
                    {photoResult.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 border-y border-border py-3">
                  <div>
                    <div className="label-xs">Model Confidence</div>
                    <div className="font-display text-xl font-bold">
                      {(photoResult.confidence * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="label-xs">Verified Progress</div>
                    <div className="font-display text-xl font-bold">
                      {photoResult.photo_verified_estimate != null ? `${photoResult.photo_verified_estimate.toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="label-xs">Photo Gap</div>
                    <div className="font-display text-xl font-bold">
                      {photoResult.photo_gap != null ? `${photoResult.photo_gap.toFixed(1)} pts` : "—"}
                    </div>
                  </div>
                </div>

                {photoResult.heuristic_notes && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {photoResult.heuristic_notes}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                  <div>
                    Mode: <strong>{photoResult.classifier_mode}</strong>
                  </div>
                  <div>
                    Source: <span className="text-foreground">{photoResult.data_source || "—"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-border p-8 text-center font-mono text-xs text-muted-foreground flex flex-col items-center justify-center min-h-[220px] space-y-2">
                <div>No field photos verified in this session yet.</div>
                <div className="text-[11px] text-muted-foreground/70">
                  Upload a site photo to run the YOLOv8 classifier and replace the illustrative verified figure.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 06. Linear Asset Sensor Telemetry & Anomaly Detection */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 06 · Structural Telemetry</div>
            <h2 className="mt-3 text-2xl">Sensor Health & Anomaly Scoring</h2>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 font-mono text-[11px] text-muted-foreground">
            <StatusPill status="simulated">simulated telemetry</StatusPill>
            <span>Asset ID: {assetId}</span>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          No sensors are installed on these sites. The readings are generated from this project's real delay, budget
          and schedule figures to show how a sensor feed would feed the score (10% weight).
          {assetHealth?.simulated_scenario && (
            <strong className="text-amber-400"> A “{assetHealth.simulated_scenario.replace(/_/g, " ")}” scenario is currently injected.</strong>
          )}
        </p>
        {errors.telemetry && <LoadError what="telemetry" error={errors.telemetry} />}

        {assetHealth ? (
          <div className="mt-8 space-y-6">
            <div className="grid grid-cols-2 border border-border md:grid-cols-5">
              <div className="border-r border-border p-4">
                <div className="label-xs">Asset Health Score</div>
                <div className="mt-2 font-display text-3xl font-bold tabular-nums">
                  {assetHealth.current_health_score.toFixed(1)}
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>
                <div className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Status: {assetHealth.status}
                </div>
              </div>

              <div className="border-r border-border p-4">
                <div className="label-xs">Track Vibration</div>
                <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                  {assetHealth.vibration_rms != null ? `${assetHealth.vibration_rms.toFixed(2)} mm/s` : "—"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Limit: 4.5 mm/s RMS (ISO 10816)
                </div>
              </div>

              <div className="border-r border-border p-4">
                <div className="label-xs">Temperature</div>
                <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                  {assetHealth.temperature_c != null ? `${assetHealth.temperature_c.toFixed(1)} °C` : "—"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Alert: &gt; 55 °C
                </div>
              </div>

              <div className="border-r border-border p-4">
                <div className="label-xs">Structural Strain</div>
                <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                  {assetHealth.strain_microstrain != null ? `${assetHealth.strain_microstrain.toFixed(0)} με` : "—"}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Limit: 800 με
                </div>
              </div>

              <div className="p-4">
                <div className="label-xs">Statistical Z-Score</div>
                <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                  {assetHealth.anomaly_z_score.toFixed(2)}σ
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  vs this asset's history
                </div>
              </div>
            </div>

            {/* Interactive Telemetry Ingestion / Hardware Simulation Buttons */}
            <div className="flex flex-wrap items-center gap-3 border border-dashed border-border p-4">
              <span className="font-mono text-xs text-muted-foreground mr-2">
                Inject a simulated scenario:
              </span>
              <button
                onClick={() => handleSimulateSensor("normal")}
                disabled={simulating}
                className="border border-border px-3 py-1.5 font-mono text-xs uppercase tracking-wider hover:border-foreground"
              >
                Reset to baseline
              </button>
              <button
                onClick={() => handleSimulateSensor("vibration_spike")}
                disabled={simulating}
                className="border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-yellow-400 hover:border-yellow-400"
              >
                Vibration Spike Anomaly
              </button>
              <button
                onClick={() => handleSimulateSensor("thermal_overload")}
                disabled={simulating}
                className="border border-orange-500/50 bg-orange-500/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-orange-400 hover:border-orange-400"
              >
                Thermal Overload
              </button>
              <button
                onClick={() => handleSimulateSensor("strain_critical")}
                disabled={simulating}
                className="border border-red-500/50 bg-red-500/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-red-400 hover:border-red-400"
              >
                Structural Strain Critical
              </button>
            </div>
          </div>
        ) : (
          !errors.telemetry && (
            <div className="mt-6 font-mono text-xs text-muted-foreground">Loading telemetry…</div>
          )
        )}
      </section>

      {/* 07. Peer Benchmarking · report-defined sector cohort */}
      {errors.benchmark && (
        <section className="border-b border-border py-12">
          <div className="label-xs">Layer 07 · Sector Benchmark</div>
          <LoadError what="the sector benchmark" error={errors.benchmark} />
        </section>
      )}
      {peerBenchmark && (
        <section className="border-b border-border py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-xs">Layer 07 · Sector Benchmark</div>
              <h2 className="mt-3 text-2xl">Against Every {peerBenchmark.sector} Project in the Report</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-semibold tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                PAIMANA {peerBenchmark.paimana_code} · {peerBenchmark.raw_sector}
              </span>
              {peerBenchmark.cross_sector_fallback && (
                <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-semibold tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  Cross-Sector Cohort (Fallback)
                </span>
              )}
              <span className="font-mono text-[11px] text-muted-foreground">
                {peerBenchmark.peer_count.toLocaleString()} comparable projects
              </span>
            </div>
          </div>

          {/* Cohort Medians vs. Target */}
          <div className="mt-8 grid grid-cols-2 border border-border md:grid-cols-4">
            <div className="border-r border-border p-5">
              <div className="label-xs">Sector</div>
              <div className="mt-2 font-mono text-sm font-bold">{peerBenchmark.sector}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">From the report's headings</div>
            </div>
            <div className="border-r border-border p-5">
              <div className="label-xs">This Project · Approved Cost</div>
              <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                ₹{peerBenchmark.target_metrics.original_cost_cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Sector Median: ₹{peerBenchmark.medians.original_cost_cr?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} cr
              </div>
            </div>
            <div className="border-r border-border p-5">
              <div className="label-xs">Cost Escalation</div>
              <div className={`mt-2 font-display text-2xl font-bold tabular-nums ${
                peerBenchmark.target_metrics.cost_escalation_pct > (peerBenchmark.medians.cost_escalation_pct ?? 0)
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}>
                {signed(peerBenchmark.target_metrics.cost_escalation_pct)}%
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Sector Median: {peerBenchmark.medians.cost_escalation_pct != null ? `${signed(peerBenchmark.medians.cost_escalation_pct)}%` : "—"}
              </div>
            </div>
            <div className="p-5">
              <div className="label-xs">Schedule Extension</div>
              <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                {peerBenchmark.target_metrics.schedule_extension_days != null
                  ? `${Math.round(peerBenchmark.target_metrics.schedule_extension_days)} days`
                  : "not revised"}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Sector median: {peerBenchmark.medians.schedule_extension_days != null
                  ? `${Math.round(peerBenchmark.medians.schedule_extension_days)} days`
                  : "—"}
              </div>
            </div>
          </div>

          {/* Quantile Risk Positioning */}
          <div className="mt-6 border border-border p-5 bg-surface/30">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="label-xs">Cost Escalation Risk Percentile</div>
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  {peerBenchmark.quantile_rank.interpretation}
                </p>
              </div>
              <div className="text-right font-mono">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Percentile</div>
                <div className={`font-display text-4xl font-extrabold tabular-nums ${
                  peerBenchmark.quantile_rank.cost_escalation_percentile >= 75
                    ? "text-red-400"
                    : peerBenchmark.quantile_rank.cost_escalation_percentile >= 50
                    ? "text-amber-400"
                    : "text-emerald-400"
                }`}>
                  {peerBenchmark.quantile_rank.cost_escalation_percentile.toFixed(0)}
                  <span className="text-base font-normal text-muted-foreground">th</span>
                </div>
              </div>
            </div>
            {/* Percentile track */}
            <div className="mt-4 relative h-2 w-full rounded-full bg-border overflow-hidden">
              <div
                className={`absolute left-0 top-0 h-full rounded-full ${
                  peerBenchmark.quantile_rank.cost_escalation_percentile >= 75
                    ? "bg-red-500"
                    : peerBenchmark.quantile_rank.cost_escalation_percentile >= 50
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${peerBenchmark.quantile_rank.cost_escalation_percentile}%` }}
              />
            </div>
          </div>

          {/* Nearest Peers Table */}
          {peerBenchmark.peers.length > 0 && (
            <div className="mt-6">
              <div className="label-xs mb-3">Nearest by original cost · same sector, PAIMANA Dec 2025</div>
              <div className="overflow-x-auto border border-border">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface/60">
                      <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">Project ID</th>
                      <th className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Approved Cost (cr)</th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Escalation %</th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Schedule Ext.</th>
                      <th className="px-4 py-2.5 text-right text-[10px] uppercase tracking-wider text-muted-foreground">Report row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerBenchmark.peers.map((peer, i) => (
                      <tr key={peer.project_code} className={`border-b border-border/60 ${i % 2 === 0 ? "" : "bg-surface/20"}`}>
                        <td className="px-4 py-2.5 text-muted-foreground">{peer.project_code}</td>
                        <td className="px-4 py-2.5 max-w-[260px] truncate" title={peer.project_name}>{peer.project_name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {peer.original_cost_cr != null ? `₹${peer.original_cost_cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${peer.cost_escalation_pct > 20 ? "text-amber-400" : ""}`}>
                          {signed(peer.cost_escalation_pct)}%
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {peer.schedule_extension_days != null ? `${Math.round(peer.schedule_extension_days)}d` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <a
                            href={reportRowUrl(peer.project_code, peer.source_page, true)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-muted-foreground hover:text-foreground"
                          >
                            p. {peer.source_page} ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Verbatim Disclosure */}
          <div className="mt-6 border border-dashed border-border p-4 font-mono text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Data Disclosure: </span>
            {peerBenchmark.disclosure}
          </div>
        </section>
      )}

      {/* 08. Edition History */}
      {errors.history && (
        <section className="border-b border-border py-12">
          <div className="label-xs">Layer 08 · Edition History</div>
          <LoadError what="the edition history" error={errors.history} />
        </section>
      )}
      {historyData && (
        <section className="border-b border-border py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-xs">Layer 08 · Edition History</div>
              <h2 className="mt-3 text-2xl">This Project in Each PAIMANA Edition</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-semibold tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {historyData.editions_loaded.length} edition{historyData.editions_loaded.length === 1 ? "" : "s"} loaded
              </span>
              {historyData.date_range && historyData.snapshot_count > 1 && (
                <span className="text-muted-foreground">
                  {historyData.date_range.earliest} → {historyData.date_range.latest}
                </span>
              )}
            </div>
          </div>

          {historyData.no_historical_match || historyData.snapshots.length === 0 ? (
            <div className="mt-8 border border-border bg-surface/30 p-6 text-xs leading-relaxed text-muted-foreground">
              This project doesn't appear in the {historyData.editions_loaded.join(", ")} edition(s) loaded.
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              {historyData.snapshots.length === 1 && (
                <div className="border border-dashed border-border p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  One edition is loaded ({historyData.snapshots[0]?.snapshot_date}), so this shows a single snapshot — the
                  project exactly as printed in that report. Drop earlier monthly PAIMANA flash reports into
                  data/paimana and re-run scripts/extract_paimana_dataset.py, and this becomes a month-by-month history.
                </div>
              )}
              {/* Interactive Timeline Scrubber */}
              {historyData.snapshots.length > 1 && (
              <div className="border border-border bg-surface/40 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wider text-[10px] block">
                      Timeline Scrub Controller
                    </span>
                    <strong className="text-base text-foreground font-mono">
                      Cycle Snapshot: {historyData.snapshots[selectedSnapshotIdx]?.snapshot_date}
                    </strong>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedSnapshotIdx((prev) => Math.max(0, prev - 1))}
                      disabled={selectedSnapshotIdx === 0}
                      className="border border-border px-3 py-1 uppercase text-[10px] tracking-wider hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      ◀ Prev Month
                    </button>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {selectedSnapshotIdx + 1} / {historyData.snapshots.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedSnapshotIdx((prev) => Math.min(historyData.snapshots.length - 1, prev + 1))}
                      disabled={selectedSnapshotIdx === historyData.snapshots.length - 1}
                      className="border border-border px-3 py-1 uppercase text-[10px] tracking-wider hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      Next Month ▶
                    </button>
                  </div>
                </div>

                {/* Range Slider */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min={0}
                    max={historyData.snapshots.length - 1}
                    value={selectedSnapshotIdx}
                    onChange={(e) => setSelectedSnapshotIdx(Number(e.target.value))}
                    className="w-full accent-foreground cursor-pointer h-2 bg-border rounded-lg"
                  />
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{historyData.date_range?.earliest}</span>
                    <span>{historyData.date_range?.latest}</span>
                  </div>
                </div>
              </div>
              )}

              {/* Selected Snapshot Telemetry Card */}
              {historyData.snapshots[selectedSnapshotIdx] && (
                (() => {
                  const snap = historyData.snapshots[selectedSnapshotIdx];
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 border border-border divide-y md:divide-y-0 md:divide-x divide-border bg-surface/30">
                      <div className="p-5">
                        <div className="label-xs">Sanctioned vs Revised Cost</div>
                        <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                          ₹{(snap.revised_cost_cr ?? snap.approved_cost_cr ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Orig: ₹{(snap.approved_cost_cr ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr
                          {snap.cost_escalation_pct != null && (
                            <span className={`ml-2 font-bold ${snap.cost_escalation_pct > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                              {signed(snap.cost_escalation_pct)}%
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="label-xs">Cumulative Expenditure</div>
                        <div className="mt-2 font-display text-2xl font-bold tabular-nums">
                          {snap.cumulative_expenditure_cr != null
                            ? `₹${snap.cumulative_expenditure_cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`
                            : "—"}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Financial Progress: {snap.financial_progress_pct != null ? `${snap.financial_progress_pct.toFixed(1)}%` : "—"}
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="label-xs">Physical Progress</div>
                        <div className="mt-2 font-display text-2xl font-bold tabular-nums text-foreground">
                          {snap.physical_progress_pct != null ? `${snap.physical_progress_pct.toFixed(1)}%` : "—"}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {snap.schedule_status || "—"}
                        </div>
                      </div>

                      <div className="p-5">
                        <div className="label-xs">Target Completion Date</div>
                        <div className="mt-2 font-mono text-base font-bold tabular-nums">
                          {snap.revised_completion_date || snap.planned_completion_date || "—"}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                          Original Target: {snap.planned_completion_date || "—"}
                        </div>
                        {snap.snapshot_date === p.reportMonth && (
                          <div className="mt-3">
                            <a
                              href={sourcePageUrl(p.id, true)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[10px] text-foreground underline hover:text-muted-foreground"
                            >
                              Report page {snap.source_page} ↗
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Condensed Longitudinal Observation Trail */}
              {historyData.snapshots.length > 1 && (
              <div className="border border-border">
                <div className="bg-surface/60 px-4 py-2.5 border-b border-border flex items-center justify-between">
                  <span className="label-xs">Chronological Monthly Snapshot Observations</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Showing latest 8 snapshots in trajectory
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface/30">
                        <th className="px-4 py-2 text-left text-[10px] uppercase text-muted-foreground">Snapshot Date</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Revised Cost (cr)</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Expenditure (cr)</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Physical %</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Target Date</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.snapshots.slice(-8).map((snap) => {
                        const originalIdx = historyData.snapshots.findIndex((s) => s.snapshot_date === snap.snapshot_date);
                        const isCurrent = originalIdx === selectedSnapshotIdx;
                        return (
                          <tr
                            key={snap.snapshot_date}
                            className={`border-b border-border/60 cursor-pointer transition-colors ${
                              isCurrent ? "bg-foreground/10 font-bold" : "hover:bg-surface/40"
                            }`}
                            onClick={() => setSelectedSnapshotIdx(originalIdx)}
                          >
                            <td className="px-4 py-2 text-foreground">
                              {snap.snapshot_date} {isCurrent && "◀ active"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {snap.revised_cost_cr != null ? `₹${snap.revised_cost_cr.toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {snap.cumulative_expenditure_cr != null ? `₹${snap.cumulative_expenditure_cr.toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {snap.physical_progress_pct != null ? `${snap.physical_progress_pct.toFixed(1)}%` : "—"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                              {snap.revised_completion_date || snap.planned_completion_date || "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSnapshotIdx(originalIdx);
                                }}
                                className="text-[10px] uppercase underline text-muted-foreground hover:text-foreground"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )}

          {/* Verbatim Disclosure Note */}
          <div className="mt-6 border border-dashed border-border p-4 font-mono text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Data Disclosure: </span>
            {historyData.disclosure}
          </div>
        </section>
      )}

      {/* 09. What-If Explorer */}
      {errors.scenario && (
        <section className="border-b border-border py-12">
          <div className="label-xs">Layer 09 · What-If Explorer</div>
          <LoadError what="the what-if explorer" error={errors.scenario} />
        </section>
      )}
      {scenarioData && (
        <section className="border-b border-border py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-xs">Layer 09 · What-If Explorer</div>
              <h2 className="mt-3 text-2xl">How Much Does Verification Change the Score?</h2>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-semibold tracking-wider bg-surface border border-border text-foreground">
                Transparent formula, re-run with your inputs
              </span>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Interactive Intervention Controls */}
            <div className="lg:col-span-5 border border-border p-5 bg-surface/40 space-y-5">
              <div className="border-b border-border pb-3">
                <span className="label-xs">Intervention Parameters</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try raising the reported figure alone, then the verified figure: over-reporting lowers the
                  schedule penalty, and verification is what claws it back.
                </p>
              </div>

              {/* Slider 1: Physical Progress % */}
              <div className="space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase text-[10px]">Reported Progress</span>
                  <strong className="text-foreground">{simProgress.toFixed(1)}%</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={simProgress}
                  onChange={(e) => setSimProgress(Number(e.target.value))}
                  className="w-full accent-foreground cursor-pointer h-2 bg-border rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0%</span>
                  <span>Baseline: {p.reportedProgress}%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Slider 2: Expenditure (cr) */}
              <div className="space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase text-[10px]">Simulated Expenditure</span>
                  <strong className="text-foreground">₹{simExpenditure.toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.round((p.revisedCost || p.sanctionedCost) * 1.5)}
                  step={10}
                  value={simExpenditure}
                  onChange={(e) => setSimExpenditure(Number(e.target.value))}
                  className="w-full accent-foreground cursor-pointer h-2 bg-border rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>₹0 cr</span>
                  <span>Revised cost: ₹{inrCrore(p.revisedCost || p.sanctionedCost)} cr</span>
                  <span>₹{inrCrore(Math.round((p.revisedCost || p.sanctionedCost) * 1.5))} cr</span>
                </div>
              </div>

              {/* Slider 3: Verified Progress % */}
              <div className="space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground uppercase text-[10px]">Verified Progress</span>
                  <strong className="text-foreground">{simVerified.toFixed(1)}%</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.5}
                  value={simVerified}
                  onChange={(e) => setSimVerified(Number(e.target.value))}
                  className="w-full accent-foreground cursor-pointer h-2 bg-border rounded-lg"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0%</span>
                  <span>Baseline: {p.verifiedProgress}%{fromPhoto ? "" : " (illustrative)"}</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap gap-3 font-mono text-xs">
                <button
                  type="button"
                  onClick={handleApplySimulation}
                  disabled={simRunning}
                  className="flex-1 border border-foreground bg-foreground text-background px-4 py-2 uppercase tracking-wider font-bold hover:bg-foreground/90 disabled:opacity-50"
                >
                  {simRunning ? "Simulating..." : "Run Simulation ▶"}
                </button>
                <button
                  type="button"
                  onClick={handleResetSimulation}
                  disabled={simRunning}
                  className="border border-border px-4 py-2 uppercase tracking-wider hover:bg-surface disabled:opacity-50 text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Simulation Results & Trajectory Shift */}
            <div className="lg:col-span-7 space-y-4">
              {/* Top Shift Comparison Bar */}
              <div className="grid grid-cols-2 md:grid-cols-3 border border-border divide-y md:divide-y-0 md:divide-x divide-border bg-surface/30">
                <div className="p-4 font-mono">
                  <span className="label-xs">Risk Score Shift</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-display font-bold tabular-nums">
                      {scenarioData.scenario.risk_score}
                    </span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                    <span className={`ml-auto text-sm font-bold ${
                      scenarioData.delta.risk_score_delta < 0
                        ? "text-emerald-400"
                        : scenarioData.delta.risk_score_delta > 0
                        ? "text-red-400"
                        : "text-muted-foreground"
                    }`}>
                      {scenarioData.delta.risk_score_delta > 0 ? `+${scenarioData.delta.risk_score_delta}` : scenarioData.delta.risk_score_delta} pts
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Baseline: {scenarioData.baseline.risk_score} / 100
                  </div>
                </div>

                <div className="p-4 font-mono">
                  <span className="label-xs">Status Transition</span>
                  <div className="mt-2 text-base font-bold capitalize">
                    {scenarioData.delta.status_transition}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground uppercase">
                    Risk Level: {scenarioData.delta.risk_level_transition}
                  </div>
                </div>

                <div className="p-4 font-mono col-span-2 md:col-span-1">
                  <span className="label-xs">Early-warning model</span>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Unchanged: it predicts from approval-time facts only, so reported progress or spending can't move
                    it (see Layer 03).
                  </p>
                </div>
              </div>

              {/* Factor Contribution Comparison Table */}
              <div className="border border-border">
                <div className="bg-surface/60 px-4 py-2.5 border-b border-border flex items-center justify-between font-mono">
                  <span className="label-xs">5-Factor Risk Weight Sensitivity Diff</span>
                  <span className="text-[10px] text-muted-foreground">
                    Simulated vs. Baseline Factor Contributions
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface/30">
                        <th className="px-4 py-2 text-left text-[10px] uppercase text-muted-foreground">Risk Factor</th>
                        <th className="px-4 py-2 text-center text-[10px] uppercase text-muted-foreground">Weight</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Baseline Score</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Scenario Score</th>
                        <th className="px-4 py-2 text-right text-[10px] uppercase text-muted-foreground">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(scenarioData.baseline.factors).map((factorKey) => {
                        const baseFactor = scenarioData.baseline.factors[factorKey];
                        const simFactor = scenarioData.scenario.factors[factorKey];
                        if (!baseFactor || !simFactor) return null;
                        const diff = Number((simFactor.contribution - baseFactor.contribution).toFixed(1));
                        const labelMap: Record<string, string> = {
                          budget_variance: "Budget Variance",
                          schedule_slippage: "Schedule Slippage",
                          visual_discrepancy: "Reported-vs-Verified Gap",
                          sensor_anomaly: "Sensor Anomaly",
                          rainfall_exposure: "Rainfall Exposure",
                        };
                        return (
                          <tr key={factorKey} className="border-b border-border/60">
                            <td className="px-4 py-2 font-medium">{labelMap[factorKey] || factorKey}</td>
                            <td className="px-4 py-2 text-center text-muted-foreground">{(baseFactor.weight * 100).toFixed(0)}%</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{baseFactor.score.toFixed(0)}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-bold">{simFactor.score.toFixed(0)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <span className={diff < 0 ? "text-emerald-400" : diff > 0 ? "text-red-400" : "text-muted-foreground"}>
                                {diff > 0 ? `+${diff}` : diff} pts
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Verbatim Disclosure Note */}
          <div className="mt-6 border border-dashed border-border p-4 font-mono text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-bold text-foreground">Data Disclosure: </span>
            {scenarioData.disclosure}
          </div>
        </section>
      )}

      {/* 10. Escalation (simulated) */}
      <section className="border-b border-border py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-xs">Layer 10 · Escalation</div>
            <h2 className="mt-3 text-2xl">Request Clarification from the Agency</h2>
          </div>
          <StatusPill status="simulated">simulated · nothing is sent</StatusPill>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isRedFlag || p.riskLevel === "high"
              ? "This project is flagged. Draft the clarification request Axiom would send to the implementing agency named in the report."
              : "Not currently flagged — you can still draft a clarification request."}
          </p>
          <button
            type="button"
            onClick={handleEscalate}
            disabled={drafting}
            className="border border-foreground bg-foreground px-4 py-2 font-mono text-xs uppercase tracking-wider text-background hover:bg-transparent hover:text-foreground disabled:opacity-50"
          >
            {drafting ? "Drafting…" : notice ? "Draft again" : "Draft escalation notice"}
          </button>
        </div>
        {errors.escalation && <LoadError what="the escalation draft" error={errors.escalation} />}
        {notice && (
          <div className="mt-6 border border-dashed border-border bg-surface/30 p-5 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status="simulated">simulated · not sent</StatusPill>
              <span className="text-muted-foreground">{notice.reference} · {notice.drafted_at}</span>
            </div>
            <dl className="mt-4 grid grid-cols-[70px_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">To</dt><dd>{notice.to}</dd>
              <dt className="text-muted-foreground">Cc</dt><dd>{notice.cc}</dd>
              <dt className="text-muted-foreground">Subject</dt><dd className="font-sans text-[13px]">{notice.subject}</dd>
            </dl>
            <ul className="mt-4 list-disc space-y-1 pl-5 font-sans text-[13px] leading-relaxed">
              {notice.findings.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <p className="mt-4 font-sans text-[13px]">{notice.requested_action}</p>
            <p className="mt-3 text-[11px] text-muted-foreground">{notice.note}</p>
          </div>
        )}
      </section>

      {/* Progress Signals Meter */}
      <section className="py-12">
        <h2 className="text-2xl">Progress Summary</h2>
        <div className="mt-6 max-w-xl space-y-5">
          <div className="flex items-center justify-between gap-6">
            <span className="label-xs">Reported on Paper</span>
            <Meter value={p.reportedProgress} />
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="label-xs">{fromPhoto ? "Photo Verified" : "Verified (illustrative)"}</span>
            <Meter value={p.verifiedProgress} />
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="label-xs">Verification Gap</span>
            <GapBar gap={gap} />
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-border pt-5">
            <span className="label-xs">{fromPhoto ? "Photo Verified On" : "Latest Site Imagery"}</span>
            <span className="font-mono text-[12px] tabular-nums">
              {p.lastVerified || "—"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

const EVIDENCE_STYLE: Record<SiteChange["evidence_level"], string> = {
  strong: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  weak: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  none: "text-muted-foreground border-border bg-surface",
};

/** Measured site-vs-surroundings change. Evidence that the site changed — never a % complete. */
function SiteChangePanel({ sc }: { sc: SiteChange }) {
  const label = { strong: "Site-specific change", weak: "Weak site-specific change", none: "No site-specific change" }[
    sc.evidence_level
  ];
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 border border-border bg-surface/30 p-5 md:grid-cols-12">
      <div className="md:col-span-5">
        <div className="flex items-center gap-2">
          <div className="label-xs">Satellite evidence</div>
          <StatusPill status="derived">measured</StatusPill>
        </div>
        <span className={`mt-3 inline-block border px-2 py-1 font-mono text-xs font-bold uppercase tracking-wider ${EVIDENCE_STYLE[sc.evidence_level]}`}>
          {label}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-foreground/90">{sc.evidence_text}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:col-span-7">
        <div>
          <div className="label-xs">Site change ÷ surroundings</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums">{sc.site_vs_surroundings_ratio.toFixed(2)}×</div>
          <div className="font-mono text-[10px] text-muted-foreground">1.00× = changed as much as the land around it</div>
        </div>
        <div>
          <div className="label-xs">Site area changed</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums">{sc.site_changed_area_pct.toFixed(1)}%</div>
          <div className="font-mono text-[10px] text-muted-foreground">above the surroundings' own noise level</div>
        </div>
        <p className="col-span-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Both images are brightness-matched first, so season and lighting that shift the whole frame cancel out.
          This shows <em>whether</em> the site changed — a pixel difference can't measure % complete, so it isn't
          used as one.
        </p>
      </div>
    </div>
  );
}

const CHECK_LABEL: Record<IntegrityCheck["key"], string> = { location: "Location", time: "Capture time", duplicate: "Duplicate" };
const CHECK_STYLE: Record<IntegrityCheck["status"], string> = {
  pass: "text-emerald-400",
  fail: "text-red-400",
  unknown: "text-amber-400",
};
const VERDICT_STYLE: Record<PhotoIntegrity["verdict"], string> = {
  verified: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  unverifiable: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  flagged: "text-red-400 border-red-500/40 bg-red-500/10",
};

/** Where/when/duplicate checks on the uploaded photo, and whether it was allowed to change the score. */
function IntegrityPanel({ integrity, updated }: { integrity: PhotoIntegrity; updated: boolean }) {
  return (
    <div className="border-b border-border pb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="label-xs">Photo integrity check</div>
        <span className={`border px-2 py-0.5 font-mono text-xs uppercase ${VERDICT_STYLE[integrity.verdict]}`}>
          {integrity.verdict}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {integrity.checks.map((c) => (
          <li key={c.key} className="grid grid-cols-[110px_60px_1fr] gap-2 font-mono text-[11px]">
            <span className="text-muted-foreground">{CHECK_LABEL[c.key]}</span>
            <span className={`uppercase ${CHECK_STYLE[c.status]}`}>{c.status === "unknown" ? "n/a" : c.status}</span>
            <span className="text-foreground/90">{c.text}</span>
          </li>
        ))}
      </ul>
      <p className={`mt-3 text-xs leading-relaxed ${integrity.verdict === "flagged" ? "text-red-400" : "text-muted-foreground"}`}>
        {integrity.summary}{" "}
        {updated ? "The verified figure and risk score were updated." : "The verified figure and risk score were not changed."}
        {integrity.camera?.startsWith("TEST") && " (Test file: its location and time were written by make_test_photos.py.)"}
      </p>
    </div>
  );
}

/** Which evidence verifies this project: satellite imagery, or (when its structure can't be seen) a site photo. */
function EvidenceTag({ route, photoDone }: { route?: EvidenceRoute | undefined; photoDone: boolean }) {
  if (!route) return null;
  const sat = route === "satellite";
  return (
    <span
      className={`font-mono text-[11px] border px-2 py-0.5 ${
        sat ? "border-border bg-surface text-muted-foreground" : "border-sky-500/40 bg-sky-500/10 text-sky-400"
      }`}
      title={sat ? "The structure is identifiable in satellite imagery" : "Not visible from satellite; a geotagged site photo is required"}
    >
      Evidence: {sat ? "satellite" : photoDone ? "field photo ✓" : "field photo required"}
    </span>
  );
}
