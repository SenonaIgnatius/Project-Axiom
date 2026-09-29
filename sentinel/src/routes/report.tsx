import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getReportProjects, reportRowUrl, type ReportProjectsResponse, type ReportQuery } from "@/lib/api";
import { LoadError, StatusPill } from "@/components/provenance";
import { inrCrore } from "@/data/projects";

export const Route = createFileRoute("/report")({
  loader: async () => {
    try {
      return { initial: await getReportProjects({ sort: "cost" }), error: null as string | null };
    } catch (e: any) {
      return { initial: null as ReportProjectsResponse | null, error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "All Projects — Project Sentinel" },
      {
        name: "description",
        content: "Every project in the MoSPI PAIMANA flash report, searchable, with its audit flags and source page.",
      },
    ],
  }),
  component: ReportPage,
});

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  low: "bg-surface text-muted-foreground border-border",
};

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const cr = (n: number | null) => (n == null ? "—" : inrCrore(n));

function ReportPage() {
  const { initial, error: loadError } = Route.useLoaderData();
  const [data, setData] = useState<ReportProjectsResponse | null>(initial);
  const [error, setError] = useState<string | null>(loadError);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<Omit<ReportQuery, "q" | "page">>({ sort: "cost" });
  const [page, setPage] = useState(1);
  const first = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return; // the loader already fetched page 1
    }
    let cancelled = false;
    setLoading(true);
    getReportProjects({ ...filters, q: debouncedQ, page })
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, filters, page]);

  const setFilter = (patch: Partial<Omit<ReportQuery, "q" | "page">>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the report's project list" error={error || "no data"} />
      </div>
    );
  }

  const flagInfo = Object.fromEntries(data.facets.flags.map((f) => [f.key, f]));
  const selectCls =
    "border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-foreground focus:outline-none";

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <StatusPill status="real">Real data</StatusPill>
            <span className="font-mono text-[11px] text-muted-foreground">
              MoSPI PAIMANA flash report · {data.edition}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">All Projects in the Report</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every one of the {data.total_in_report.toLocaleString("en-IN")} ongoing projects in the flash report, as
            printed, with the consistency flags from the Report Audit and a link to its source page. These are the
            agencies' reported figures only. The {data.case_study_count}{" "}
            <span className="text-foreground">case studies</span> also carry independent evidence (site imagery or
            site photos); extending that to every project needs each site's location, which the report doesn't
            publish.
          </p>
        </div>
        <div className="text-right">
          <div className="label-xs">Matching</div>
          <div className="mt-1 font-mono text-4xl font-extrabold tabular-nums">
            {data.matched.toLocaleString("en-IN")}
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            of {data.total_in_report.toLocaleString("en-IN")} projects
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, agency, state or PAIMANA code…"
          className="min-w-[280px] flex-1 border border-border bg-background px-3 py-1.5 font-mono text-[12px] placeholder:text-muted-foreground/70 focus:border-foreground focus:outline-none"
        />
        <select className={selectCls} value={filters.sector ?? ""} onChange={(e) => setFilter({ sector: e.target.value })}>
          <option value="">All sectors</option>
          {data.facets.sectors.map(([s, n]) => (
            <option key={s} value={s}>
              {s} ({n})
            </option>
          ))}
        </select>
        <select
          className={`${selectCls} max-w-[260px]`}
          value={filters.ministry ?? ""}
          onChange={(e) => setFilter({ ministry: e.target.value })}
        >
          <option value="">All ministries</option>
          {data.facets.ministries.map(([m, n]) => (
            <option key={m} value={m}>
              {m} ({n})
            </option>
          ))}
        </select>
        <select className={selectCls} value={filters.flag ?? ""} onChange={(e) => setFilter({ flag: e.target.value })}>
          <option value="">Any audit result</option>
          {data.facets.flags.map((f) => (
            <option key={f.key} value={f.key}>
              Flag: {f.label}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={filters.sort ?? "cost"}
          onChange={(e) => setFilter({ sort: e.target.value as NonNullable<ReportQuery["sort"]> })}
        >
          <option value="cost">Sort: largest cost</option>
          <option value="escalation">Sort: highest cost escalation</option>
          <option value="progress">Sort: lowest progress</option>
          <option value="name">Sort: name</option>
        </select>
        <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={!!filters.case_studies}
            onChange={(e) => setFilter({ case_studies: e.target.checked })}
          />
          Case studies only
        </label>
      </div>

      {error && <LoadError what="the filtered list" error={error} />}

      {/* table */}
      <div className={`mt-6 overflow-x-auto border border-border ${loading ? "opacity-60" : ""}`}>
        <table className="w-full text-left font-mono text-xs">
          <thead className="border-b border-border bg-background/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Code", "Project", "Sector", "State", "Revised cost ₹cr", "Escalation", "Spent ₹cr", "Progress", "Revised end", "Audit flags", "Source"].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.projects.map((r) => (
              <tr key={r.project_code} className={`align-top hover:bg-surface/40 ${r.case_study_id ? "bg-sky-500/5" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.project_code}</td>
                <td className="max-w-md px-3 py-2.5 text-foreground/90">
                  <div className="line-clamp-2 font-sans text-[13px]" title={r.name ?? ""}>
                    {r.name}
                  </div>
                  {r.agency && <div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">{r.agency}</div>}
                  {r.case_study_id && (
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: r.case_study_id }}
                      className="mt-1 inline-block border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-sky-400 hover:bg-sky-500/20"
                    >
                      Case study · full evidence →
                    </Link>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 uppercase tracking-wider text-[10px]">{r.sector}</td>
                <td className="max-w-[160px] px-3 py-2.5 text-muted-foreground">
                  <div className="line-clamp-2">{r.state || "—"}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  {cr(r.revised_cost_cr ?? r.original_cost_cr)}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${
                    r.cost_escalation_pct >= 20 ? "text-red-400" : r.cost_escalation_pct > 0 ? "text-amber-400" : "text-muted-foreground"
                  }`}
                >
                  {r.cost_escalation_pct ? `+${r.cost_escalation_pct}%` : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {cr(r.expenditure_cr)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{pct(r.physical_progress_pct)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {r.revised_completion || r.original_completion || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex max-w-[260px] flex-wrap gap-1">
                    {r.flags.length === 0 ? (
                      <span className="text-muted-foreground/60">—</span>
                    ) : (
                      r.flags.map((f) => (
                        <span
                          key={f}
                          className={`border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                            SEVERITY_STYLE[flagInfo[f]?.severity ?? "low"]
                          }`}
                        >
                          {flagInfo[f]?.label ?? f}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {r.source_page ? (
                    <a
                      href={reportRowUrl(r.project_code, r.source_page, true)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-muted-foreground hover:text-foreground"
                    >
                      p. {r.source_page} ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {data.projects.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                  No projects match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
        <span>
          Page {data.page} of {data.pages} · {data.page_size} per page · — = not printed in the report
        </span>
        <div className="flex gap-2">
          <button
            disabled={data.page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="border border-border px-3 py-1 uppercase tracking-wider enabled:hover:border-foreground enabled:hover:text-foreground disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            disabled={data.page >= data.pages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="border border-border px-3 py-1 uppercase tracking-wider enabled:hover:border-foreground enabled:hover:text-foreground disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
