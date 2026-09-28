"""
Project Sentinel — Satellite Image-Diff Change Detector.

Runs an actual pixel-level comparison of the two cached before/after JPEGs
for a project (not a simulation) and returns a bounding box around the
region with the most significant visual change, so a viewer doesn't have
to eyeball the before/after slider to spot it.

Method (deliberately simple and dependency-light — no OpenCV/scipy needed):
1. Grayscale both images, resize `after` to `before`'s size if they differ.
2. Split into a coarse grid of blocks; compute mean absolute pixel
   difference per block.
3. Threshold blocks whose difference is well above the image's own
   background noise level (mean + k*std of all block scores).
4. Take the bounding box of the largest 4-connected cluster of
   above-threshold blocks (flood fill), rather than the bbox of every
   scattered hot pixel — this avoids a box that balloons to the whole
   image from lighting/compression noise.
5. Return the box as percentages of image width/height, plus a
   change-intensity score, so the frontend can overlay it regardless of
   how the image is actually rendered on screen.
"""

import logging
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import numpy as np
from PIL import Image

logger = logging.getLogger("sentinel-image-diff")

BLOCK_GRID = 24  # blocks per axis


def _load_gray(path: Path) -> np.ndarray:
    img = Image.open(path).convert("L")
    return np.asarray(img, dtype=np.float32)


