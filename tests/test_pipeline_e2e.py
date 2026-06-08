import json
import shutil
from pathlib import Path
from pipeline.build import run_pipeline

FIX = Path(__file__).parent / "fixtures"


def test_run_pipeline_produces_site_data(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    shutil.copy(FIX / "sample_raw.csv", raw / "100.csv")
    out = tmp_path / "site_data"
    run_pipeline(
        raw_dir=raw,
        committees_path=FIX / "committees.json",
        processed_dir=tmp_path / "processed",
        out_dir=out,
    )
    summary = json.loads((out / "summary.json").read_text())
    assert summary["total_raised"] == 1165.0
    assert (tmp_path / "processed" / "contributions.parquet").exists()
