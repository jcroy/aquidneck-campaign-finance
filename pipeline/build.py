"""Stage 2-4 orchestrator: raw CSVs -> canonical table -> site/data view JSON."""
import json
from pathlib import Path
from pipeline.normalize import load_raw_csvs, normalize_contributions
from pipeline.aggregate import write_views


def run_pipeline(raw_dir="data/raw", committees_path="data/committees.json",
                 processed_dir="data/processed", out_dir="site/data"):
    committees = json.loads(Path(committees_path).read_text())
    df = load_raw_csvs(raw_dir)
    if df.empty:
        raise SystemExit(f"No raw CSVs found in {raw_dir}; run the scraper first.")
    norm = normalize_contributions(df, committees)

    processed = Path(processed_dir)
    processed.mkdir(parents=True, exist_ok=True)
    norm.to_parquet(processed / "contributions.parquet")
    norm.to_csv(processed / "contributions.csv", index=False)

    write_views(norm, out_dir)
    print(f"Pipeline complete: {len(norm)} contributions -> {out_dir}")


if __name__ == "__main__":
    run_pipeline()
