import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { inrCrore, inrCompact, progressGap, GAP_THRESHOLD, type ProjectRecord } from "@/data/projects";
import { RiskTag, StatusTag, sectorMix } from "@/components/console";
import { getProjects, reportRowUrl } from "@/lib/api";
import { LoadError } from "@/components/provenance";

export const Route = createFileRoute("/projects/")({
  loader: async () => {
    try {
      return { projects: await getProjects(), error: null as string | null };
    } catch (e: any) {
      return { projects: [] as ProjectRecord[], error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "Project Register — Project Sentinel" },
      {
        name: "description",
        content:
          "Register of monitored central infrastructure projects with sanctioned cost, expenditure, verification status and schedule slippage.",
      },
      { property: "og:title", content: "Project Register — Project Sentinel" },
      {
        property: "og:description",
        content:
          "Sector-wise register of monitored roads, railways, power and water projects under Project Sentinel.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { projects: projectsList, error } = Route.useLoaderData();
  const navigate = useNavigate();
  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the project register" error={error} />
      </div>
    );
  }

  const mix = sectorMix(projectsList);

  return (
    <div className="mx-auto max-w-[1400px] px-6">
      <div className="border-b border-border py-12">
        <div className="label-xs">Register · PAIMANA flash report, Dec 2025</div>
        <h1 className="mt-4 text-4xl sm:text-5xl">Project register</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every monitored project as a single record: its figures exactly as
          printed in the PAIMANA report (with the page they came from), the
          schedule slip between original and revised dates, and Sentinel's
          risk score.
        </p>
      </div>

      {/* sector ledger */}
      <div className="grid grid-cols-2 border-b border-border lg:grid-cols-4">
        {mix.map((s) => (
          <div
            key={s.sector}
            className="border-r border-border px-5 py-6 last:border-r-0"
          >
            <div className="label-xs">{s.sector}</div>
            <div className="mt-2 font-display text-2xl font-extrabold tabular-nums">
              {s.count}{" "}
              <span className="text-sm font-medium text-muted-foreground">
                projects
              </span>
            </div>
            <div className="mt-3 space-y-1 font-mono text-[11px] text-muted-foreground">
              <div>{inrCompact(s.cost)} revised cost</div>
              <div>{s.high} high risk</div>
            </div>
          </div>
        ))}
      </div>

      <div className="py-12">
        <h2 className="text-2xl">Records</h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-border">
                {[
                  "ID",
                  "Project",
                  "Sector",
                  "State",
                  "Timeline",
                  "Revised cost ₹cr",
                  "Spent ₹cr",
                  "Progress",
                  "Gap*",
                  "Delay",
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
              {projectsList.map((p) => {
                const discVal = Math.abs(progressGap(p));
                const isRed = discVal >= GAP_THRESHOLD;
                return (
                  <tr
                    key={p.id}
                    onClick={() =>
                      navigate({
                        to: "/projects/$projectId",
                        params: { projectId: p.id },
                      })
                    }
                    className="cursor-pointer border-b border-border hover:bg-surface"
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted-foreground">
                      {p.id}
                    </td>
                    <td className="px-3 py-3 text-[13px] font-medium">
                      {p.name}
                      {p.reportNote && (
                        <span className="ml-1.5 text-amber-400" title="Data-quality flag in the source report">⚑</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] uppercase tracking-wider">
                      {p.sector}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] text-muted-foreground">
                      {p.state}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted-foreground">
                      {p.startDate ? `${p.startDate} → ${p.revisedEndDate || p.expectedEndDate}` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums">
                      {inrCrore(p.sanctionedCost)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {inrCrore(p.expenditure)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] tabular-nums">
                      {p.reportedProgress}%
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] tabular-nums">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${isRed ? "bg-red-500/10 text-red-400 font-bold border border-red-500/30" : "text-foreground"}`}>
                        {discVal.toFixed(1)} pts
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] tabular-nums">
                      {p.delayMonths ? `${p.delayMonths} mo` : "—"}
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
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {projectsList.length} records · figures from the MoSPI PAIMANA flash report, December 2025 (Source = PDF
          page) · Delay = revised completion minus original · * Gap = reported minus verified progress; verified
          figures are illustrative stand-ins until a site photo is verified.{" "}
          <Link to="/provenance" className="underline">What's real and what isn't →</Link>
        </p>
      </div>
    </div>
  );
}
