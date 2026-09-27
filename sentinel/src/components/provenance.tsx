import { useState } from "react";
import type { ModuleStatus } from "@/data/projects";

const STATUS_STYLE: Record<ModuleStatus, string> = {
  real: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  derived: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  illustrative: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  simulated: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  demonstration: "border-amber-500/40 bg-amber-500/10 text-amber-400",
};

/** Small pill saying whether a figure is real, derived, simulated, ... */
export function StatusPill({ status, children }: { status: ModuleStatus; children?: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[status]}`}
    >
      {children ?? status}
    </span>
  );
}

/**
 * "PAIMANA Dec 2025 · code 602961 · PDF page 55  [View source row]" with an
 * expandable excerpt of the real report page, the project's row highlighted.
 */
export function SourceRow({
  code,
  page,
  excerptUrl,
  fullUrl,
  officialName,
  agency,
}: {
  code?: string | undefined;
  page?: number | undefined;
  excerptUrl: string;
  fullUrl: string;
  officialName?: string | undefined;
  agency?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!code || !page) return null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>PAIMANA Dec 2025 · code {code} · PDF page {page}</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="border border-border px-2 py-0.5 uppercase tracking-wider text-foreground hover:border-foreground"
        >
          {open ? "Hide source row" : "View source row →"}
        </button>
      </div>
      {open && (
        <div className="mt-4 border border-border bg-surface/30 p-4">
          {officialName && <div className="text-sm text-foreground">{officialName}</div>}
          {agency && <div className="font-mono text-[11px] text-muted-foreground">{agency}</div>}
          <img
            src={excerptUrl}
            alt={`PAIMANA flash report, PDF page ${page}, with this project's row highlighted`}
            className="mt-3 w-full border border-border bg-white"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>
              Page header, column headings and this project's row (highlighted). The page number printed in the
              report's footer can differ by one.
            </span>
            <a href={fullUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              Open the full page ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** Amber banner for a known problem in the source report's own row. */
export function ReportNote({ note }: { note?: string | undefined }) {
  if (!note) return null;
  return (
    <div className="my-6 border-l-2 border-amber-400 bg-amber-500/10 p-4 text-sm leading-relaxed">
      <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-400">
        Data-quality flag in the source report
      </span>
      <p className="mt-1 text-foreground/90">{note}</p>
    </div>
  );
}

/** Inline error for a panel whose backend call failed — never a silent fallback. */
export function LoadError({ what, error }: { what: string; error: string }) {
  return (
    <div className="mt-6 border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-400">
      Couldn't load {what} from the backend ({error}). Is it running at the address in VITE_API_URL?
    </div>
  );
}
