import json
from pathlib import Path
from pipeline.normalize import load_raw_csvs, normalize_contributions
from pipeline.aggregate import (
    build_summary, build_timeline, build_donors, build_candidates, write_views,
)

FIX = Path(__file__).parent / "fixtures"


def _norm():
    df = load_raw_csvs(FIX, pattern="sample_raw.csv")
    committees = json.loads((FIX / "committees.json").read_text())
    return normalize_contributions(df, committees)


def test_summary_excludes_refunds_and_breaks_down_by_town():
    s = build_summary(_norm())
    assert s["total_raised"] == 1165.0          # refund (-50) excluded
    assert s["num_candidates"] == 2
    assert s["num_donors"] == 5
    assert s["num_contributions"] == 6
    assert s["year_min"] == 2018 and s["year_max"] == 2022
    by_town = {t["town"]: t["total"] for t in s["by_town"]}
    assert by_town == {"Newport": 850.0, "Middletown": 315.0}


def test_timeline_by_year():
    t = {row["year"]: row["amount"] for row in build_timeline(_norm())}
    assert t == {2018: 100.0, 2020: 750.0, 2022: 315.0}


def test_top_donor_aggregates_across_candidates():
    donors = build_donors(_norm())
    assert donors[0]["name"] == "CVS PAC"      # highest single total ($500)
    js = next(d for d in donors if d["name"] == "JOHN SMITH")
    assert js["total"] == 450.0                # 250 + 200, across two candidates
    assert js["gifts"] == 2
    assert set(js["candidates"]) == {"JANE DOE FOR COUNCIL", "BOB ROE SCHOOL"}


def test_candidates_sorted_with_town():
    cands = build_candidates(_norm())
    assert cands[0]["name"] == "JANE DOE FOR COUNCIL"   # 850 > 315
    assert cands[0]["total_raised"] == 850.0
    assert cands[0]["town"] == "Newport"
    assert cands[0]["office"] == "City/Town Council"


def test_write_views_emits_all_files(tmp_path):
    write_views(_norm(), tmp_path)
    for fname in ["summary.json", "timeline.json", "donors.json", "candidates.json"]:
        assert (tmp_path / fname).exists()
    summary = json.loads((tmp_path / "summary.json").read_text())
    assert summary["total_raised"] == 1165.0
