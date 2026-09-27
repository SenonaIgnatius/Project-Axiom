import type { ProjectRecord, RiskLevel, ProjectStatus } from "@/data/projects";

export function RiskTag({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, string> = {
    low: "border-border text-muted-foreground",
    medium: "border-foreground/60 text-foreground",
    high: "border-foreground bg-foreground text-background",
  };
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${map[level]}`}
    >
      {level}
    </span>
  );
}

export function StatusTag({ status }: { status: ProjectStatus }) {
  const label = status === "on-track" ? "ON TRACK" : status.toUpperCase();
  const mark = status === "critical" ? "▲" : status === "delayed" ? "◆" : "●";
  return (
    <span className="font-mono text-[11px] tracking-wide text-foreground">
      <span className="mr-1.5 text-muted-foreground">{mark}</span>
      {label}
    </span>
  );
}

export function GapBar({ gap }: { gap: number }) {
  const w = Math.min(100, Math.abs(gap) * 4);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 font-mono text-[11px] tabular-nums">
        {gap > 0 ? "+" : ""}
        {gap.toFixed(1)}
      </span>
      <div className="h-1.5 w-16 bg-surface-2">
        <div className="h-full bg-foreground" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export function Meter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 font-mono text-[11px] tabular-nums">
        {value.toFixed(0)}%
      </span>
      <div className="h-1.5 w-14 bg-surface-2">
        <div
          className="h-full bg-muted-foreground"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="border-l border-border px-5 py-4">
      <div className="label-xs">{label}</div>
      <div className="mt-2 font-display text-3xl font-extrabold tabular-nums">
        {value}
      </div>
      {note ? (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function sectorMix(rows: ProjectRecord[]) {
  const sectors = ["Roads", "Railways", "Power", "Water"] as const;
  return sectors.map((s) => {
    const items = rows.filter((r) => r.sector === s);
    const high = items.filter((r) => r.riskLevel === "high").length;
    return {
      sector: s,
      count: items.length,
      high,
      cost: items.reduce((a, r) => a + r.sanctionedCost, 0),
      avgGap:
        items.reduce(
          (a, r) => a + (r.reportedProgress - r.verifiedProgress),
          0,
        ) / (items.length || 1),
    };
  });
}
