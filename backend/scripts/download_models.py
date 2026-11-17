"""
Axiom — Download & Verify Pre-Trained Computer Vision Weights
Usage:
    python backend/scripts/download_models.py

Checks backend/data/models/ for:
  - yolov8_construction_cls.pt (YOLOv8 Classifier on construction site states)
  - yolov8_construction_detect.pt (YOLOv8 Roboflow Detector for machinery & safety assets)

Verifies SHA-256 checksums. If missing, attempts to download from GitHub Releases.
"""

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "data" / "models"

EXPECTED_MODELS = {
    "yolov8_construction_cls.pt": {
        "sha256": "5c15f4463a3c080fb4443a7d07bc721d15a99cd352f66464be8848d4646739f2",
        "size_bytes": 2963912,
        "url": "https://github.com/SenonaIgnatius/Project-Axiom/releases/download/v1.0.0/yolov8_construction_cls.pt",
    },
    "yolov8_construction_detect.pt": {
        "sha256": "7ce6e826c98acce030d401c6c5afc6693f105aae51b8ddb3d31e0059c763d6ef",
        "size_bytes": 6209322,
        "url": "https://github.com/SenonaIgnatius/Project-Axiom/releases/download/v1.0.0/yolov8_construction_detect.pt",
    },
}


def compute_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest().lower()


def main():
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    all_ok = True

    print(f"Checking model weights in {MODELS_DIR}...")
    for filename, meta in EXPECTED_MODELS.items():
        dest = MODELS_DIR / filename
        expected_sha = meta["sha256"].lower()

        if dest.exists() and dest.stat().st_size > 0:
            actual_sha = compute_sha256(dest)
            if actual_sha == expected_sha:
                print(f"  [OK] {filename} is present and verified (SHA-256: {actual_sha[:12]}...)")
                continue
            else:
                print(f"  [MISMATCH] {filename} checksum mismatch (found {actual_sha[:12]}, expected {expected_sha[:12]}). Redownloading...")

        # Download if missing or corrupted
        print(f"  Downloading {filename} from {meta['url']}...")
        try:
            urllib.request.urlretrieve(meta["url"], dest)
            actual_sha = compute_sha256(dest)
            if actual_sha == expected_sha:
                print(f"  [DOWNLOADED] {filename} verified successfully.")
            else:
                print(f"  [WARNING] Downloaded {filename} but SHA-256 did not match expected hash.")
                all_ok = False
        except Exception as e:
            print(f"  [ERROR] Could not download {filename}: {e}")
            print(f"  Please manually place '{filename}' in {MODELS_DIR}/ or attach it to the GitHub Release.")
            all_ok = False

    if all_ok:
        print("\nAll model weights ready for vision inference.")
        sys.exit(0)
    else:
        print("\nNote: Fallback base YOLOv8 model will be used if custom weights are missing.")
        sys.exit(1)


if __name__ == "__main__":
    main()
