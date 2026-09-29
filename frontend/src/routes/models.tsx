import { createFileRoute, Link } from "@tanstack/react-router";
import { getOverrunModels, type OverrunModelsReport, type OverrunTarget, type OverrunTargetReport } from "@/lib/api";
import { LoadError, StatusPill } from "@/components/provenance";

export const Route = createFileRoute("/models")({
  loader: async () => {
    try {
      return { report: await getOverrunModels(), error: null as string | null };
    } catch (e: any) {
      return { report: null as OverrunModelsReport | null, error: String(e?.message || e) };
    }
  },
  head: () => ({
    meta: [
      { title: "Early-Warning Models — Axiom" },
      {
        name: "description",
        content:
          "Cost- and time-overrun prediction models trained on every project in the MoSPI PAIMANA report, comparing conventional statistics with machine learning.",
      },
    ],
  }),
  component: ModelsPage,
});

const TITLES: Record<OverrunTarget, string> = {
  cost_overrun: "Cost overrun",
  time_overrun: "Time overrun",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function ModelsPage() {
  const { report, error } = Route.useLoaderData();
  if (!report) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16">
        <LoadError what="the prediction models" error={error || "no data"} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12 space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <StatusPill status="real">Real data · cross-validated</StatusPill>
            <span className="font-mono text-[11px] text-muted-foreground">{report.source}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Early-Warning Models</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Can we tell, from what is known when a project is approved, whether it will overrun its cost or its
            schedule? Axiom trains on all {report.trained_on.toLocaleString("en-IN")} projects in the report and
            compares a conventional statistical model (logistic regression) with machine-learning models (random
            forest, gradient boosting). {report.validation}.
          </p>
        </div>
        <Link
          to="/report"
          search={{ watchlist: true }}
          className="border border-sky-400 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-sky-400 hover:bg-sky-400 hover:text-background"
        >
          Early-warning watchlist →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {(Object.keys(report.targets) as OverrunTarget[]).map((t) => (
          <TargetCard key={t} title={TITLES[t]} target={report.targets[t]} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="border border-border/80 bg-surface/40 p-5">
          <div className="label-xs">Inputs the models use</div>
          <ul className="mt-3 space-y-1 text-sm text-foreground/90">
            {report.features.map((f) => (
              <li key={f.key}>· {f.label}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            All known at approval, so a warning can be raised before anything goes wrong. Deliberately excluded:{" "}
            {report.excluded_inputs}
          </p>
        </div>
        <div className="border border-border/80 bg-surface/40 p-5">
          <div className="label-xs">How to read the scores</div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              <span className="text-foreground">ROC-AUC</span>: how well the model ranks projects that overran above
              ones that didn't. 0.5 = coin toss, 1.0 = perfect.
            </li>
            <li>
              <span className="text-foreground">Top-10% hit rate</span>: of the 10% of projects the model rates
              riskiest, the share that really overran. Compare it with the base rate.
            </li>
            <li>
              <span className="text-foreground">PR-AUC</span> and <span className="text-foreground">Brier</span>:
              precision across thresholds (higher is better) and probability error (lower is better).
            </li>
          </ul>
        </div>
        <div className="border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="label-xs text-amber-400">Limitations</div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            {report.limitations.map((l) => (
              <li key={l}>· {l}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TargetCard({ title, target }: { title: string; target: OverrunTargetReport }) {
  const models = Object.entries(target.models);
  const best = target.models[target.best_model];
  const stats = target.models["logistic_regression"];
  const lift = best ? best.precision_top10 / target.base_rate : 0;
  const maxImp = Math.max(...target.drivers.map((d) => d.importance), 0.0001);
  const sectors = (target.direction["sector"] as { value: string; rate: number; n: number }[] | undefined) ?? [];

  return (
    <section className="border border-border bg-surface/20">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl">{title}</h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {target.positives.toLocaleString("en-IN")} projects overran · base rate {pct(target.base_rate)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{target.definition}</p>
      </div>

      {/* headline */}
      {best && stats && (
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
          <div className="p-5">
            <div className="label-xs">ML vs statistics</div>
            <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">
              {target.ml_gain_over_statistics_auc >= 0 ? "+" : ""}
              {target.ml_gain_over_statistics_auc.toFixed(3)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              ROC-AUC, {best.label} {best.roc_auc.toFixed(2)} vs logistic regression {stats.roc_auc.toFixed(2)}
            </div>
          </div>
          <div className="p-5">
            <div className="label-xs">Early-warning hit rate</div>
            <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">{pct(best.precision_top10)}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              of the riskiest 10% overran · {lift.toFixed(1)}× the {pct(target.base_rate)} base rate
            </div>
          </div>
        </div>
      )}

      {/* comparison table */}
      <div className="overflow-x-auto border-b border-border">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-background/50 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {["Model", "Approach", "ROC-AUC", "PR-AUC", "Top 10%", "Brier"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {models.map(([key, m]) => {
              const isBest = key === target.best_model;
              return (
                <tr key={key} className={isBest ? "bg-emerald-500/10" : ""}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-foreground">
                    {m.label}
                    {isBest && <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-400">best</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{m.family === "conventional statistics" ? "statistics" : "ML"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {m.roc_auc.toFixed(3)} <span className="text-muted-foreground">±{m.roc_auc_sd.toFixed(3)}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{m.pr_auc.toFixed(3)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{pct(m.precision_top10)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{m.brier.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-b border-border px-5 py-3 text-xs text-foreground/90">{target.verdict}</p>

      {/* drivers */}
      <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-2">
        <div>
          <div className="label-xs">What drives it</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Drop in ROC-AUC when each input is shuffled ({best?.label ?? "best model"}).
          </p>
          <div className="mt-3 space-y-2">
            {target.drivers.map((d) => (
              <div key={d.feature} className="group" title={`${d.label}: ${d.importance.toFixed(3)} ROC-AUC`}>
                <div className="flex justify-between font-mono text-[11px]">
                  <span className="text-foreground/90">{d.label}</span>
                  <span className="tabular-nums text-muted-foreground">{d.importance.toFixed(3)}</span>
                </div>
                <div className="mt-1 h-2 w-full">
                  <div
                    className="h-full rounded-r-[4px] bg-foreground/70 group-hover:bg-foreground"
                    style={{ width: `${Math.max(2, (d.importance / maxImp) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="label-xs">Overrun rate by sector (report)</div>
          <table className="mt-3 w-full font-mono text-[11px]">
            <tbody className="divide-y divide-border/60">
              {sectors.map((s) => (
                <tr key={s.value}>
                  <td className="py-1.5 text-foreground/90">{s.value}</td>
                  <td className="py-1.5 text-right tabular-nums">{pct(s.rate)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">n={s.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            With project age added, the score would reach {target.exposure_sensitivity.auc_with_age_features.toFixed(2)}
            , but mostly because an ongoing project past its deadline is late by definition (that rule alone scores{" "}
            {target.exposure_sensitivity.auc_deadline_passed_rule.toFixed(2)}). The app uses the approval-time model.
          </p>
        </div>
      </div>
    </section>
  );
}
