/**
 * Project Sentinel API Client
 * Connects the TanStack Start / React frontend to the FastAPI backend.
 *
 * There are deliberately no fallbacks to local data: if the backend can't be
 * reached, callers get an error and show it, rather than quietly rendering
 * made-up numbers.
 */

import type { ProjectRecord, SiteImagery } from "@/data/projects";

export const API_BASE: string = import.meta.env["VITE_API_URL"] || "http://localhost:8000/api";
/** The backend's origin, for static files it serves outside /api (e.g. /satellite-cache). */
export const BACKEND_ORIGIN = API_BASE.replace(/\/api\/?$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface FactorDetail {
  name: string;
  raw_value: number;
  unit: string;
  normalized_score: number;
  weight: number;
  weighted_contribution: number;
  description: string;
  data_source: string;
}

export interface DiscrepancyDetails {
  reported_progress_pct: number;
  satellite_estimated_progress_pct: number;
  photo_estimated_progress_pct: number;
  discrepancy_satellite: number;
  discrepancy_photo: number;
  combined_discrepancy: number;
  mismatch_level: "low" | "medium" | "high_red_flag";
}

export interface ShapContribution {
  feature: string;
  raw_value: number;
  shap_value: number;
  impact: string;
  importance_rank: number;
}

export interface PredictiveMlDetails {
  p_delay_over_6mo: number;
  p_cost_overrun_over_20pct: number;
  ml_risk_trend: string;
  model_type: string;
  top_contributing_factor: string;
  shap_explainability: ShapContribution[];
  source?: string;
}

export interface RiskBreakdown {
  project_id: string;
  project_name: string;
  sector: string;
  state: string;
  risk_score: number;
  risk_level: "low" | "medium" | "high";
  status: "on-track" | "delayed" | "critical";
  cluster_label?: string;
  factors: Record<string, FactorDetail>;
  discrepancy_details?: DiscrepancyDetails;
  predictive_ml?: PredictiveMlDetails;
  formula: string;
  explanation?: string;
  data_source: string;
  calculated_at: string;
}

export interface ChangeBox {
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  change_area_pct: number;
  mean_pixel_diff: number;
  method: string;
}

/** Measured: did the site area change more than the land around it? (never a % complete) */
export interface SiteChange {
  site_vs_surroundings_ratio: number;
  site_changed_area_pct: number;
  evidence_level: "strong" | "weak" | "none";
  evidence_text: string;
  method: string;
  data_source: string;
}

export interface SatelliteAnalysis {
  project_id: string;
  project_name?: string;
  image_source: string;
  before_image_path?: string;
  after_image_path?: string;
  before_date?: string;
  after_date?: string;
  cloud_cover_after?: number | null;
  copernicus_browser_url?: string;
  detected_change_box?: ChangeBox | null;
  site_change?: SiteChange | null;
}

export interface BoundingBox {
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface IntegrityCheck {
  key: "location" | "time" | "duplicate";
  status: "pass" | "fail" | "unknown";
  text: string;
}

/** Location / time / duplicate checks run on an uploaded photo before it may change a score. */
export interface PhotoIntegrity {
  verdict: "verified" | "unverifiable" | "flagged";
  summary: string;
  checks: IntegrityCheck[];
  photo_lat: number | null;
  photo_lng: number | null;
  taken_at: string | null;
  camera: string | null;
  distance_km: number | null;
  radius_km: number;
}

export interface PhotoClassification {
  project_id: string;
  filename: string;
  label: string;
  confidence: number;
  photo_verified_estimate?: number;
  completion_proxy_score?: number;
  photo_gap?: number;
  reported_progress_pct?: number;
  boxes?: BoundingBox[];
  detected_classes?: Record<string, number>;
  classifier_mode: string;
  heuristic_notes?: string;
  data_source?: string;
  timestamp: string;
  integrity?: PhotoIntegrity | null;
  project_updated?: boolean | null;
}

export interface AssetHealth {
  asset_id: string;
  project_id?: string;
  available?: boolean;
  simulated_scenario?: string | null;
  current_health_score: number;
  status: "healthy" | "warning" | "critical" | "unknown";
  vibration_rms?: number | null;
  temperature_c?: number | null;
  strain_microstrain?: number | null;
  tilt_deg?: number | null;
  anomaly_z_score: number;
  data_source?: string;
  last_updated: string;
  history: Array<{
    timestamp: string;
    health_score: number;
    status: string;
    vibration?: number;
    temperature?: number;
    strain?: number;
    tilt?: number;
    z_score: number;
  }>;
}

export interface WeatherData {
  project_id: string;
  latitude: number;
  longitude: number;
  available: boolean;
  data_source: string;
  rainfall_30d_total_mm: number;
  rainfall_7d_forecast_mm: number;
  rainfall_risk_score: number;
  readings: Array<{ date: string; rainfall_mm: number }>;
}

export interface DataQualityRule {
  key: string;
  severity: "critical" | "medium" | "low";
  label: string;
  description: string;
}

export interface DataQualityIssue {
  project_id: string;
  project_name: string;
  agency?: string;
  state?: string;
  sector?: string;
  snapshot_date?: string;
  source_page: number;
  flags: string[];
}

export interface DataQualityResponse {
  available: boolean;
  edition: string;
  rows: number;
  projects_evaluated: number;
  data_quality_score: number;
  flags: Record<string, number>;
  rules: DataQualityRule[];
  issues: DataQualityIssue[];
  note: string;
  policy: string;
  source: string;
}

export interface BenchmarkPeer {
  project_code: string;
  project_name: string;
  sector: string;
  state?: string;
  original_cost_cr: number | null;
  revised_cost_cr: number | null;
  cost_escalation_pct: number;
  schedule_extension_days: number | null;
  physical_progress_pct?: number | null;
  cost_distance: number;
  source_page: number;
}

export interface PeerBenchmarkResponse {
  project_id: string;
  paimana_code: string;
  sector: string;
  raw_sector: string | null;
  cross_sector_fallback: boolean;
  peer_count: number;
  target_metrics: {
    original_cost_cr: number;
    cost_escalation_pct: number;
    delay_months: number;
    reported_progress_pct: number;
    schedule_extension_days: number | null;
  };
  medians: {
    original_cost_cr: number | null;
    cost_escalation_pct: number | null;
    schedule_extension_days: number | null;
    financial_progress_pct: number | null;
    physical_progress_pct: number | null;
  };
  quantile_rank: { cost_escalation_percentile: number; interpretation: string };
  peers: BenchmarkPeer[];
  disclosure: string;
}

export interface HistoricalSnapshot {
  snapshot_date: string;
  approved_cost_cr: number | null;
  revised_cost_cr: number | null;
  cumulative_expenditure_cr: number | null;
  cost_escalation_pct: number | null;
  physical_progress_pct: number | null;
  financial_progress_pct: number | null;
  planned_completion_date: string | null;
  revised_completion_date: string | null;
  schedule_status: string | null;
  source_pdf?: string | null;
  source_page?: number | null;
}

export interface ProjectHistoryResponse {
  project_id: string;
  project_name: string;
  paimana_code: string | null;
  no_historical_match: boolean;
  sector: string;
  editions_loaded: string[];
  snapshot_count: number;
  date_range: { earliest: string; latest: string } | null;
  snapshots: HistoricalSnapshot[];
  disclosure: string;
}

export interface ScenarioFactorItem {
  score: number;
  weight: number;
  contribution: number;
}

export interface ScenarioMetrics {
  risk_score: number;
  risk_level: "low" | "medium" | "high";
  status: "on-track" | "delayed" | "critical";
  capital_utilisation_pct: number;
  budget_variance_pct: number;
  schedule_slippage_pts: number;
  discrepancy_pts: number;
  delay_months: number;
  factors: Record<string, ScenarioFactorItem>;
  predictive_ml: {
    p_delay_over_6mo: number;
    p_cost_overrun_over_20pct: number;
    ml_risk_trend: string;
    model_type: string;
    source: string;
  };
}

export interface ScenarioResponse {
  project_id: string;
  project_name: string;
  sector: string;
  sanctioned_cost_cr: number;
  inputs: { physical_progress_pct?: number; expenditure_cr?: number; verified_progress_pct?: number };
  baseline: ScenarioMetrics;
  scenario: ScenarioMetrics;
  delta: {
    risk_score_delta: number;
    risk_level_transition: string;
    status_transition: string;
    p_delay_delta: number;
    p_cost_delta: number;
    discrepancy_delta: number;
  };
  disclosure: string;
}

export interface EscalationNotice {
  simulated: boolean;
  sent: boolean;
  reference: string;
  drafted_at: string;
  to: string;
  cc: string;
  subject: string;
  findings: string[];
  requested_action: string;
  note: string;
}

// ── Projects ────────────────────────────────────────────────────────────────

export function getProjects(sector?: string, risk?: string): Promise<ProjectRecord[]> {
  const params = new URLSearchParams();
  if (sector && sector !== "All") params.append("sector", sector);
  if (risk && risk !== "All") params.append("risk_level", risk);
  return request<ProjectRecord[]>(`/projects?${params.toString()}`);
}

export async function getProject(id: string): Promise<{ project: ProjectRecord; site?: SiteImagery | undefined }> {
  const data = await request<ProjectRecord>(`/projects/${id}`);
  return { project: data, site: data.site };
}

export const getRiskBreakdown = (id: string) => request<RiskBreakdown>(`/projects/${id}/risk`);

export const getSatelliteChangeDetection = (id: string) =>
  request<SatelliteAnalysis>(`/satellite/${id}/change-detection`);

export const getAssetHealth = (assetId: string) => request<AssetHealth>(`/assets/${assetId}/health`);

export const getWeather = (id: string) => request<WeatherData>(`/weather/${id}`);

export async function classifySitePhoto(file: File, projectId: string, updateProject = false) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("project_id", projectId);
  formData.append("update_project", String(updateProject));
  return request<PhotoClassification>(`/photos/classify`, { method: "POST", body: formData });
}

/** Simulated: injects a scenario reading on top of simulated telemetry ("normal" clears it). */
export const simulateTelemetryScenario = (
  assetId: string,
  scenario: "normal" | "vibration_spike" | "thermal_overload" | "strain_critical",
) => request(`/sensors/simulate/${assetId}?scenario=${scenario}`, { method: "POST" });

/** Simulated: drafts the notice to the implementing agency; nothing is sent or stored. */
export const escalateProject = (id: string) =>
  request<EscalationNotice>(`/projects/${id}/escalate`, { method: "POST" });

// ── Traceability ────────────────────────────────────────────────────────────

/** The project's PAIMANA report row, highlighted (excerpt, or the full page). */
export const sourcePageUrl = (id: string, full = false) =>
  `${API_BASE}/projects/${id}/source-page${full ? "?full=1" : ""}`;

/** Any report row by PAIMANA code and page (used for data-quality issues and peers). */
export const reportRowUrl = (code: string, page: number, full = false) =>
  `${API_BASE}/paimana/page/${page}?code=${code}${full ? "&full=1" : ""}`;

/** Cached site imagery is served by the backend at /satellite-cache/<file>. */
export function satelliteImageUrl(path?: string | null): string | null {
  if (!path) return null;
  const file = path.split(/[/\\]/).pop();
  return `${BACKEND_ORIGIN}/satellite-cache/${file}`;
}

// ── Report-wide insights ────────────────────────────────────────────────────

export const getDataQuality = () => request<DataQualityResponse>(`/data-quality`);

export const getPeerBenchmark = (projectId: string, limit = 6) =>
  request<PeerBenchmarkResponse>(`/benchmark/${projectId}?limit=${limit}`);

export const getProjectHistory = (projectId: string) =>
  request<ProjectHistoryResponse>(`/history/${projectId}`);

export const runScenarioSimulation = (payload: {
  project_id: string;
  physical_progress_pct?: number;
  expenditure_cr?: number;
  verified_progress_pct?: number;
}) =>
  request<ScenarioResponse>(`/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const getScenarioBaseline = (projectId: string) =>
  request<ScenarioResponse>(`/scenario/${projectId}`);

// ── The whole report, browsable ─────────────────────────────────────────────

export interface ReportProject {
  project_code: string;
  name: string | null;
  agency: string | null;
  ministry: string | null;
  sector: string | null;
  state: string | null;
  start_date: string | null;
  original_completion: string | null;
  revised_completion: string | null;
  original_cost_cr: number | null;
  revised_cost_cr: number | null;
  expenditure_cr: number | null;
  physical_progress_pct: number | null;
  cost_escalation_pct: number;
  source_page: number | null;
  flags: string[];
  /** Set for the projects with full evidence layers. */
  case_study_id: string | null;
}

export interface ReportProjectsResponse {
  edition: string;
  total_in_report: number;
  matched: number;
  page: number;
  page_size: number;
  pages: number;
  projects: ReportProject[];
  facets: {
    sectors: [string, number][];
    ministries: [string, number][];
    flags: { key: string; label: string; severity: "critical" | "medium" | "low" }[];
  };
  case_study_count: number;
  source: string;
}

export interface ReportQuery {
  q?: string;
  sector?: string;
  ministry?: string;
  flag?: string;
  case_studies?: boolean;
  sort?: "cost" | "escalation" | "progress" | "name";
  page?: number;
}

export function getReportProjects(query: ReportQuery = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && v !== false) params.set(k, String(v));
  }
  return request<ReportProjectsResponse>(`/paimana/projects?${params.toString()}`);
}