def _largest_cluster(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """4-connected flood fill over a small boolean grid; returns (r0,c0,r1,c1) of the largest cluster."""
    rows, cols = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best: Optional[List[Tuple[int, int]]] = None

    for sr in range(rows):
        for sc in range(cols):
            if not mask[sr, sc] or seen[sr, sc]:
                continue
            stack = [(sr, sc)]
            seen[sr, sc] = True
            cluster = []
            while stack:
                r, c = stack.pop()
                cluster.append((r, c))
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not seen[nr, nc]:
                        seen[nr, nc] = True
                        stack.append((nr, nc))
            if best is None or len(cluster) > len(best):
                best = cluster

    if not best:
        return None
    rs = [p[0] for p in best]
    cs = [p[1] for p in best]
    return min(rs), min(cs), max(rs), max(cs)


# Thresholds for calling change "site-specific" (tuned on the 10 demo pairs;
# see measure_site_change). A site only counts as showing construction-like
# change when it changed clearly MORE than the land around it.
STRONG_RATIO, STRONG_AREA = 1.3, 15.0
WEAK_RATIO = 1.1


def _aoi_mask(aoi_pct: Optional[List[float]], grid: int) -> Optional[np.ndarray]:
    if not aoi_pct or len(aoi_pct) != 4:
        return None
    x1, y1, x2, y2 = aoi_pct
    x1, x2 = min(x1, x2), max(x1, x2)
    y1, y2 = min(y1, y2), max(y1, y2)
    m = np.zeros((grid, grid), dtype=bool)
    m[max(0, int(y1 / 100 * grid)):min(grid, int(np.ceil(y2 / 100 * grid))),
      max(0, int(x1 / 100 * grid)):min(grid, int(np.ceil(x2 / 100 * grid)))] = True
    return m if m.any() and not m.all() else None


def measure_site_change(
    before_path: Path,
    after_path: Path,
    aoi_pct: Optional[List[float]],
) -> Optional[Dict[str, Any]]:
    """
    Real, measured signal: did the site area change more than its surroundings?

    Pixel change alone can't tell construction from season, lighting or haze —
    those change the whole frame. So the after image is first brightness-matched
    to the before image, and the site's change is compared with the change in
    the land around it:

      ratio        = mean block difference inside the site / outside it
      changed_area = % of site blocks above the surroundings' own noise level
                     (median + 2·std of the outside blocks)

    This is evidence of *whether* the site changed, not a % complete: a pixel
    diff cannot measure construction progress, and the result is never
    presented as one.
    """
    try:
        b_img = Image.open(before_path)
        a_img = Image.open(after_path)
        if a_img.size != b_img.size:
            a_img = a_img.resize(b_img.size)
        b = np.asarray(b_img.convert("L"), dtype=np.float32)
        a = np.asarray(a_img.convert("L"), dtype=np.float32)
    except Exception as e:
        logger.warning(f"Could not read imagery for site-change measure: {e}")
        return None

    grid = BLOCK_GRID
    mask = _aoi_mask(aoi_pct, grid)
    if mask is None:
        return None

    # Brightness/contrast match: removes frame-wide illumination/season shifts.
    a = (a - a.mean()) / (a.std() or 1.0) * b.std() + b.mean()
    d = np.abs(a - b)
    h, w = d.shape
    bh, bw = h // grid, w // grid
    if bh == 0 or bw == 0:
        return None
    scores = d[: bh * grid, : bw * grid].reshape(grid, bh, grid, bw).mean(axis=(1, 3))

    inside, outside = scores[mask], scores[~mask]
    ratio = float(inside.mean() / (outside.mean() or 1e-6))
    noise = float(np.median(outside) + 2 * outside.std())
    changed_area = float((inside > noise).mean() * 100.0)

    if ratio >= STRONG_RATIO and changed_area >= STRONG_AREA:
        level, text = "strong", "The site area changed clearly more than the land around it."
    elif ratio >= WEAK_RATIO:
        level, text = "weak", "The site area changed somewhat more than the land around it."
    else:
        level, text = "none", ("The site area changed no more than the land around it, so the change "
                               "can't be told apart from season, lighting or haze.")

    return {
        "site_vs_surroundings_ratio": round(ratio, 2),
        "site_changed_area_pct": round(changed_area, 1),
        "evidence_level": level,
        "evidence_text": text,
        "method": ("brightness-matched grayscale block diff (24x24); site-area change compared "
                   "with change in the surrounding frame"),
        "data_source": "derived:pixel_comparison_of_cached_images",
    }


def detect_change_region(
    before_path: Path,
    after_path: Path,
    aoi_pct: Optional[List[float]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Returns a dict with a bounding box (as % of image width/height) around
    the most significant real change between the two images, or None if the
    images can't be read or show no meaningful localized change.

    aoi_pct, if given, is [x1, y1, x2, y2] as percentages of the frame —
    the already-known rough extent of the project site. Raw pixel-diffing
    over a full satellite frame is dominated by whatever changes the most
    between the two dates, which in practice is very often a river's water
    level/sediment or seasonal vegetation, not the (usually much smaller)
    construction change. Restricting the search to the known site AOI avoids
    the diff wandering off into unrelated background change elsewhere in
    frame.
    """
    try:
        before_img = Image.open(before_path)
        after_img = Image.open(after_path)
        before_gray = np.asarray(before_img.convert("L"), dtype=np.float32)
        if after_img.size != before_img.size:
            after_img = after_img.resize(before_img.size)
        after_gray = np.asarray(after_img.convert("L"), dtype=np.float32)
    except Exception as e:
        logger.warning(f"Could not read imagery for diffing ({before_path}, {after_path}): {e}")
        return None

    h, w = before_gray.shape
    diff = np.abs(after_gray - before_gray)

    grid = BLOCK_GRID
    bh, bw = h // grid, w // grid
    if bh == 0 or bw == 0:
        return None

    block_scores = np.zeros((grid, grid), dtype=np.float32)
    for r in range(grid):
        for c in range(grid):
            block = diff[r * bh:(r + 1) * bh, c * bw:(c + 1) * bw]
            block_scores[r, c] = float(block.mean())

    # Restrict eligibility to the known project AOI, if we have one, so a big
    # unrelated environmental change elsewhere in frame (river, tide line,
    # seasonal vegetation) can never win over the actual site.
    eligible = np.ones((grid, grid), dtype=bool)
    if aoi_pct and len(aoi_pct) == 4:
        x1, y1, x2, y2 = aoi_pct
        # Some seed AOI entries have their min/max flipped on one axis — normalize
        # rather than trust the given order, so a malformed box still constrains
        # the search instead of silently falling back to the full frame.
        x1, x2 = min(x1, x2), max(x1, x2)
        y1, y2 = min(y1, y2), max(y1, y2)
        c0 = int((x1 / 100.0) * grid)
        c1 = int(np.ceil((x2 / 100.0) * grid))
        r0 = int((y1 / 100.0) * grid)
        r1 = int(np.ceil((y2 / 100.0) * grid))
        eligible[:, :] = False
        eligible[max(0, r0):min(grid, r1), max(0, c0):min(grid, c1)] = True
        if not eligible.any():
            eligible[:, :] = True  # still nothing selected (e.g. zero-area box) — fall back to full frame

    in_aoi_scores = block_scores[eligible]
    mean_score = float(in_aoi_scores.mean())
    std_score = float(in_aoi_scores.std())
    threshold = mean_score + 1.25 * std_score
    mask = (block_scores > max(threshold, 8.0)) & eligible  # floor so near-identical images don't false-positive

    if not mask.any():
        return None

    cluster = _largest_cluster(mask)
    if cluster is None:
        return None
    r0, c0, r1, c1 = cluster

    # Pad the box by half a block on each side so it doesn't hug the edges too tightly.
    r0 = max(0, r0 - 0)
    c0 = max(0, c0 - 0)
    r1 = min(grid - 1, r1 + 1)
    c1 = min(grid - 1, c1 + 1)
    # Keep the padded box inside the site area it was searched in.
    rows_in = np.where(eligible.any(axis=1))[0]
    cols_in = np.where(eligible.any(axis=0))[0]
    r0, r1 = max(r0, int(rows_in.min())), min(r1, int(rows_in.max()))
    c0, c1 = max(c0, int(cols_in.min())), min(c1, int(cols_in.max()))

    x_pct = (c0 / grid) * 100.0
    y_pct = (r0 / grid) * 100.0
    w_pct = ((c1 - c0 + 1) / grid) * 100.0
    h_pct = ((r1 - r0 + 1) / grid) * 100.0

    changed_block_count = int(mask.sum())
    change_area_pct = (changed_block_count / (grid * grid)) * 100.0

    return {
        "x_pct": round(x_pct, 1),
        "y_pct": round(y_pct, 1),
        "w_pct": round(min(w_pct, 100.0 - x_pct), 1),
        "h_pct": round(min(h_pct, 100.0 - y_pct), 1),
        "change_area_pct": round(change_area_pct, 1),
        "mean_pixel_diff": round(mean_score, 2),
        "method": ("grayscale block-diff (24x24 grid) + largest connected cluster, real pixel comparison"
                    + (", restricted to known site AOI" if aoi_pct else "")),
    }
