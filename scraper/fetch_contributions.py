"""CLI: fetch per-committee contribution CSVs -> data/raw/<org_id>.csv (resumable)."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from scraper.fetchers.erts import fetch_contribution_csv

COMMITTEES = Path("data/committees.json")
RAW_DIR = Path("data/raw")


def main():
    committees = json.loads(COMMITTEES.read_text())
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for c in committees:
            org_id = c.get("org_id")
            if not org_id:
                continue
            dest = RAW_DIR / f"{org_id}.csv"
            if dest.exists():
                print(f"skip {org_id} ({c['name']}) - exists", flush=True)
                continue
            try:
                n = fetch_contribution_csv(page, org_id, dest)
                print(f"ok   {org_id} ({c['name']}, {c.get('town')}) - {n} rows", flush=True)
            except Exception as e:
                print(f"FAIL {org_id} ({c['name']}) - {e}", flush=True)
            time.sleep(1.5)
        browser.close()


if __name__ == "__main__":
    main()
