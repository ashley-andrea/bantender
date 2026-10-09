import csv
import json
from pathlib import Path

import pytest

from app.reference import load_reference

ROOT = Path(__file__).resolve().parents[2]
REFERENCE_DIR = ROOT / "data" / "reference" / "v1"
SAMPLE_DIR = ROOT / "data" / "samples" / "oberglatt"
TENDER_PDF = SAMPLE_DIR / "BKP_244_LV_Lueftung_260804.pdf"


@pytest.fixture(scope="session")
def ref():
    return load_reference(REFERENCE_DIR)


@pytest.fixture(scope="session")
def examples():
    with (SAMPLE_DIR / "example_lv_positions.csv").open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@pytest.fixture(scope="session")
def golden():
    return json.loads((SAMPLE_DIR / "expected_output_example.json").read_text(encoding="utf-8"))
