# Project Sentinel (AXIOM)

Independent progress verification for public infrastructure projects.

Government progress reports (MoSPI PAIMANA flash reports) are self-reported by implementing agencies. Sentinel checks them against evidence the agency doesn't control, which today means site photographs and satellite imagery. It combines the gap between reported and observed progress with budget, schedule, sensor and rainfall signals to produce an explainable 0–100 risk score for each project.

Built for Smart India Hackathon 2026, problem statement **SIH26103**.

## Repository layout

| Folder | What it is |
|---|---|
| `project-sentinel/backend/` | FastAPI backend, risk engine, ML pipeline, PAIMANA extraction |
| `sentinel/` | Main web console (TanStack Start + React 19 + Tailwind v4) |
| `project-sentinel/frontend/` | Earlier React/Vite dashboard, kept as a fallback |

Every figure in the console is labelled by where it comes from: **real** (printed in the PAIMANA report or fetched from a public source), **derived** (computed from real figures), or **simulated / demonstration**. The console's *Provenance* page lists each module and its status.

## What's distinctive

**1. Self-trained YOLOv8 pipeline for site-photo verification** (`app/ml/photo_verifier.py`)
- **Classifier (`yolov8_construction_cls.pt`):** fine-tuned from `yolov8n-cls` to label a site photo as `completed` / `incomplete`. From that label it derives a photo-verified progress estimate and a `photo_gap`, the difference from reported progress.
- **Detector (`yolov8_construction_detect.pt`):** trained on the Roboflow *Construction Site Safety* dataset (CC BY 4.0). It detects machinery, workers and structural elements as supporting evidence.
- **Endpoint:** `POST /api/photos/classify` accepts a photo plus a project ID and returns the label, confidence, verified-progress estimate, and gap against reported progress, with a detection summary in `heuristic_notes`.

**2. Copernicus / Sentinel Hub satellite integration** (`app/services/satellite_imagery_service.py`)
- **Data source:** the official `sentinelhub` SDK against the Copernicus Data Space Ecosystem (CDSE).
- **Before/after search:** the Sentinel-2 L2A catalog is searched for the lowest-cloud scene near the project start date and again in the last 14 days. If nothing is under 30% cloud cover, the search window widens to ±30 days.
- **Output:** true-colour before/after images for each project's area of interest. These are cached to `data/satellite_cache/` and indexed in the `satellite_image_cache` table.
- **Endpoint:** `GET /api/satellite/{project_id}/change-detection` serves the cached imagery and never calls CDSE during a request.

**Also included:**
- **PAIMANA PDF ingestion** (`pdfplumber`): `POST /api/pipeline/ingest-paimana`
- **Transparent weighted risk formula** with a per-factor breakdown: `GET /api/projects/{id}/risk-breakdown`
- **XGBoost delay and cost-overrun model with SHAP explanations**
- **K-means risk clustering**
- **Open-Meteo rainfall exposure**

**Added for the SIH prototype:**
- **Full PAIMANA extraction** (`scripts/extract_paimana_dataset.py`): all 1,392 ongoing projects from the Dec 2025 flash report, sectors taken from the report's own ministry headings, each row keeping the PDF page it came from.
- **Source citation**: every monitored project links to its highlighted row in the real report page (`/api/projects/{id}/source-page`, `/api/paimana/page/{page}`).
- **Report Audit** (`/api/data-quality`): six consistency checks run over every row of the report, flagging rows that contradict themselves.
- **Peer benchmarking** (`/api/benchmark/{id}`), **edition history** (`/api/history/{id}`) and a **what-if simulator** (`/api/scenario`).
- **Photo integrity checks** (`app/services/photo_integrity_service.py`): before a site photo can change a score, its EXIF GPS is checked against the site (radius by sector), its capture time against the project start and the last 180 days, and its perceptual hash against earlier uploads. A flagged photo is still classified but can't move the verified figure. `scripts/make_test_photos.py` makes labelled test copies for demos.
- **Site change vs surroundings** (`measure_site_change`): the after image is brightness-matched to the before image, then change inside the site area is compared with change in the surrounding frame and reported as strong / weak / no site-specific change.
- **Change box on satellite imagery** (`app/services/image_diff_service.py`): a block-wise pixel difference, restricted to the project's site area, marks where the before/after images changed most.
- **Real rainfall** from the Open-Meteo archive (`scripts/fetch_rainfall.py`).
- **Escalation draft** (`POST /api/projects/{id}/escalate`): drafts a notice to the implementing agency. Simulated; nothing is sent.

