import { createFileRoute, Link } from "@tanstack/react-router";
import { MODULES, GAP_THRESHOLD, inrCompact, progressGap, type ProjectRecord } from "@/data/projects";
import { getProjects, getDataQuality, type DataQualityResponse } from "@/lib/api";
import { StatusPill, LoadError } from "@/components/provenance";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [projects, dq] = await Promise.all([getProjects(), getDataQuality()]);
      return { projects, dq, error: null as string | null };
    } catch (e: any) {
      return { projects: [] as ProjectRecord[], dq: null as DataQualityResponse | null, error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "Project Sentinel — Infrastructure Risk Console" },
      {
        name: "description",
        content:
          "Project Sentinel checks government infrastructure progress reports against independent evidence, starting from the MoSPI PAIMANA flash report itself.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { projects, dq, error } = Route.useLoaderData();

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the project register" error={error} />
      </div>
    );
  }

  const pastDeadline = projects.filter((p) => (p.delayMonths || 0) > 0).length;
  const overrun = projects.reduce((a, p) => a + ((p.revisedCost || 0) - (p.originalCost || 0)), 0);
  const original = projects.reduce((a, p) => a + (p.originalCost || 0), 0);
  const widest = [...projects].sort((a, b) => Math.abs(progressGap(b)) - Math.abs(progressGap(a)))[0];
  const flag = (k: string) => dq?.flags?.[k] ?? 0;
  const satCount = projects.filter((p) => p.evidenceRoute === "satellite").length;
  const photoCount = projects.length - satCount;

  return (
    <div>
      {/* masthead */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-0 px-6 lg:grid-cols-12">
          <div className="py-16 lg:col-span-8 lg:py-24 lg:pr-16">
            <div className="label-xs">MoSPI PAIMANA flash report · December 2025</div>
            <h1 className="mt-6 text-5xl leading-[0.95] sm:text-6xl lg:text-7xl">
              What is reported.
              <br />
              <span className="text-muted-foreground">What is actually built.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              Project Sentinel starts from the government's own progress report. Every reported figure is
              extracted from the MoSPI PAIMANA flash report and links to the page and row it came from. Sentinel
              then audits the report for internal contradictions, benchmarks each project against its sector, and
              checks progress against evidence the implementing agency doesn't control — site imagery and site
              photos.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/projects"
                className="border border-foreground bg-foreground px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-background hover:bg-transparent hover:text-foreground"
              >
                Project register
              </Link>
              <Link
                to="/data-quality"
                className="border border-border px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:border-foreground hover:text-foreground"
              >
                Report audit
              </Link>
            </div>
          </div>
          <div className="hatch border-t border-border lg:col-span-4 lg:border-l lg:border-t-0">
            <dl className="divide-y divide-border bg-background/80">
              {[
                ["Projects monitored", `${projects.length}`, "each traced to its report row"],
                ["Past original deadline", `${pastDeadline} / ${projects.length}`, "revised completion later than original"],
                [
                  "Cost overrun",
                  inrCompact(overrun),
                  original ? `+${Math.round((overrun / original) * 100)}% over original cost` : "",
                ],
                [
                  "Evidence route",
                  `${satCount} satellite · ${photoCount} photo`,
                  "tunnels, lines and dense-city works need site photos",
                ],
                [
                  "Report rows flagged",
                  `${dq ? dq.issues.length : "—"}`,
                  dq ? `of ${dq.projects_evaluated.toLocaleString("en-IN")} projects audited` : "",
                ],
              ].map(([k, v, n]) => (
                <div key={k} className="px-6 py-6">
                  <dt className="label-xs">{k}</dt>
                  <dd className="mt-2 font-display text-3xl font-extrabold tabular-nums">{v}</dd>
                  <dd className="mt-1 font-mono text-[11px] text-muted-foreground">{n}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* what the report audit found */}
      {dq && (
        <section className="border-b border-border bg-surface/40 py-14">
          <div className="mx-auto max-w-[1400px] px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="label-xs">Found in the report itself</div>
                <h2 className="mt-3 text-3xl">Rows that can't be right</h2>
              </div>
              <Link to="/data-quality" className="font-mono text-[11px] uppercase tracking-widest underline">
                Full audit →
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              {[
                [flag("progress_without_spend"), "projects report 90%+ physical progress with ₹0 spent"],
                [flag("spend_above_revised_cost"), "have already spent more than even their revised budget"],
                [flag("revised_date_before_original"), "list a revised deadline earlier than the original one"],
              ].map(([n, d]) => (
                <div key={d as string} className="border border-border bg-background/60 p-6">
                  <div className="font-display text-4xl font-extrabold tabular-nums text-red-400">{n}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-3xl font-mono text-[11px] leading-relaxed text-muted-foreground">
              Out of {dq.projects_evaluated.toLocaleString("en-IN")} projects in the {dq.edition} edition. A flag means
              the row is internally inconsistent and deserves a question — not that wrongdoing occurred. Every flagged
              row links to its highlighted page in the report.
            </p>
          </div>
        </section>
      )}

      {/* module strip */}
      <section className="mx-auto max-w-[1400px] px-6 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl">What Sentinel does</h2>
          <p className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
            Eleven modules. Each one says plainly whether it runs on real data, is derived from it, or is
            simulated for the demo — a tool that checks other people's numbers should be upfront about its own.
          </p>
        </div>

        <ul className="mt-10 border-t border-border">
          {MODULES.map((m) => (
            <li key={m.code} className="grid grid-cols-1 gap-3 border-b border-border py-6 md:grid-cols-12 md:gap-6">
              <div className="font-mono text-[11px] tracking-widest text-muted-foreground md:col-span-1">{m.code}</div>
              <div className="md:col-span-3">
                <h3 className="text-lg">{m.name}</h3>
                <div className="mt-2">
                  <StatusPill status={m.status} />
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground md:col-span-5">{m.summary}</p>
              <div className="md:col-span-3">
                <div className="font-mono text-[11px] text-muted-foreground">IN · {m.inputs}</div>
                <div className="mt-1 font-mono text-[11px]">OUT · {m.output}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 font-mono text-[11px] text-muted-foreground">
          <Link to="/provenance" className="underline">Where every figure comes from →</Link>
        </p>
      </section>

      {/* pipeline */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 divide-y divide-border px-0 md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            ["01 · Extract", "Every project row in the flash report becomes a typed record — with its PDF page kept alongside."],
            ["02 · Audit", "The report is checked against itself: progress without spending, spending beyond budget, dates that run backwards."],
            ["03 · Verify", "Each project is routed to evidence that can actually see it: satellite imagery where its structure is visible, a geotagged site photo where it isn't (tunnels, transmission lines, dense cities)."],
            ["04 · Escalate", `A reported-vs-verified gap of ${GAP_THRESHOLD}+ points, or a high score, surfaces for review with a drafted clarification request.`],
          ].map(([t, d]) => (
            <div key={t} className="px-6 py-10">
              <div className="label-xs">{t}</div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* data sources */}
      <section className="mx-auto max-w-[1400px] px-6 py-16">
        <h2 className="text-3xl">Data sources</h2>
        <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [
              "Official project reporting",
              "MoSPI PAIMANA flash report, December 2025 — all 1,392 ongoing projects extracted, matching the report's own sector totals.",
            ],
            [
              "Site imagery",
              "Cached before/after images of each site (capture source still being confirmed). A Sentinel-2 fetch through the Copernicus Data Space is built in to replace them.",
            ],
            [
              "Rainfall",
              "Daily rainfall per site from the Open-Meteo historical archive, keyed by PAIMANA project code. Sites without a record say so instead of borrowing data.",
            ],
          ].map(([t, d]) => (
            <div key={t} className="rule-top pt-4">
              <div className="font-display text-base font-bold">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        {widest && (
          <p className="mt-8 font-mono text-[11px] text-muted-foreground">
            Widest reported-vs-verified gap right now: {Math.abs(progressGap(widest)).toFixed(1)} pts on {widest.name}{" "}
            ({widest.verifiedBasis === "photo" ? "photo-verified" : "verified figure illustrative"}).
          </p>
        )}
      </section>
    </div>
  );
}
