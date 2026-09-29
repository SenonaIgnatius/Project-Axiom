"""
Renders the PAIMANA flash-report page a project's reported figures came from,
with that project's table row highlighted, so anyone can check the number
against the government source without taking our word for it.
"""

import logging
from pathlib import Path
from typing import Optional, Tuple

import pdfplumber
from PIL import Image

from app.config import settings

logger = logging.getLogger("axiom-source-page")

PDF_PATH = settings.DATA_DIR / "paimana" / "flash_report.pdf"
CACHE_DIR = settings.DATA_DIR / "paimana" / "pages"
RESOLUTION = 110


def _find_row(page, project_code: str):
    """(row_bbox, header_bottom) for the table row containing the project code."""
    px0, ptop, px1, pbottom = page.bbox
    for table in page.find_tables():
        rows = [r for r in table.rows if r.bbox]
        for row in rows:
            x0, top, x1, bottom = row.bbox
            # Some pages carry a background "table" whose rows extend off-page; skip those
            if top < ptop or bottom > pbottom or x0 < px0 or x1 > px1 or (bottom - top) > 250:
                continue
            text = page.crop(row.bbox).extract_text() or ""
            if project_code in text.replace(" ", ""):
                header_bottom = rows[0].bbox[3] if rows and rows[0].bbox[3] < top else None
                return row.bbox, header_bottom
    for w in page.extract_words():
        if project_code in w["text"]:
            return (px0 + 20, w["top"] - 4, px1 - 20, w["bottom"] + 4), None
    return None, None


def render_source_page(project_code: str, page_no: int, full: bool = False) -> Optional[Path]:
    """
    full=False: a readable excerpt — the page banner and column headers, then the
    project's highlighted row with a little context. full=True: the whole page.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"{project_code}_p{page_no}{'' if full else '_excerpt'}.png"
    if out.exists():
        return out
    try:
        with pdfplumber.open(PDF_PATH) as pdf:
            if not (1 <= page_no <= len(pdf.pages)):
                return None
            page = pdf.pages[page_no - 1]
            bbox, header_bottom = _find_row(page, project_code)
            im = page.to_image(resolution=RESOLUTION)
            if bbox:
                im.draw_rect(bbox, fill=(255, 181, 71, 70), stroke=(230, 120, 0), stroke_width=3)
            else:
                logger.warning(f"Row for {project_code} not located on page {page_no}")
            img = im.annotated.convert("RGB")

            if not full and bbox:
                scale = RESOLUTION / 72.0
                w, h = img.size
                ctx_top = max(0, int((bbox[1] - 45) * scale))
                ctx_bottom = min(h, int((bbox[3] + 45) * scale))
                parts = []
                if header_bottom and header_bottom * scale < ctx_top:
                    parts.append(img.crop((0, 0, w, int((header_bottom + 2) * scale))))
                    sep = Image.new("RGB", (w, 10), (205, 210, 218))
                    parts.append(sep)
                    parts.append(img.crop((0, ctx_top, w, ctx_bottom)))
                else:
                    parts.append(img.crop((0, 0, w, ctx_bottom)))
                total_h = sum(p.size[1] for p in parts)
                canvas = Image.new("RGB", (w, total_h), (255, 255, 255))
                y = 0
                for part in parts:
                    canvas.paste(part, (0, y))
                    y += part.size[1]
                img = canvas

            img.save(out, format="PNG")
        return out
    except Exception as e:
        logger.warning(f"Could not render page {page_no} for {project_code}: {e}")
        return None