## Current status and known gaps

Please read this before a demo:

- **Model weights are not in git.** `data/models/` is gitignored. Copy `yolov8_construction_cls.pt` and `yolov8_construction_detect.pt` into `project-sentinel/backend/data/models/`. Without them the classifier falls back to the generic `yolov8n-cls.pt`, which does not produce meaningful completed/incomplete labels.
- **The photo classifier training set is small.** It has 30 training and 10 validation images, trained for 5 epochs.
- **Satellite imagery is served from a committed cache.** `data/satellite_cache/` holds before/after images for the demo sites. `fetch_before_after_images()` exists, but no script in this repo calls it yet to refresh the cache from CDSE, and the capture source of the cached images is not yet confirmed (the API says so).
- **Satellite imagery is evidence of change, not a % complete.** A pixel comparison can't measure construction progress, so it isn't used as one. The *verified progress* figure is an illustrative stand-in (labelled so) until a site photo passes the integrity checks.
- **The predictive risk model is trained on 600 synthetic samples** calibrated to plausible ranges, not on historical outcomes.
- **Sensor telemetry is simulated.** No physical sensors exist. `scripts/generate_sensor_telemetry.py` writes `data/sensors.csv`, with stress levels derived from each project's real PAIMANA delay and budget figures. Assets with no telemetry are reported as unavailable.

## Running it

Requires Python 3.11 (tested on Windows).

```bash
cd project-sentinel/backend
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional: add CDSE_CLIENT_ID / CDSE_CLIENT_SECRET
uvicorn app.main:app --reload --port 8000
```

On first start the app creates `data/sentinel_v3.db` (SQLite) and seeds 10 monitored projects, all real rows from the PAIMANA report. Interactive API docs are at http://127.0.0.1:8000/docs.

Then start the console in a second terminal:

```bash
cd sentinel
npm install
npm run dev                     # set VITE_API_URL if the backend isn't on http://localhost:8000/api
```

Optional data refresh: `python scripts/fetch_rainfall.py` (real rainfall) and `python scripts/generate_sensor_telemetry.py` (simulated telemetry).

The app reads the CDSE credentials with `os.getenv`, so either export them in your shell or load `.env` with your process manager. Credentials are free from https://dataspace.copernicus.eu/.

## Main endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects`, `/api/projects/{id}` | Project register |
| GET | `/api/projects/{id}/risk`, `/api/projects/{id}/risk-breakdown` | Weighted risk score, discrepancy details, XGBoost + SHAP |
| GET | `/api/model-validation` | Clustering / model validation summary |
| POST | `/api/photos/classify` | YOLOv8 site-photo verification |
| GET | `/api/photos/{project_id}` | Photo history for a project |
| GET | `/api/satellite/{id}/change-detection` | Sentinel-2 before/after imagery + change metadata |
| GET | `/api/weather/{project_id}` | Rainfall exposure (Open-Meteo) |
| GET | `/api/assets/{asset_id}/health`, POST `/api/sensors/ingest` | Asset telemetry |
| POST | `/api/pipeline/ingest-paimana` | Parse a PAIMANA flash report PDF |
| GET | `/api/projects/{id}/source-page`, `/api/paimana/page/{page}` | Highlighted source row from the report |
| POST | `/api/projects/{id}/escalate` | Draft an escalation notice (simulated) |
| GET | `/api/data-quality` | Report Audit over all 1,392 rows |
| GET | `/api/benchmark/{id}`, `/api/history/{id}` | Peer benchmark, edition history |
| GET/POST | `/api/scenario/{id}`, `/api/scenario` | What-if risk simulation |
| GET | `/api/paimana/projects` | All 1,392 report projects: search, filters, audit flags, source pages |
| POST | `/api/sensors/simulate/{asset_id}` | Inject a simulated sensor scenario |

## Data credits

- MoSPI PAIMANA flash reports (Government of India)
- Copernicus Sentinel-2 data, provided through the Copernicus Data Space Ecosystem
- Roboflow Universe construction datasets (CC BY 4.0)
- Open-Meteo historical weather archive
#   a x i o m  
 