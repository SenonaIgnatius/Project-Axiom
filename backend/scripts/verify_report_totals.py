"""
Checks the extracted PAIMANA rows against the totals the report itself prints
(Table 1, "Ministry-wise Ongoing Projects", December 2025 edition), so any
extraction error shows up as a mismatch.

    python scripts/verify_report_totals.py
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "paimana" / "paimana_projects.json"

# Printed in the report, Table 1 (₹ crore)
REPORT_TOTALS = {"projects": 1392, "original_cost": 2968248, "revised_cost": 3510920, "expenditure": 1901163}
TOLERANCE_PCT = 1.0  # a few rows print expenditure in merged cells


def extracted_totals():
    rows = json.load(open(DATA, encoding="utf-8"))["projects"]
    return {
        "projects": len(rows),
        "original_cost": round(sum(r.get("original_cost_cr") or 0 for r in rows)),
        "revised_cost": round(sum((r.get("revised_cost_cr") or r.get("original_cost_cr") or 0) for r in rows)),
        "expenditure": round(sum(r.get("expenditure_cr") or 0 for r in rows)),
    }


def main() -> int:
    got = extracted_totals()
    ok = True
    for k, want in REPORT_TOTALS.items():
        diff = (got[k] / want - 1) * 100
        good = abs(diff) <= TOLERANCE_PCT
        ok &= good
        print(f"{'✓' if good else '✗'} {k:14s} report {want:>12,}  extracted {got[k]:>12,}  ({diff:+.2f}%)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
