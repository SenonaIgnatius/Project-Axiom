"""
Extracts every row of the "All Ongoing Projects" tables from MoSPI PAIMANA
flash reports into clean JSON, keeping the page each row came from so any
figure can be traced back to its source page.

Columns in the report (Dec 2025 edition):
  Sl.No | Project Name (Agency) (Project Code) | State |
  Date of Approval (Start Date) | Original/Target DoC (Revised DoC) |
  Original Cost (Revised Cost) | Cumulative Expenditure | Physical Progress (%)

Each project also carries the report's own ministry and category headings
(e.g. "Ministry of Power" / "Electricity Generation"), which is where its
sector comes from — nothing is guessed from the project name.

Usage (from backend/):
  python scripts/extract_paimana_dataset.py                 # data/paimana/flash_report.pdf
  python scripts/extract_paimana_dataset.py a.pdf b.pdf ... # several monthly editions

Writes data/paimana/editions/paimana_<YYYY-MM>.json per edition, and the
newest edition also to data/paimana/paimana_projects.json (what the app reads).
Drop older monthly flash reports in and re-run to build real history.
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
PAIMANA_DIR = ROOT / "data" / "paimana"
DEFAULT_PDF = PAIMANA_DIR / "flash_report.pdf"
EDITIONS_DIR = PAIMANA_DIR / "editions"
LATEST_PATH = PAIMANA_DIR / "paimana_projects.json"

HEADER_KEY = "project name (agency) (project code)"
PAIR = re.compile(r"^\s*([^()]*?)\s*(?:\(([^()]*)\))?\s*$")
MONTHS = {m: i for i, m in enumerate(
    ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
     "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"], start=1)}
EDITION_RE = re.compile(r"\b(" + "|".join(MONTHS) + r")\s+(20\d\d)\b")

# The report's category headings, mapped to the app's four sectors.
# Anything else (coal mines, oil & gas, hospitals, ...) is "Other".
CATEGORY_SECTOR = {
    "roads & highways": "Roads",
    "railways": "Railways",
    "urban public transport": "Railways",
    "electricity generation": "Power",
    "transmission & distribution": "Power",
    "energy storage": "Power",
    "water resources": "Water",
    "waste & water": "Water",
}


def clean(cell):
    return re.sub(r"\s+", " ", (cell or "").replace("\n", " ")).strip()


def split_pair(cell):
    """'09/2016 (03/2018)' -> ('09/2016', '03/2018');  '2002 (2002)' -> ('2002', '2002')."""
    m = PAIR.match(clean(cell))
    if not m:
        return clean(cell) or None, None
    a, b = (m.group(1) or "").strip(), (m.group(2) or "").strip()
    return (a or None), (None if b in ("", "-") else b)


def to_num(s):
    if s is None:
        return None
    s = s.replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def split_name(cell):
    """'Name (Agency) (602961)' -> (name, agency, code). Agency may itself contain brackets."""
    text = clean(cell)
    m = re.search(r"\((\d{5,7})\)\s*$", text)
    if not m:
        return text, None, None
    code = m.group(1)
    rest = text[: m.start()].rstrip()
    depth, start = 0, None
    for i in range(len(rest) - 1, -1, -1):
        ch = rest[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                start = i
                break
    if start is not None and rest.endswith(")"):
        return rest[:start].strip(), rest[start + 1:-1].strip(), code
    return rest, None, code


def detect_edition(pdf):
    """'DECEMBER 2025' on the report pages -> '2025-12'."""
    for page in pdf.pages[:20]:
        m = EDITION_RE.search((page.extract_text() or "").upper())
        if m:
            return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"
    return None


def extract(pdf_path: Path):
    rows_out = []
    ministry, category = None, None
    with pdfplumber.open(pdf_path) as pdf:
        edition = detect_edition(pdf)
        for page_no, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables() or []:
                # Find the header row wherever it sits: on some pages the page banner
                # is merged into the table and the columns are shifted by a spacer.
                header_at, name_col = None, None
                for i, r in enumerate(table or []):
                    for j, c in enumerate(r):
                        if clean(c).lower().startswith(HEADER_KEY):  # the header cell itself, not a merged text blob
                            header_at, name_col = i, j
                            break
                    if header_at is not None:
                        break
                if header_at is None or name_col < 1:
                    continue
                for row in table[header_at + 1:]:
                    cols = (row + [None] * 12)[name_col - 1: name_col + 7]
                    if len(cols) < 8:
                        continue
                    sl, name_cell, state, approval, doc, cost, exp, prog = cols
                    name, agency, code = split_name(name_cell)
                    if not code:
                        # Heading rows carry text only in the name column.
                        others = [clean(c) for c in (sl, state, approval, doc, exp, prog)]
                        heading = clean(name_cell)
                        if heading and not any(others) and not heading.lower().startswith("total"):
                            if heading.startswith(("Ministry of", "Department of", "Department for")):
                                ministry, category = heading, None
                            else:
                                category = heading
                        continue
                    appr, start = split_pair(approval)
                    doc_orig, doc_rev = split_pair(doc)
                    cost_orig, cost_rev = split_pair(cost)
                    rows_out.append({
                        "project_code": code,
                        "name": name,
                        "agency": agency,
                        "state": clean(state) or None,
                        "ministry": ministry,
                        "category": category,
                        "sector": CATEGORY_SECTOR.get((category or "").lower(), "Other"),
                        "approval_date": appr,
                        "start_date": start,
                        "original_completion": doc_orig,
                        "revised_completion": doc_rev,
                        "original_cost_cr": to_num(cost_orig),
                        "revised_cost_cr": to_num(cost_rev),
                        "expenditure_cr": to_num(clean(exp)),
                        "physical_progress_pct": to_num(clean(prog)),
                        "source_page": page_no,
                        "source_serial": clean(sl) or None,
                    })

    # A project can appear in more than one listing (e.g. a region table and its
    # sector table). Keep one record per code, remember every page, and prefer
    # the listing that gave it a real sector.
    by_code = {}
    for r in rows_out:
        prev = by_code.get(r["project_code"])
        if prev is None:
            by_code[r["project_code"]] = r
            continue
        prev.setdefault("also_on_pages", []).append(r["source_page"])
        if prev["sector"] == "Other" and r["sector"] != "Other":
            for k in ("ministry", "category", "sector"):
                prev[k] = r[k]

    return {
        "source": f"MoSPI PAIMANA Flash Report ({pdf_path.name})",
        "edition": edition,
        "source_pdf": pdf_path.name,
        "table": "All Ongoing Projects",
        "row_count": len(rows_out),
        "project_count": len(by_code),
        "projects": list(by_code.values()),
    }


def main(argv):
    pdfs = [Path(a) for a in argv] or [DEFAULT_PDF]
    EDITIONS_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for pdf_path in pdfs:
        data = extract(pdf_path)
        tag = data["edition"] or pdf_path.stem
        out = EDITIONS_DIR / f"paimana_{tag}.json"
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        sectors = {}
        for p in data["projects"]:
            sectors[p["sector"]] = sectors.get(p["sector"], 0) + 1
        print(f"{pdf_path.name}: edition {data['edition']} - {data['row_count']} rows -> "
              f"{data['project_count']} projects -> {out.name}  sectors={sectors}")
        results.append(data)

    latest = max(results, key=lambda d: d["edition"] or "")
    # The app's live dataset is always the newest edition extracted so far.
    existing = []
    for f in EDITIONS_DIR.glob("paimana_*.json"):
        existing.append(json.loads(f.read_text(encoding="utf-8")))
    newest = max(existing, key=lambda d: d.get("edition") or "")
    LATEST_PATH.write_text(json.dumps(newest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"live dataset -> {LATEST_PATH.name} (edition {newest.get('edition')})")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
