import type { SiteImagery } from "@/data/projects";
import type { ChangeBox } from "@/lib/api";

/**
 * Builds a Copernicus Data Space Browser URL for the site's coordinates, so
 * anyone can pull the real Sentinel-2 scenes for the location themselves.
 */
export function getCopernicusBrowserUrl(lat: number, lng: number, zoom = 14) {
  return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&themeId=DEFAULT-THEME&visualizationUrl=U2FsdGVkX1%2F%2BgCguT%2BwC0%2BAwoBQEh4RnBYm7i1wvnDNkW1gKnnAO4s%2F05Jmu9q5GKxksbcUXg%2FKMfpfL%2B3eUiFUORL0nTVkyb%2F9Hn330hURQvJLMXhDkx5LgUG1rK3%2Ft&datasetId=S2_L2A_CDAS&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE`;
}

export function SatFrame({
  site,
  imageUrl,
  variant,
  label,
  date,
  changeBox,
  siteSpecific = true,
  alt,
}: {
  site: SiteImagery;
  imageUrl: string | null;
  variant: "before" | "after";
  label: string;
  date?: string | undefined;
  /** Real pixel-difference result; drawn on the "after" frame only. */
  changeBox?: ChangeBox | null | undefined;
  /** False when the site changed no more than its surroundings: the box is then drawn muted. */
  siteSpecific?: boolean | undefined;
  alt: string;
}) {
  // AOI from the backend is [x1, y1, x2, y2] in % of frame; some entries have an axis flipped.
  const [a, b, c, d] = site.aoi;
  const x1 = Math.min(a, c), x2 = Math.max(a, c), y1 = Math.min(b, d), y2 = Math.max(b, d);
  const copernicusUrl = getCopernicusBrowserUrl(site.lat, site.lng, site.zoom);

  return (
    <figure className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5 bg-surface/50">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{date}</span>
      </div>

      <div className="relative overflow-hidden bg-black/90">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={alt}
            loading="lazy"
            className="block h-[340px] w-full object-cover select-none"
            draggable={false}
          />
        ) : (
          <div className="flex h-[340px] items-center justify-center font-mono text-xs text-muted-foreground">
            No cached image for this site yet
          </div>
        )}

        {/* Site area of interest, set by the team (PAIMANA publishes no coordinates) */}
        <div
          className="pointer-events-none absolute border border-dashed border-foreground/80"
          style={{ left: `${x1}%`, top: `${y1}%`, width: `${x2 - x1}%`, height: `${y2 - y1}%` }}
        >
          <span className="absolute -top-[1px] left-0 -translate-y-full bg-background px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest border border-border text-foreground">
            Site area
          </span>
        </div>

        {variant === "after" && changeBox && (
          <div
            className={`pointer-events-none absolute border-2 ${
              siteSpecific ? "border-amber-400 bg-amber-400/10" : "border-dashed border-amber-400/60"
            }`}
            style={{
              left: `${changeBox.x_pct}%`,
              top: `${changeBox.y_pct}%`,
              width: `${changeBox.w_pct}%`,
              height: `${changeBox.h_pct}%`,
            }}
          >
            <span className="absolute bottom-0 left-0 translate-y-full bg-amber-400 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-black">
              {siteSpecific ? "Strongest change" : "Strongest change · not site-specific"}
            </span>
          </div>
        )}

        <div className="absolute bottom-2 right-2 bg-background/85 border border-border px-2 py-1 font-mono text-[9px] text-muted-foreground">
          {site.lat.toFixed(4)}°N, {site.lng.toFixed(4)}°E · approx.
        </div>
      </div>

      <figcaption className="border-t border-border px-3.5 py-2 font-mono text-[10px] text-muted-foreground flex flex-wrap items-center justify-between gap-2 bg-surface/30">
        <span>
          {variant === "before"
            ? "Earlier image of the site area"
            : changeBox
              ? siteSpecific
                ? "Amber box: strongest pixel change inside the site area"
                : "Dashed box: strongest change in the site area, but no more than the surroundings"
              : "Later image of the site area"}
        </span>
        <a href={copernicusUrl} target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-2">
          Open location in Copernicus ↗
        </a>
      </figcaption>
    </figure>
  );
}
