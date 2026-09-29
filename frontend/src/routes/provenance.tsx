import { createFileRoute, Link } from "@tanstack/react-router";
import { getDataQuality, type DataQualityResponse } from "@/lib/api";
import { StatusPill } from "@/components/provenance";
import type { ModuleStatus } from "@/data/projects";

export const Route = createFileRoute("/provenance")({
  loader: async () => {
    try {
      return { dq: await getDataQuality() };
    } catch {
      return { dq: null as DataQualityResponse | null };
    }
  },
  head: () => ({ meta: [{ title: "Data Provenance — Axiom" }] }),
  component: ProvenancePage,
});

const ROWS: { what: string; source: string; status: ModuleStatus; label?: string; note: string }[] = [
  {
    what: "Reported progress, cost, expenditure, dates",
    source: "MoSPI PAIMANA flash report, December 2025 (108 pages)",
    status: "real",
    note: "Every row of the report's “All Ongoing Projects” tables — 1,392 projects, matching the report's own per-sector totals — extracted by scripts/extract_paimana_dataset.py. Each project links to its PDF page and highlighted row.",
  },
  {
    what: "Sector of each project",
    source: "The report's own ministry and category headings",
    status: "real",
    note: "e.g. “Ministry of Power / Electricity Generation”. Nothing is guessed from project names.",
  },
  {
    what: "Budget variance, schedule slippage, delay",
    source: "Computed from the report's costs and dates",
    status: "derived",
    note: "As of December 2025. Delay = revised completion date minus original; slippage = share of the original timeline elapsed minus reported progress.",
  },
  {
    what: "Report audit flags",
    source: "Consistency rules over all 1,392 rows",
    status: "real",
    note: "Only the report's own figures are used. A flag is a question worth asking, not a finding of wrongdoing.",
  },
  {
    what: "Sector benchmarks",
    source: "Every project in the same report-defined sector",
    status: "real",
    note: "Cost escalation (revised vs original cost) and schedule extension, ranked against the sector cohort.",
  },
  {
    what: "Edition history",
    source: "PAIMANA editions loaded",
    status: "real",
    note: "One edition (Dec 2025) is loaded today, so each project has one snapshot. Adding earlier monthly reports extends it automatically.",
  },
  {
    what: "Verified progress",
    source: "Stand-in figure",
    status: "illustrative",
    note: "Set a fixed gap below the reported figure until live verification is run. Uploading a site photo replaces it with a real YOLOv8 estimate.",
  },
  {
    what: "Site-photo classifier",
    source: "YOLOv8, trained by the team on construction-site images",
    status: "real",
    note: "Runs on photos you upload on a project page.",
  },
  {
    what: "Before / after site imagery",
    source: "Cached images",
    status: "illustrative",
    label: "unconfirmed",
    note: "Capture source and dates not yet confirmed, so they are not labelled as Sentinel-2. A Sentinel-2 L2A fetch through the Copernicus Data Space is built in and replaces them once run.",
  },
  {
    what: "Change box on the imagery",
    source: "Pixel difference between the two cached images",
    status: "real",
    note: "A genuine computation, restricted to the site's area. Site coordinates and areas are set by the team — PAIMANA doesn't publish coordinates.",
  },
  {
    what: "Structural telemetry",
    source: "data/sensors.csv",
    status: "simulated",
    note: "No sensors are installed. Values are generated reproducibly from each project's real delay, budget and schedule figures. The “simulate” buttons inject scenario readings on top.",
  },
  {
    what: "Rainfall",
    source: "data/rainfall.csv",
    status: "real",
    label: "real where available",
    note: "Daily rainfall per project from the Open-Meteo historical archive (scripts/fetch_rainfall.py). A site with no record shows “no record” and the rainfall factor contributes 0.",
  },
  {
    what: "Composite risk score",
    source: "Transparent weighted formula",
    status: "derived",
    note: "0.30 budget + 0.30 schedule + 0.20 reported-vs-verified gap + 0.10 sensor + 0.10 rainfall. It inherits the status of its inputs.",
  },
  {
    what: "Predictive model and SHAP values",
    source: "Gradient-boosted trees trained in-app",
    status: "demonstration",
    label: "synthetic training",
    note: "Trained on a synthetic distribution with report-like ranges, not on real project outcomes. Shown to demonstrate the pipeline.",
  },
  {
    what: "Escalation notices",
    source: "Drafted on request",
    status: "simulated",
    note: "Addressed to the agency named in the report. Never sent or stored.",
  },
];

function ProvenancePage() {
  const { dq } = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-[1400px] px-6">
      <div className="border-b border-border py-12">
        <div className="label-xs">Data provenance</div>
        <h1 className="mt-4 text-4xl sm:text-5xl">What's real, and what isn't yet</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A tool that checks other people's numbers should be upfront about its own. Here is where every figure in
          Axiom comes from.
        </p>
      </div>

      <div className="overflow-x-auto py-10">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-border">
              {["Figure", "Source", "Status", "Notes"].map((h) => (
                <th key={h} className="px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.what} className="border-b border-border align-top">
                <td className="px-3 py-4 text-[13px] font-medium">{r.what}</td>
                <td className="px-3 py-4 text-[13px] text-muted-foreground">{r.source}</td>
                <td className="px-3 py-4"><StatusPill status={r.status}>{r.label}</StatusPill></td>
                <td className="px-3 py-4 text-[12px] leading-relaxed text-muted-foreground">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dq && (
        <div className="mb-8 border border-border bg-surface/40 p-6">
          <div className="label-xs">Problems found in the source report</div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed">
            Reading the {dq.edition} report row by row surfaces entries that can't be right:{" "}
            {dq.flags["progress_without_spend"]} projects report 90% or more physical progress with ₹0 spent,{" "}
            {dq.flags["spend_above_revised_cost"]} have spent more than even their revised budget, and{" "}
            {dq.flags["revised_date_before_original"]} list a revised deadline earlier than the original. The Zojila
            tunnel (PAIMANA 618412) is filed under Andhra Pradesh with ₹0 spent and 0% progress.{" "}
            <Link to="/data-quality" className="underline">See every flagged row →</Link>
          </p>
        </div>
      )}
    </div>
  );
}
