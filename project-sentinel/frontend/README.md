# Sentinel frontend

A dashboard for the Project Sentinel backend. Built around one idea: put reported
progress and independently verified progress side by side everywhere, so the gap
speaks for itself without needing any ML background to read.

## What's here

- **Project register** — every monitored project, risk-badged, with a headline stat
  on how many show a flagged discrepancy right now.
- **Project detail** — reported vs. verified progress comparison, a draggable
  before/after satellite slider, live photo upload → YOLOv8 verification, the full
  weighted risk-factor breakdown, and rainfall exposure.

## Running it

Needs the backend running first (`uvicorn app.main:app --reload --port 8000` from
`project-sentinel/backend`).

```bash
cd project-sentinel/frontend
npm install
npm run dev
```

Opens at http://localhost:5173. `vite.config.js` proxies `/api`, `/uploads` and
`/satellite-cache` to the backend on :8000, so no CORS setup or `.env` needed for
local dev.

## One backend gap this surfaces

`SatelliteCompare` derives image URLs from `before_image_path` / `after_image_path`
and expects them servable at `/satellite-cache/<filename>` (which `app/main.py`
already mounts). That works once the cache has real entries. The *fallback* static
tiles the satellite router falls back to, though, live under a `sentinel/public/satellite/`
path that isn't mounted as static files anywhere in `main.py` — so until either that
folder is mounted too, or its contents are moved into the already-mounted
`satellite_cache` dir, the fallback case will show the "imagery not available yet"
state instead of an image. Worth fixing on the backend side before a demo where a
project might not have cached imagery.
