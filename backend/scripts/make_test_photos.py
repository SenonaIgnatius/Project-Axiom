"""
Makes TEST copies of a photo with location/time metadata set, so the photo
integrity checks can be demonstrated without a trip to the site.

    python scripts/make_test_photos.py <any_photo.jpg> [PROJECT_ID]

Writes to data/test_photos/:
  <id>_TEST_on_site.jpg   GPS ~1 km from the site, taken 10 days ago  -> verified
  <id>_TEST_elsewhere.jpg GPS in Chennai, taken 10 days ago           -> flagged (location)
  <id>_TEST_old.jpg       GPS on site, taken 3 years ago              -> flagged (time)

These are test fixtures, NOT evidence: the file names say TEST and the
metadata is written by this script. Say so if you show them in a demo.
"""
import sys
from datetime import datetime, timedelta
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.demo_registry import DEMO_SITES  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "data" / "test_photos"


def _dms(x: float):
    x = abs(x)
    d = int(x); m = int((x - d) * 60); s = round(((x - d) * 60 - m) * 60, 2)
    return (Fraction(d), Fraction(m), Fraction(s).limit_denominator(100))


def write(src: Path, dst: Path, lat: float, lng: float, taken: datetime, transform=None):
    img = Image.open(src).convert("RGB")
    if transform:
        img = transform(img)
    exif = Image.Exif()
    exif[0x010F] = "TEST"                      # Make
    exif[0x0110] = "make_test_photos.py"       # Model — marks the file as a fixture
    exif[0x0132] = taken.strftime("%Y:%m:%d %H:%M:%S")
    exif.get_ifd(0x8769)[0x9003] = taken.strftime("%Y:%m:%d %H:%M:%S")
    gps = exif.get_ifd(0x8825)
    gps[1] = "N" if lat >= 0 else "S"; gps[2] = _dms(lat)
    gps[3] = "E" if lng >= 0 else "W"; gps[4] = _dms(lng)
    img.save(dst, "JPEG", quality=90, exif=exif)
    print("wrote", dst.name)


def _generate_sample_image(path: Path):
    """Creates a sample construction site test image if none was provided."""
    from PIL import ImageDraw
    img = Image.new("RGB", (640, 480), color=(135, 170, 210))
    d = ImageDraw.Draw(img)
    # Ground / earthworks
    d.rectangle([0, 260, 640, 480], fill=(139, 105, 70))
    # Concrete foundation slab
    d.rectangle([80, 280, 560, 360], fill=(180, 180, 180), outline=(100, 100, 100), width=3)
    # Steel pillars / scaffolding structure
    for x in range(120, 540, 70):
        d.rectangle([x, 150, x + 16, 280], fill=(160, 120, 50), outline=(90, 60, 20), width=2)
    # Crane tower
    d.rectangle([480, 70, 500, 280], fill=(220, 160, 30))
    d.line([380, 90, 560, 90], fill=(220, 160, 30), width=4)
    # Banner
    d.text((20, 20), "AXIOM - ON-SITE VISION AUDIT TEST FIXTURE", fill=(255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=95)
    return path


def main():
    if len(sys.argv) < 2:
        default_sample = OUT / "sample_base.jpg"
        print(f"No source image provided. Generating sample construction image at {default_sample}...")
        _generate_sample_image(default_sample)
        src = default_sample
        pid = "PS-RD-1088"
    else:
        src = Path(sys.argv[1])
        if not src.exists():
            print(f"File {src} not found. Generating sample construction image...")
            _generate_sample_image(src)
        pid = sys.argv[2] if len(sys.argv) > 2 else "PS-RD-1088"
    site = next((s for s in DEMO_SITES if s["id"] == pid), None)
    if not site:
        sys.exit(f"Unknown project {pid}")
    OUT.mkdir(parents=True, exist_ok=True)
    recent = datetime.now() - timedelta(days=10)
    # Mirrored/flipped variants so the duplicate check doesn't match the fixtures to each other.
    write(src, OUT / f"{pid}_TEST_on_site.jpg", site["lat"] + 0.008, site["lng"] + 0.004, recent)
    write(src, OUT / f"{pid}_TEST_elsewhere.jpg", 13.0827, 80.2707, recent, ImageOps.mirror)
    write(src, OUT / f"{pid}_TEST_old.jpg", site["lat"], site["lng"], datetime.now() - timedelta(days=3 * 365), ImageOps.flip)


if __name__ == "__main__":
    main()
