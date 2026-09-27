import { useRef, useState } from "react";

// The backend returns filesystem paths (e.g. .../data/satellite_cache/foo.jpg).
// Cached imagery is served at /satellite-cache/<filename> (see app/main.py).
// Fallback static tiles live outside any mounted static dir today — this
// component degrades gracefully (see onError) rather than showing a broken image.
function toUrl(path) {
  if (!path) return null;
  const filename = path.split(/[/\\]/).pop();
  return `/satellite-cache/${filename}`;
}

export default function SatelliteCompare({ data }) {
  const frameRef = useRef(null);
  const [reveal, setReveal] = useState(50);
  const [imgError, setImgError] = useState(false);
  const dragging = useRef(false);

  const beforeUrl = toUrl(data.before_image_path);
  const afterUrl = toUrl(data.after_image_path);

  function updateFromClientX(clientX) {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setReveal(pct);
  }

  function onPointerDown(e) {
    dragging.current = true;
    updateFromClientX(e.clientX);
  }
  function onPointerMove(e) {
    if (dragging.current) updateFromClientX(e.clientX);
  }
  function stopDrag() {
    dragging.current = false;
  }

  if (imgError || !beforeUrl || !afterUrl) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <div className="empty">
          Satellite imagery not available locally for this project yet — the cache or fallback
          tile hasn't been populated. The change-detection metadata below is still live.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="sat-frame"
        ref={frameRef}
        style={{ "--reveal": `${reveal}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        <img src={beforeUrl} alt="Before" onError={() => setImgError(true)} />
        <img src={afterUrl} alt="After" className="after-layer" onError={() => setImgError(true)} />
        {data.detected_change_box && (
          <div
            className="sat-change-box"
            style={{
              left: `${data.detected_change_box.x_pct}%`,
              top: `${data.detected_change_box.y_pct}%`,
              width: `${data.detected_change_box.w_pct}%`,
              height: `${data.detected_change_box.h_pct}%`,
            }}
          >
            <span className="sat-change-box-label mono">
              Strongest change
            </span>
          </div>
        )}
        <div className="sat-handle" />
        <span className="sat-tag before mono">{data.before_date}</span>
        <span className="sat-tag after mono">{data.after_date}</span>
      </div>
      <div className="sat-meta">
        <span>
          Source: <span className="mono">{data.image_source}</span>
        </span>
        {data.cloud_cover_after != null && (
          <span>
            Cloud cover: <span className="mono">{data.cloud_cover_after}%</span>
          </span>
        )}
        {data.copernicus_browser_url && (
          <a href={data.copernicus_browser_url} target="_blank" rel="noreferrer">
            View in Copernicus Browser →
          </a>
        )}
      </div>
      {data.detected_change_box ? (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, maxWidth: "68ch" }}>
          Highlighted box is computed directly from these two images (grayscale pixel-difference
          across a 24×24 grid, largest connected cluster of change), searched only within this
          site's known extent — not the full frame — so a river, tide line, or seasonal vegetation
          elsewhere in the image can't be mistaken for construction change.
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, maxWidth: "68ch" }}>
          No localized change region detected for this pair — either the images are near-identical,
          or this project doesn't have a project-specific before/after pair cached yet.
        </div>
      )}
    </div>
  );
}
