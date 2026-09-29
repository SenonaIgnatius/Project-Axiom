/**
 * Typed schema for Axiom monitoring records.
 *
 * There is no mock data in this file any more. Every record comes from the
 * FastAPI backend, whose "reported" figures are extracted row-by-row from the
 * MoSPI PAIMANA flash report (December 2025) and link back to their PDF page.
 */

export type Sector = "Roads" | "Railways" | "Power" | "Water";
export type RiskLevel = "low" | "medium" | "high";
export type ProjectStatus = "on-track" | "delayed" | "critical";
/** Where the "verified" figure comes from: a real site photo, or a labelled stand-in. */
export type VerifiedBasis = "photo" | "illustrative";

export interface SiteImagery {
  id?: string;
  lat: number;
  lng: number;
  zoom: number;
  satVerified: boolean;
  beforeDate: string;
  afterDate: string;
  changeDetected: number;
  ndbiDelta?: number;
  /** Site area of interest, set by the team: [x1, y1, x2, y2] as % of the frame */
  /** Project's structure in the image, % of frame; null = not identifiable in this image. */
  aoi: [number, number, number, number] | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  sector: Sector;
  state: string;
  reportMonth?: string;
  /** Revised (current) sanctioned cost, INR crore */
  sanctionedCost: number;
  originalCost?: number;
  revisedCost?: number;
  /** Cumulative expenditure, INR crore */
  expenditure: number;
  /** Physical progress as printed in the PAIMANA report, % */
  reportedProgress: number;
  /** Verified progress, % — see verifiedBasis */
  verifiedProgress: number;
  verifiedBasis?: VerifiedBasis;
  combinedDiscrepancy?: number;
  mismatchRedFlag?: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  status: ProjectStatus;
  /** Revised completion date minus original, in months */
  delayMonths: number;
  startDate?: string;
  expectedEndDate?: string;
  revisedEndDate?: string;
  lastVerified?: string;
  budgetVariancePct?: number;
  scheduleSlippage?: number;
  clusterLabel?: string;
  dataSource?: string;
  // Traceability back to the PAIMANA flash report
  projectCode?: string;
  officialName?: string;
  agency?: string;
  reportState?: string;
  sourcePage?: number;
  alsoOnPages?: number[];
  reportNote?: string;
  /** Which independent evidence can verify this project: its structure is visible in satellite imagery, or it isn't (tunnels, thin lines, dense city) and needs a geotagged site photo. */
  evidenceRoute?: EvidenceRoute;
  evidenceReason?: string | null;
  site?: SiteImagery;
}

export type EvidenceRoute = "satellite" | "field_photo";

export const progressGap = (p: ProjectRecord) =>
  Number((p.reportedProgress - p.verifiedProgress).toFixed(1));

export const inrCrore = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** ₹1,39,000 cr reads better as ₹1.39 lakh cr once it is that large. */
export const inrCompact = (n: number) =>
  Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(2)} lakh cr` : `₹${inrCrore(n)} cr`;

/** The review threshold used everywhere a reported-vs-verified gap is judged. */
export const GAP_THRESHOLD = 12;

export type ModuleStatus = "real" | "derived" | "simulated" | "illustrative" | "demonstration";

export interface Module {
  code: string;
  name: string;
  status: ModuleStatus;
  summary: string;
  inputs: string;
  output: string;
}

/** What Axiom actually does today — each module's status is stated, not implied. */
export const MODULES: Module[] = [
  {
    code: "M-01",
    name: "PAIMANA Report Extraction",
    status: "real",
    summary:
      "Reads every row of the MoSPI PAIMANA flash report's project tables — all 1,392 ongoing projects, matching the report's own sector totals — and keeps the page each figure came from.",
    inputs: "MoSPI PAIMANA flash report PDF (December 2025)",
    output: "Cost, expenditure, progress and dates per project, each linked to its PDF page and row",
  },
  {
    code: "M-02",
    name: "Transparent Risk Formula",
    status: "derived",
    summary:
      "A fixed, auditable weighted score: 0.30 budget variance + 0.30 schedule slippage + 0.20 reported-vs-verified gap + 0.10 sensor anomaly + 0.10 rainfall — with a plain-language explanation of what drove it.",
    inputs: "The report's own costs, spending and dates; the verified figure; telemetry; rainfall",
    output: "Risk score 0–100, factor breakdown, written explanation",
  },
  {
    code: "M-03",
    name: "Report Data-Quality Audit",
    status: "real",
    summary:
      "Checks every project in the report for rows that can't be right — high progress with ₹0 spent, spending above even the revised budget, revised dates earlier than the originals.",
    inputs: "All 1,392 rows of the report",
    output: "Flag counts, a ranked issues list, each linked to its highlighted report row",
  },
  {
    code: "M-04",
    name: "Sector Peer Benchmarking",
    status: "real",
    summary:
      "Places a project's cost escalation and schedule extension against every project in the same sector of the report, using the report's own ministry and category headings.",
    inputs: "Report-defined sector cohort (e.g. 584 road projects)",
    output: "Percentile rank, cohort medians, nearest peers by cost",
  },
  {
    code: "M-05",
    name: "Site Imagery Change Detection",
    status: "real",
    summary:
      "Pixel-level difference between before and after images, searched only within the site's area so rivers or seasonal change elsewhere in frame aren't mistaken for construction.",
    inputs: "Cached before/after site imagery (capture source to be confirmed), team-set site area",
    output: "Box around the strongest change within the site",
  },
  {
    code: "M-06",
    name: "Site-Photo Verification",
    status: "real",
    summary:
      "A YOLOv8 classifier grades an uploaded construction-site photo; its estimate replaces the illustrative verified figure for that project.",
    inputs: "Site photos uploaded on a project page",
    output: "Photo-based progress estimate and confidence",
  },
  {
    code: "M-07",
    name: "Edition History",
    status: "real",
    summary:
      "Shows a project exactly as printed in each monthly PAIMANA edition loaded. One edition (Dec 2025) is loaded today; adding earlier reports extends the history automatically.",
    inputs: "One or more monthly flash reports",
    output: "Month-by-month cost, spend, progress and target dates",
  },
  {
    code: "M-08",
    name: "What-If Explorer",
    status: "derived",
    summary:
      "Re-runs the risk formula with different reported progress, verified progress or spending — a sensitivity check that shows how much verification changes the picture.",
    inputs: "Adjusted progress and spending",
    output: "Scenario score, factor-by-factor difference",
  },
  {
    code: "M-09",
    name: "Structural Telemetry",
    status: "simulated",
    summary:
      "No sensors are installed. Telemetry is generated from each project's real delay, budget and schedule figures to show how a sensor feed would slot into the score.",
    inputs: "Real schedule and budget figures (as generator input)",
    output: "Simulated vibration, temperature, strain; health score",
  },
  {
    code: "M-10",
    name: "Predictive Model",
    status: "demonstration",
    summary:
      "Gradient-boosted trees with SHAP explanations, trained on a synthetic distribution — shown to demonstrate the pipeline, not as a validated predictor.",
    inputs: "Budget variance, slippage, discrepancy, rainfall",
    output: "Indicative delay / overrun probabilities",
  },
  {
    code: "M-11",
    name: "Escalation Notices",
    status: "simulated",
    summary:
      "Drafts the clarification request Axiom would send the implementing agency named in the report. Nothing is sent.",
    inputs: "Project findings and the agency from the report",
    output: "Drafted notice with reference number",
  },
];
