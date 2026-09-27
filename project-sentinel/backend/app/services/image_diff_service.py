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
