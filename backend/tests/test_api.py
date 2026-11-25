"""Smoke tests: every page of the console has a working endpoint behind it."""
import pytest

CASE = "PS-PW-3390"  # Subansiri Lower HE Project (PAIMANA code 602096)


def test_health(client):
    assert client.get("/").status_code == 200


def test_ten_case_studies_seeded(client):
    projects = client.get("/api/projects").json()
    assert len(projects) == 10
    assert all(p["projectCode"] and p["sourcePage"] for p in projects)


@pytest.mark.parametrize("path", [
    f"/api/projects/{CASE}",
    f"/api/projects/{CASE}/risk",
    f"/api/satellite/{CASE}/change-detection",
    f"/api/weather/{CASE}",
    f"/api/assets/ASSET-{CASE}/health",
    f"/api/benchmark/{CASE}",
    f"/api/history/{CASE}",
    f"/api/scenario/{CASE}",
    f"/api/ml/project/{CASE}",
    "/api/ml/overrun-models",
    "/api/data-quality",
])
def test_endpoint_ok(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"


def test_report_audit_covers_whole_report(client):
    dq = client.get("/api/data-quality").json()
    assert dq["projects_evaluated"] == 1392
    assert len(dq["rules"]) == 6


def test_all_projects_search_and_watchlist(client):
    all_ = client.get("/api/paimana/projects").json()
    assert all_["total_in_report"] == 1392
    metro = client.get("/api/paimana/projects", params={"q": "metro"}).json()
    assert 0 < metro["matched"] < 1392
    wl = client.get("/api/paimana/projects", params={"watchlist": True}).json()
    assert wl["matched"] == wl["watchlist_count"] > 0


def test_models_beat_statistics_baseline(client):
    report = client.get("/api/ml/overrun-models").json()
    for target in ("cost_overrun", "time_overrun"):
        t = report["targets"][target]
        best = t["models"][t["best_model"]]["roc_auc"]
        assert best >= t["models"]["logistic_regression"]["roc_auc"]
        assert best > 0.6


def test_source_page_renders(client):
    r = client.get(f"/api/projects/{CASE}/source-page")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/")


def test_photo_integrity_flags_far_away_photo(tmp_path):
    from datetime import datetime, timedelta
    from fractions import Fraction
    from PIL import Image
    from app.services.photo_integrity_service import check_photo

    def photo(name, lat, lng, when):
        exif = Image.Exif()
        exif.get_ifd(0x8769)[0x9003] = when.strftime("%Y:%m:%d %H:%M:%S")
        gps = exif.get_ifd(0x8825)
        dms = lambda x: (Fraction(int(x)), Fraction(int(x % 1 * 60)), Fraction(0))
        gps[1], gps[2], gps[3], gps[4] = "N", dms(lat), "E", dms(lng)
        p = tmp_path / name
        Image.new("RGB", (64, 64), (120, 110, 90)).save(p, exif=exif)
        return p

    recent = datetime.utcnow() - timedelta(days=5)
    on_site = photo("site.jpg", 30.55, 74.95, recent)
    chennai = photo("chennai.jpg", 13.08, 80.27, recent)
    assert check_photo(on_site, 30.5476, 74.9455, "Roads", "06/2024", [])["verdict"] == "verified"
    far = check_photo(chennai, 30.5476, 74.9455, "Roads", "06/2024", [])
    assert far["verdict"] == "flagged" and far["distance_km"] > 1500


def test_extraction_matches_report_totals():
    import importlib.util, pathlib
    p = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "verify_report_totals.py"
    spec = importlib.util.spec_from_file_location("vrt", p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert m.main() == 0
