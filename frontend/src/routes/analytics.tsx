import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  inrCrore,
  inrCompact,
  progressGap,
  GAP_THRESHOLD,
  type ProjectRecord,
  type Sector,
  type RiskLevel,
} from "@/data/projects";
import { GapBar, Meter, RiskTag, StatusTag, Stat } from "@/components/console";
import { getProjects, reportRowUrl } from "@/lib/api";
import { LoadError } from "@/components/provenance";

export const Route = createFileRoute("/analytics")({
  loader: async () => {
    try {
      return { projects: await getProjects(), error: null as string | null };
    } catch (e: any) {
      return { projects: [] as ProjectRecord[], error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "Risk Analytics — Axiom" },
      {
        name: "description",
        content:
          "Dense risk analytics table comparing officially reported progress with satellite and photo-verified progress, with model risk scores per project.",
      },
      { property: "og:title", content: "Risk Analytics — Axiom" },
      {
        property: "og:description",
        content:
          "Reported vs verified progress, verification gap, risk score and status for every monitored infrastructure project.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const SECTORS: (Sector | "All")[] = [
  "All",
  "Roads",
  "Railways",
  "Power",
  "Water",
];
const RISKS: (RiskLevel | "All")[] = ["All", "high", "medium", "low"];

function AnalyticsPage() {
  const { projects: projectsList, error } = Route.useLoaderData();
  const [sector, setSector] = useState<Sector | "All">("All");
  const [risk, setRisk] = useState<RiskLevel | "All">("All");
  const [sortByGap, setSortByGap] = useState(true);
  const navigate = useNavigate();

  const rows = useMemo(() => {
    const filtered = projectsList.filter(
      (p) =>
        (sector === "All" || p.sector === sector) &&
        (risk === "All" || p.riskLevel === risk),
    );
    return filtered.sort((a, b) =>
      sortByGap ? progressGap(b) - progressGap(a) : b.riskScore - a.riskScore,
    );
  }, [projectsList, sector, risk, sortByGap]);

  const avgGap =
    rows.reduce((a, p) => a + progressGap(p), 0) / (rows.length || 1);
  const exposed = rows
    .filter((p) => p.riskLevel === "high")
    .reduce((a, p) => a + p.sanctionedCost, 0);
  const pastDeadline = rows.filter((p) => (p.delayMonths || 0) > 0).length;

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the project register" error={error} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6">
      <div className="border-b border-border py-12">
        <div className="label-xs">Analytics · reported vs verified</div>
        <h1 className="mt-4 text-4xl sm:text-5xl">Risk analytics</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each row pairs the progress figure printed in the PAIMANA report with
          the verified figure. A wide gap means the ground may not match the
          paperwork; the risk score blends that signal with the spending curve,
          schedule slippage and environmental exposure. Verified figures are
          illustrative until a site photo is verified.
        </p>
      </div>

      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-4">
        <Stat
          label="Records in view"
          value={`${rows.length}`}
          note={`of ${projectsList.length} total`}
        />
        <Stat
          label="Mean gap"
          value={`${avgGap.toFixed(1)} pts`}
          note="reported − verified (illustrative)"
        />
        <Stat
          label="High-risk capital"
          value={inrCompact(exposed)}
          note="revised cost of high-risk projects"
        />
        <Stat
          label="Past original deadline"
          value={`${pastDeadline}`}
          note="per the report's own dates"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-border py-5">
        <FilterRow
          label="Sector"
          options={SECTORS}
          value={sector}
          onChange={(v) => setSector(v as Sector | "All")}
        />
        <FilterRow
          label="Risk"
          options={RISKS}
          value={risk}
          onChange={(v) => setRisk(v as RiskLevel | "All")}
        />
        <div className="flex items-center gap-3">
          <span className="label-xs">Sort</span>
          <button
            onClick={() => setSortByGap(!sortByGap)}
            className="border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-widest hover:border-foreground"
          >
            {sortByGap ? "Gap ↓" : "Risk score ↓"}
          </button>
        </div>
      </div>

      <div className="py-10">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Project",
                  "Sector",
                  "State",
                  "Revised cost ₹cr",
                  "Expenditure ₹cr",
                  "Reported",
                  "Verified*",
                  "Gap",
                  "Score",
                  "Source",
                  "Risk",
                  "Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-3 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  onClick={() =>
                    navigate({
                      to: "/projects/$projectId",
                      params: { projectId: p.id },
                    })
                  }
                  className="cursor-pointer border-b border-border align-middle hover:bg-surface"
                >
                  <td className="px-3 py-3">
                    <div className="text-[13px] leading-tight">{p.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
                      {p.id} · {p.delayMonths ? `${p.delayMonths} mo slip` : "no slip"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] uppercase tracking-wider">
                    {p.sector}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-muted-foreground">
                    {p.state}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums">
                    {inrCrore(p.sanctionedCost)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {inrCrore(p.expenditure)}
                  </td>
                  <td className="px-3 py-3">
                    <Meter value={p.reportedProgress} />
                  </td>
                  <td className="px-3 py-3">
                    <Meter value={p.verifiedProgress} />
                  </td>
                  <td className="px-3 py-3">
                    <GapBar gap={progressGap(p)} />
                  </td>
                  <td className="px-3 py-3 font-mono text-[12px] tabular-nums">
                    {p.riskScore}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px]">
                    {p.projectCode && p.sourcePage ? (
                      <a
                        href={reportRowUrl(p.projectCode, p.sourcePage, true)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="underline text-muted-foreground hover:text-foreground"
                      >
                        p. {p.sourcePage}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <RiskTag level={p.riskLevel} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <StatusTag status={p.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-10 text-center font-mono text-[11px] text-muted-foreground"
                  >
                    No records match this filter combination.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 border-t border-border pt-8 md:grid-cols-3">
          <div>
            <div className="label-xs">Reading the gap</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Positive gap = reported progress exceeds the verified figure. A gap of
              {` ${GAP_THRESHOLD}`}+ points is flagged for review. Until a site photo is verified,
              the verified figure is an illustrative stand-in, so treat the gap as
              a demonstration of the check, not a finding.
            </p>
          </div>
          <div>
            <div className="label-xs">Score composition</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              0–34 low · 35–64 medium · 65–100 high. Formula: 0.30 budget variance + 0.30 schedule slippage + 0.20 reported-vs-verified gap + 0.10 sensor anomaly + 0.10 rainfall exposure.
            </p>
          </div>
          <div>
            <div className="label-xs">Data provenance</div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Reported figures: MoSPI PAIMANA flash report, Dec 2025 (real, page-linked). Budget and schedule factors: derived from them. Verified progress: illustrative unless photo-verified (YOLOv8). Telemetry: simulated. Rainfall: Open-Meteo archive where a record exists.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="label-xs">{label}</span>
      <div className="flex">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`-ml-px border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-widest ${
              value === o
                ? "z-10 border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
