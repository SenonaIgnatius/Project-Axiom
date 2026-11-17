# Project Axiom

> **Independent Progress Verification & Risk Early-Warning Engine for Public Infrastructure**  
> Smart India Hackathon (SIH 2026) — Problem Statement **SIH26103**  
> Built by **Team Nyx** · Repository: [https://github.com/SenonaIgnatius/Project-Axiom](https://github.com/SenonaIgnatius/Project-Axiom)  
> **Repository Topics:** `infrastructure-monitoring`, `satellite-imagery`, `copernicus-sentinel-2`, `yolov8`, `xgboost`, `mospi-paimana`, `sih-2026`, `explainable-ai`

---

## ⚡ 2-Minute Quickstart & Demo

Axiom verifies self-reported government infrastructure project reports (MoSPI PAIMANA flash reports) against evidence implementing agencies do not control: **Copernicus Sentinel-2 Level-2A satellite imagery** and **geotagged on-site computer vision (YOLOv8)**.

### Run Instantly with Docker Compose
```bash
# 1. Clone repo
git clone https://github.com/SenonaIgnatius/Project-Axiom.git
cd Project-Axiom

# 2. Download and verify model weights (SHA-256 validated)
python backend/scripts/download_models.py

# 3. Launch full stack (FastAPI backend on :8000, Web Console on :8080)
docker compose up --build
```
Open **[http://localhost:8080](http://localhost:8080)** in your browser. API docs are available at **[http://localhost:8000/docs](http://localhost:8000/docs)**.

### Local Development Setup
```bash
# Backend (Python 3.11)
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/download_models.py
uvicorn app.main:app --reload --port 8000

# Frontend (Node 20, in a second terminal)
cd ../frontend
npm install
npm run dev -- --port 8080
```

### 2-Minute Photo Integrity & Verification Walkthrough
```bash
# Generate test fixtures (recent on-site photo, wrong location, and expired photo)
python backend/scripts/make_test_photos.py

# Expected test fixtures in backend/data/test_photos/:
#   PS-RD-1088_TEST_on_site.jpg    -> Verified (GPS ~1 km from site, taken 10 days ago)
#   PS-RD-1088_TEST_elsewhere.jpg  -> Rejected by PhotoIntegrityService (GPS in Chennai)
#   PS-RD-1088_TEST_old.jpg        -> Rejected by PhotoIntegrityService (Captured > 180 days ago)
```
1. Open project `PS-RD-1088` (Amritsar–Bathinda Greenfield Highway) in the console.
2. Drag and drop `PS-RD-1088_TEST_on_site.jpg` into the Photo Upload pane.
3. Observe YOLOv8 classify structural elements and machinery, recalculate the photo-verified progress estimate, and dynamically update the transparent composite risk score.

---

## 📊 Real Forward Backtest (Dec 2025 → Aug 2026)

To validate early-warning predictive capabilities beyond cross-sectional metrics, Axiom was evaluated on an **8-month forward backtest across all 1,392 monitored PAIMANA projects**, comparing predictions generated strictly at **December 2025** against actual observed outcomes in **August 2026**.

* Ground Truth Definition: A project slipped if its revised completion date was pushed back by $\ge 3$ months between Dec 2025 and Aug 2026, or if it remained stalled past its target deadline. Base rate of critical slippage across the portfolio: **60.1%**.
* Evaluated against:
  1. **Axiom Early-Warning Model** (Multimodal schedule slippage & expenditure velocity)
  2. **Naive Baseline** (Ranked purely by existing reported delay in months)
  3. **Random Prioritization** (Uniform baseline)

### Empirical Backtest Performance
| Prioritization Cutoff | Projects Flagged ($k$) | Axiom Precision@k | Naive Precision@k | Lift vs Random | Lift vs Naive Baseline |
|---|---|---|---|---|---|
| **Top 5%** | 70 | **65.7%** | 62.9% | **1.09x** | **1.05x** |
| **Top 10%** | 139 | **67.6%** | 66.9% | **1.13x** | **1.01x** |
| **Top 15%** | 209 | **70.3%** | 65.1% | **1.17x** | **1.08x** |
| **Top 20%** | 278 | **64.7%** | 66.5% | **1.08x** | 0.97x |
| **Top 30%** | 418 | **61.2%** | 68.7% | **1.02x** | 0.89x |

* **Overall AUROC:** Axiom = 0.582, Naive = 0.640
* **Average Precision (PR-AUC):** Axiom = **0.645** vs Naive = 0.663
* **Live API Validation:** Accessible at `GET /api/model-validation` (returns empirical backtest report and cross-edition metrics).
* **Model Retraining:** `app/ml/predictive_model.py` is trained directly on the real 1,392 project features and forward edition outcomes, completely replacing synthetic sample generators.
* Run backtest script: `python backend/scripts/run_backtest.py`

---

## 🛰️ Verified Copernicus Sentinel-2 L2A Satellite Integration

Axiom integrates European Space Agency (ESA) Copernicus Sentinel-2 Level-2A (Bottom-Of-Atmosphere) optical surface reflectance imagery at **10m spatial resolution**.

* **Cache Refresh & Verification:** `python backend/scripts/refresh_satellite_cache.py` audits committed imagery, queries Copernicus Data Space Ecosystem (CDSE) metadata, and exports `backend/data/satellite_cache/satellite_metadata.json`.
* **Committed Metadata:** Includes exact Copernicus Product Scene IDs, MGRS orbital tiles, UTC timestamps, and cloud cover metrics (< 5% cloud cover).

### Subansiri River Turbidity & Orbital Tile-Seam False Positive Mitigation
As admitted in field evaluations, the Subansiri Lower Hydroelectric Project (`PS-PW-3390`, code `602096`) features significant seasonal river water-turbidity shifts (emerald green in dry season to silt brown during monsoon) and orbital tile seams. Unconstrained full-frame image difference falsely alerts on river silt rather than construction progress.
Axiom solves this through:
1. **AOI Bounding Box Constraint:** `[76, 48, 99, 92] %` isolates the concrete dam crest and spillway, strictly excluding the downstream water surface.
2. **Site-vs-Surroundings Contrast Ratio (`STRONG_RATIO = 1.3`):** Compares change inside the site area to the background frame. When seasonal silt alters the entire tile, the contrast ratio remains low, preventing false positive alarms.
3. **Automated Test:** Tested and verified in `backend/tests/test_satellite_edge_cases.py`.

---

## 🔍 Report Audit Validation (595 of 1,392 Projects)

Axiom’s Report Consistency Engine audits every row in the MoSPI PAIMANA Flash Report across six deterministic data-quality rules:
1. Progress with ₹0 spent ($\ge 90\%$ physical progress against ₹0 cumulative expenditure)
2. Cumulative spend exceeding revised sanctioned cost
3. Revised completion date earlier than original target date
4. Stalled projects: 0% progress and ₹0 spent $> 1$ year after start date
5. Overdue projects with no revised deadline
6. Projects past revised deadline and incomplete

* **Headline Finding:** **554 to 595 of 1,392 projects** contain self-contradicting or anomalous figures in the official publication.
* **Hand-Checked Audit Sample:** 50 flagged rows across diverse sectors were hand-verified against the raw page tables in `flash_report.pdf`.
* **Confirmation Rate:** **50 / 50 confirmed (100.0% precision)**. Documented in `backend/data/paimana/audit_sample_50.json`.
* Re-run audit verification: `python backend/scripts/validate_report_audit.py`.

---

## 🎯 Computer Vision Benchmark & Weight Sensitivity

### Field-Photo Classifier Benchmark (`scripts/benchmark_photo_pipeline.py`)
* Evaluated across an expanded 120-sample test suite.
* **Architecture:** YOLOv8 Nano Classifier (`yolov8_construction_cls.pt`, 2.96 MB) + YOLOv8 Detector (`yolov8_construction_detect.pt`, 6.21 MB).
* **Latency Profile (Standard CPU):**
  * **Mean Inference Latency:** **118.2 ms / image**
  * **Median (P50):** 112.2 ms
  * **P95 Latency:** 144.4 ms
  * **Throughput:** ~8.5 frames/sec on single CPU thread.

### Weight Sensitivity & Dynamic Renormalization (`scripts/weight_sensitivity_check.py`)
* Baseline formula: $0.30 \times \text{Budget} + 0.30 \times \text{Schedule} + 0.20 \times \text{Discrepancy} + 0.10 \times \text{Sensor} + 0.10 \times \text{Rainfall}$.
* Tested across $\pm 20\%$ perturbations across all 1,392 projects:
  * Schedule-Heavy (35/25/20/10/10): Spearman $\rho = \mathbf{0.9482}$
  * Budget-Heavy (35/25/20/10/10): Spearman $\rho = \mathbf{0.9927}$
  * Discrepancy-Emphasized (25/25/30/10/10): Spearman $\rho = \mathbf{0.9929}$
  * Pure Report Only (50/50/0/0/0): Spearman $\rho = \mathbf{0.9889}$
  * **Mean Correlation:** $\mathbf{\rho = 0.9835}$ (Extremely High Stability).
* **Simulated Sensor Renormalization:** In accordance with audit standards, when physical sensors are unavailable or uninstalled, sensor weight drops to **0.0** and the verifiable weights automatically renormalize to sum to 1.0 ($0.333 \times \text{Budget} + 0.333 \times \text{Schedule} + 0.222 \times \text{Discrepancy} + 0.111 \times \text{Rainfall}$). Simulated sensors can never influence a headline score.

---

## 🗂️ Ranked Queue Across All 1,392 Projects

* While the console features 10 fully enriched multi-modal case studies with before/after optical imagery, the ranked monitoring queue operates across **all 1,392 projects** in the PAIMANA report.
* Projects without optical or sensor telemetry are scored using report-only factors with dynamically renormalized weights ($50\% \text{ Budget Variance} + 50\% \text{ Schedule Slippage}$).
* Accessible via `GET /api/projects` and `GET /api/paimana/projects`.

---

## 🧪 Testing & CI

Continuous Integration runs on GitHub Actions (`.github/workflows/ci.yml`) on every push to `main`:
* Automated checksum validation for computer vision weights (`scripts/download_models.py`)
* Pytest suite covering risk engine renormalization, satellite edge-case rejection, and data quality checks
* Frontend TypeScript compilation and production build check

Run tests locally:
```bash
cd backend
python -m pytest tests/ -p no:cacheprovider -v
```

---

## 📜 License

Project Axiom is open-source under the [MIT License](LICENSE).
MoSPI PAIMANA Flash Report data is published under the Government of India Open Data License.
Roboflow Construction Site Safety dataset used for vision pretraining under CC BY 4.0.
Copernicus Sentinel data processed under the Copernicus Open Access Policy.
