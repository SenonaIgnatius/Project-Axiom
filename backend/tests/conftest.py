"""Run the API against a throwaway database so tests never touch data/axiom.db."""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="axiom-test-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp.as_posix()}/test.db"
os.environ["SYNC_DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}/test.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    from app.main import app
    with TestClient(app) as c:  # runs startup: creates and seeds the database
        yield c
