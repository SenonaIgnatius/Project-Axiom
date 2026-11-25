"""
Makes a hand-check sheet for the Report Audit: a random sample of flagged
projects, each with its PAIMANA code and PDF page, and empty columns for a
person to fill in after opening that page of data/paimana/flash_report.pdf.

    python scripts/make_audit_handcheck_sheet.py          # 50 rows (default)
    python scripts/make_audit_handcheck_sheet.py 30

Writes data/paimana/audit_handcheck.csv. Open it in Excel / Google Sheets, check
each row against the PDF, and fill in:
    checked_by        your name
    pdf_matches       yes / no   (do the PDF's figures match the extracted ones?)
    flag_is_genuine   yes / no   (is the contradiction really in the report?)
    notes             anything odd (merged cells, footnotes, OCR issues …)

Only a sheet filled in this way may be described as "hand-checked".
"""
import csv
import json
import random
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.routers.insights import _dq_flags  # same six rules the app uses  # noqa: E402

DATA = ROOT / "data" / "paimana" / "paimana_projects.json"
OUT = ROOT / "data" / "paimana" / "audit_handcheck.csv"
REF = date(2025, 12, 31)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    rows = json.load(open(DATA, encoding="utf-8"))["projects"]
    flagged = [(r, _dq_flags(r, REF)) for r in rows]
    flagged = [(r, f) for r, f in flagged if f]
    sample = random.Random(2026).sample(flagged, min(n, len(flagged)))
    sample.sort(key=lambda rf: (rf[0].get("source_page") or 0))
    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["project_code", "name", "pdf_page", "flags", "original_cost_cr", "revised_cost_cr",
                    "expenditure_cr", "physical_progress_pct", "original_completion", "revised_completion",
                    "checked_by", "pdf_matches", "flag_is_genuine", "notes"])
        for r, f in sample:
            w.writerow([r["project_code"], r.get("name"), r.get("source_page"), "; ".join(f),
                        r.get("original_cost_cr"), r.get("revised_cost_cr"), r.get("expenditure_cr"),
                        r.get("physical_progress_pct"), r.get("original_completion"), r.get("revised_completion"),
                        "", "", "", ""])
    print(f"{len(sample)} of {len(flagged)} flagged projects written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
