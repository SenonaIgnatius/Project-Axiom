const ROWS = [
  {
    what: "Reported progress, cost, expenditure, dates",
    source: "MoSPI PAIMANA Flash Report, December 2025 (108 pages)",
    status: "real",
    note: "Extracted row-by-row from the report's “All Ongoing Projects” tables — all 1,392 projects, matching the report's own totals — by scripts/extract_paimana_dataset.py. Every project links to the exact PDF page and row.",
  },
  {
    what: "Budget variance, schedule slippage, delay, sector pace",
    source: "Computed from the report's own costs and dates",
    status: "derived",
    note: "As of December 2025. Delay = revised completion date minus original. Sector pace is compared against every project in the report.",
  },
  {
    what: "Verified progress",
    source: "Stand-in figure",
    status: "illustrative",
    note: "Set a fixed gap below the reported figure until live verification is run for the site. Uploading a site photo replaces it with a real YOLOv8 estimate, and the “illustrative” tag disappears.",
  },
  {
    what: "Site-photo classifier",
    source: "YOLOv8, trained by the team on a construction-site image dataset",
    status: "real",
    note: "Runs on photos you upload on a project page.",
  },
  {
    what: "Before / after site imagery",
    source: "Cached images",
    status: "unconfirmed",
    note: "Capture source and dates not yet confirmed, so they are not labelled as Sentinel-2. A real Sentinel-2 L2A fetch via the Copernicus Data Space Ecosystem is built in and replaces these once it's run.",
  },
  {
    what: "Change-region box on the imagery",
    source: "Pixel-difference on the two cached images",
    status: "real",
    note: "A genuine computation, restricted to the site's area of interest. Site coordinates and AOI boxes are set by the team — PAIMANA doesn't publish coordinates.",
  },
  {
    what: "Structural telemetry",
    source: "data/sensors.csv",
    status: "simulated",
    note: "No sensors are installed. Values are generated from each project's real delay, budget and schedule figures (not random), reproducibly.",
  },
  {
    what: "Rainfall",
    source: "data/rainfall.csv",
    status: "real where available",
    note: "Daily rainfall per project, keyed by PAIMANA code; scripts/fetch_rainfall.py pulls it from the Open-Meteo historical archive for each site's coordinates. A site without a record shows “no record” and the rainfall factor contributes 0 — rather than borrowing another project's data.",
  },
  {
    what: "Composite risk score",
    source: "Transparent weighted formula",
    status: "derived",
    note: "0.30 budget + 0.30 schedule + 0.20 discrepancy + 0.10 sensor + 0.10 rainfall. It inherits the status of its inputs above.",
  },
  {
    what: "Predictive model (gradient-boosted trees + SHAP) and risk clusters",
    source: "Trained in-app",
    status: "synthetic training",
    note: "Trained on a synthetic distribution with report-like ranges, not on real project outcomes. A demonstration of the pipeline, not a validated predictor.",
  },
  {
    what: "Escalation notices",
    source: "Drafted on request",
    status: "simulated",
    note: "Drafted for demonstration; never sent or stored.",
  },
];

const STATUS_CLASS = {
  real: "real",
  "real where available": "real",
  derived: "derived",
  illustrative: "caution",
  unconfirmed: "caution",
  simulated: "caution",
  "synthetic training": "caution",
};

export default function Provenance() {
  return (
    <>
      <div className="hero">
        <div className="eyebrow"><span className="dot" />Data provenance</div>
        <h1>What's real, and what <span className="accent">isn't yet</span></h1>
        <p className="hero-sub">
          A tool that checks other people's numbers should be upfront about its own. Here is where
          every figure in Sentinel comes from.
        </p>
      </div>

      <div className="section">
        <div className="card" style={{ padding: "4px 0", overflowX: "auto" }}>
          <table className="register prov-table">
            <thead>
              <tr><th>Figure</th><th>Source</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.what} style={{ cursor: "default" }}>
                  <td className="proj-name">{r.what}</td>
                  <td>{r.source}</td>
                  <td><span className={`status-pill ${STATUS_CLASS[r.status]}`}>{r.status}</span></td>
                  <td className="muted" style={{ fontSize: 13 }}>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h2>Problems found in the source report</h2></div>
        <div className="card" style={{ padding: 20 }}>
          <p style={{ fontSize: 14 }}>
            Reading the December 2025 report row by row surfaces entries that can't be right. The
            Zojila tunnel (PAIMANA 618412) is filed under Andhra Pradesh with ₹0 spent and 0% progress,
            and 34 projects report 90% or more physical progress against ₹0 expenditure — some of them
            100% complete. Where such a project appears in Sentinel, it carries a data-quality flag
            instead of being taken at face value.
          </p>
        </div>
      </div>
    </>
  );
}
