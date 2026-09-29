import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getDataQuality, reportRowUrl, type DataQualityResponse } from "@/lib/api";
import { LoadError } from "@/components/provenance";

export const Route = createFileRoute("/data-quality")({
  loader: async () => {
    try {
      return { data: await getDataQuality(), error: null as string | null };
    } catch (e: any) {
      return { data: null as DataQualityResponse | null, error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "Report Audit — Axiom" },
      {
        name: "description",
        content:
          "Consistency audit of every project row in the MoSPI PAIMANA flash report, each flag linked to the report page it came from.",
      },
    ],
  }),
  component: DataQualityPage,
});

const SEVERITY_TEXT: Record<string, string> = {
  critical: "text-red-400",
  medium: "text-amber-400",
  low: "text-foreground",
};

const PAGE_SIZE = 50;

function DataQualityPage() {
  const { data, error } = Route.useLoaderData();
  const [filterFlag, setFilterFlag] = useState<string>("all");
  const [shown, setShown] = useState(PAGE_SIZE);

  const severityOf = useMemo(
    () => Object.fromEntries((data?.rules ?? []).map((r) => [r.key, r.severity])),
    [data],
  );
  const labelOf = useMemo(
    () => Object.fromEntries((data?.rules ?? []).map((r) => [r.key, r.label])),
    [data],
  );

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the report audit" error={error || "no data"} />
      </div>
    );
  }

  const filtered = filterFlag === "all" ? data.issues : data.issues.filter((i) => i.flags.includes(filterFlag));

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12 space-y-12">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Real data
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              MoSPI PAIMANA flash report · {data.edition}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Report Audit</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-3xl leading-relaxed">
            Before checking a report against the ground, check it against itself. Every one of the{" "}
            {data.projects_evaluated.toLocaleString("en-IN")} projects in the report is tested for rows that
            contradict themselves, using only the figures printed in the report.
          </p>
        </div>

        <div className="text-right">
          <div className="label-xs">Rows passing</div>
          <div className="text-4xl font-extrabold font-mono text-emerald-400 mt-1">{data.data_quality_score}%</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1">
            {data.projects_evaluated.toLocaleString("en-IN")} projects · {data.issues.length.toLocaleString("en-IN")} flagged
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border/80 bg-surface/40 p-5 space-y-2">
          <div className="label-xs text-amber-400">How to read this</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.note}</p>
        </div>
        <div className="border border-border/80 bg-surface/40 p-5 space-y-2">
          <div className="label-xs text-muted-foreground">Scoring</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.policy}</p>
        </div>
      </div>

      {/* Rule cards */}
      <div>
        <div className="label-xs mb-4">{data.rules.length} consistency checks · click one to filter</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.rules.map((rule) => {
            const selected = filterFlag === rule.key;
            return (
              <button
                key={rule.key}
                onClick={() => {
                  setFilterFlag(selected ? "all" : rule.key);
                  setShown(PAGE_SIZE);
                }}
                className={`text-left p-4 border transition-colors ${
                  selected ? "border-emerald-500 bg-emerald-500/10" : "border-border/80 bg-surface/20 hover:border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-mono text-foreground">{rule.label}</span>
                  <span className={`font-mono text-[10px] uppercase tracking-widest ${SEVERITY_TEXT[rule.severity]}`}>
                    {rule.severity}
                  </span>
                </div>
                <div className={`text-3xl font-bold font-mono mt-2 ${SEVERITY_TEXT[rule.severity]}`}>
                  {(data.flags[rule.key] ?? 0).toLocaleString("en-IN")}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2 leading-snug">{rule.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="border border-border/80 bg-surface/20">
        <div className="p-5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label-xs">Flagged rows</div>
            <h3 className="text-base font-semibold mt-1">
              {filtered.length.toLocaleString("en-IN")} {filterFlag === "all" ? "projects" : `× ${labelOf[filterFlag]}`}
              <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">most severe first</span>
            </h3>
          </div>
          {filterFlag !== "all" && (
            <button onClick={() => setFilterFlag("all")} className="font-mono text-xs text-muted-foreground hover:text-foreground underline">
              Clear filter
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-b border-border bg-background/50 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">PAIMANA code</th>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">State</th>
                <th className="py-3 px-4">Flags</th>
                <th className="py-3 px-4">Report row</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.slice(0, shown).map((issue) => (
                <tr key={issue.project_id} className="hover:bg-surface/40 align-top">
                  <td className="py-3 px-4 font-bold text-foreground">{issue.project_id}</td>
                  <td className="py-3 px-4 text-foreground/90 max-w-md">
                    <div className="line-clamp-2" title={issue.project_name}>{issue.project_name}</div>
                    {issue.agency && <div className="mt-0.5 text-[10px] text-muted-foreground">{issue.agency}</div>}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{issue.state || "—"}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1.5">
                      {issue.flags.map((f) => (
                        <span
                          key={f}
                          className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider border ${
                            severityOf[f] === "critical"
                              ? "bg-red-500/15 text-red-400 border-red-500/20"
                              : severityOf[f] === "medium"
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
                                : "bg-surface text-muted-foreground border-border"
                          }`}
                        >
                          {labelOf[f] || f}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <a
                      href={reportRowUrl(issue.project_id, issue.source_page, true)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      p. {issue.source_page} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown < filtered.length && (
          <div className="border-t border-border p-4 text-center">
            <button
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="border border-border px-4 py-1.5 font-mono text-xs uppercase tracking-wider hover:border-foreground"
            >
              Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
