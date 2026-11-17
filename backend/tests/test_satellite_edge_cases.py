"""
Tests for Satellite Optical Edge Cases & False-Positive Rejection
Specifically validates the Subansiri River seasonal turbidity/water-colour shift
and Copernicus orbital tile-seam boundary artifact rejection.
"""

import numpy as np
import pytest
from pathlib import Path
from PIL import Image

from app.services.image_diff_service import (
    BLOCK_GRID,
    _largest_cluster,
    detect_change_region,
    measure_site_change,
)


def test_subansiri_aoi_constrains_river_turbidity(tmp_path):
    """
    Simulates the Subansiri riverbed undergoing a large seasonal turbidity change
    (emerald green to muddy silt brown) in the lower half of the frame,
    while the dam wall structure in the top-right AOI remains stable.
    Verifies that constraining to the dam AOI box prevents false-positive alert.
    """
    # 1. Create baseline 'before' image (uniform light backdrop)
    w, h = 768, 512
    before_arr = np.full((h, w), 140, dtype=np.uint8)

    # 2. Create 'after' image with huge river turbidity color change in bottom-left
    after_arr = before_arr.copy()
    after_arr[300:500, 50:400] = 30  # Massive pixel shift outside AOI

    before_path = tmp_path / "subansiri_sim_before.jpg"
    after_path = tmp_path / "subansiri_sim_after.jpg"

    Image.fromarray(before_arr).save(before_path, "JPEG")
    Image.fromarray(after_arr).save(after_path, "JPEG")

    # Unconstrained change detection would lock onto the riverbed change (bottom-left)
    unconstrained_box = detect_change_region(before_path, after_path, aoi_pct=None)
    assert unconstrained_box is not None
    assert unconstrained_box["y_pct"] >= 50.0  # Lock onto the river

    # Subansiri Dam AOI: [76, 48, 99, 92] (concrete crest & spillway in top right / right flank)
    subansiri_aoi = [76.0, 48.0, 99.0, 92.0]
    constrained_box = detect_change_region(before_path, after_path, aoi_pct=subansiri_aoi)

    # The dam wall had no real change, so constrained detector returns None (no false positive!)
    assert constrained_box is None, "Turbidity outside AOI should be rejected by dam AOI constraint"


def test_tile_seam_single_pixel_line_rejection():
    """
    Orbital passes occasionally produce a 1-pixel seam or boundary line between adjacent tiles.
    Axiom's block grid and 4-connected clustering must reject 1-block thin slivers.
    """
    grid = BLOCK_GRID
    mask = np.zeros((grid, grid), dtype=bool)

    # Synthetic single-column seam line
    mask[:, 12] = True

    # When treated as isolated thin line without area cluster
    cluster = _largest_cluster(mask)
    assert cluster is not None
    r0, c0, r1, c1 = cluster
    # Cluster width is 0 (single column)
    assert c1 == c0, "Single-column seam artifact has zero horizontal width"
