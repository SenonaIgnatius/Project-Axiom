"""
Axiom — Site-photo integrity checks.

Before a photo is allowed to change a project's verified progress, check that
it could plausibly be what it claims to be: a recent photo taken AT the site.
This is what stops anyone from moving a score by uploading a photo from
somewhere else, an old photo, or the same photo twice.

Checks (all from the file itself — nothing is guessed):
  1. Location  — EXIF GPS vs the project's site coordinates (haversine km).
  2. Time      — EXIF capture time vs the project's start date and today.
  3. Duplicate — the same image (by perceptual hash) already uploaded,
                 for this project or any other.

Verdict:
  verified      GPS on site and capture time plausible
  unverifiable  no GPS / no capture time (e.g. WhatsApp strips both) —
                accepted, but labelled as unverified evidence
  flagged       any failed check — the photo is still classified, but it is
                NOT allowed to update the project's verified progress
"""

import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

# A project's coordinate is one representative point. Linear works (roads,
# rail lines, canals) stretch for tens of km, so they get a wider radius.
SITE_RADIUS_KM = {"Roads": 40.0, "Railways": 40.0, "Water": 25.0, "Power": 10.0}
DEFAULT_RADIUS_KM = 15.0
STALE_AFTER_DAYS = 180

_GPS_IFD = 0x8825
_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 0x9003
_DATETIME = 0x0132


def _to_deg(v, ref) -> Optional[float]:
    try:
        d, m, s = (float(x) for x in v)
        deg = d + m / 60.0 + s / 3600.0
        return -deg if str(ref).upper() in ("S", "W") else deg
    except Exception:
        return None


def read_exif(path: Path) -> Dict[str, Any]:
    out: Dict[str, Any] = {"lat": None, "lng": None, "taken_at": None, "camera": None}
    try:
        exif = Image.open(path).getexif()
    except Exception:
        return out
    gps = exif.get_ifd(_GPS_IFD) if exif else {}
    if gps and 2 in gps and 4 in gps:
        out["lat"] = _to_deg(gps[2], gps.get(1, "N"))
        out["lng"] = _to_deg(gps[4], gps.get(3, "E"))
    raw = exif.get_ifd(_EXIF_IFD).get(_DATETIME_ORIGINAL) if exif else None
    raw = raw or (exif.get(_DATETIME) if exif else None)
    if raw:
        try:
            out["taken_at"] = datetime.strptime(str(raw).strip("\x00 "), "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass
    make, model = (exif.get(0x010F), exif.get(0x0110)) if exif else (None, None)
    if make or model:
        out["camera"] = " ".join(str(x).strip("\x00 ") for x in (make, model) if x)
    return out


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def image_hash(path: Path) -> Optional[str]:
    """64-bit difference hash: survives resizing/recompression, so a re-saved copy still matches."""
    try:
        g = np.asarray(Image.open(path).convert("L").resize((9, 8)), dtype=np.int16)
    except Exception:
        return None
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _parse_start(s: Optional[str]) -> Optional[datetime]:
    for fmt in ("%m/%Y", "%Y-%m-%d", "%Y-%m"):
        try:
            return datetime.strptime(s or "", fmt)
        except ValueError:
            continue
    return None


def check_photo(
    path: Path,
    site_lat: Optional[float],
    site_lng: Optional[float],
    sector: Optional[str],
    start_date: Optional[str],
    earlier_uploads: List[Path],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    meta = read_exif(path)
    checks: List[Dict[str, Any]] = []

    # 1. Location
    radius = SITE_RADIUS_KM.get(sector or "", DEFAULT_RADIUS_KM)
    distance = None
    if meta["lat"] is None or site_lat is None or site_lng is None:
        checks.append({"key": "location", "status": "unknown",
                       "text": "No GPS location in the photo, so it can't be placed at the site."})
    else:
        distance = round(haversine_km((meta["lat"], meta["lng"]), (site_lat, site_lng)), 1)
        if distance <= radius:
            checks.append({"key": "location", "status": "pass",
                           "text": f"Taken {distance} km from the site (limit {radius:.0f} km for {sector or 'this'} projects)."})
        else:
            checks.append({"key": "location", "status": "fail",
                           "text": f"Taken {distance:,} km from the site — outside the {radius:.0f} km limit."})

    # 2. Time
    taken, start = meta["taken_at"], _parse_start(start_date)
    if taken is None:
        checks.append({"key": "time", "status": "unknown", "text": "No capture time in the photo."})
    elif taken > now + timedelta(days=1):
        checks.append({"key": "time", "status": "fail", "text": f"Capture time {taken:%d %b %Y} is in the future."})
    elif start and taken < start:
        checks.append({"key": "time", "status": "fail",
                       "text": f"Taken {taken:%d %b %Y}, before the project started ({start:%b %Y})."})
    elif (now - taken).days > STALE_AFTER_DAYS:
        checks.append({"key": "time", "status": "fail",
                       "text": f"Taken {taken:%d %b %Y} — more than {STALE_AFTER_DAYS} days old, so it can't show current progress."})
    else:
        checks.append({"key": "time", "status": "pass", "text": f"Taken {taken:%d %b %Y}, within the last {STALE_AFTER_DAYS} days."})

    # 3. Duplicate
    h = image_hash(path)
    dup_of = None
    if h:
        for other in earlier_uploads:
            oh = image_hash(other)
            if oh and _hamming(h, oh) <= 4:
                dup_of = other.name
                break
    if dup_of:
        checks.append({"key": "duplicate", "status": "fail", "text": f"Same image as an earlier upload ({dup_of})."})
    else:
        checks.append({"key": "duplicate", "status": "pass", "text": "Not a copy of any earlier upload."})

    statuses = {c["status"] for c in checks}
    if "fail" in statuses:
        verdict, summary = "flagged", "Failed an integrity check — this photo is not allowed to change the project's verified progress."
    elif "unknown" in statuses:
        verdict, summary = "unverifiable", "Missing location or time metadata — accepted, but labelled as unverified evidence."
    else:
        verdict, summary = "verified", "Location, time and uniqueness all check out."

    return {
        "verdict": verdict,
        "summary": summary,
        "checks": checks,
        "photo_lat": meta["lat"],
        "photo_lng": meta["lng"],
        "taken_at": meta["taken_at"].isoformat() if meta["taken_at"] else None,
        "camera": meta["camera"],
        "distance_km": distance,
        "radius_km": radius,
        "image_hash": h,
    }
