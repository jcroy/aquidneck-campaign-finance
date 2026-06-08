"""CLI: discover Newport/Middletown/Portsmouth committees -> data/committees.json"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from scraper.fetchers.erts import discover_committees

OUT = Path("data/committees.json")
SEED = Path("scraper/seed_candidates.json")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        committees = discover_committees(page)
        browser.close()
    seed = json.loads(SEED.read_text()) if SEED.exists() else []
    by_name = {}
    for s in seed:
        by_name[s["name"].upper()] = {"status": "active", **s}
    for c in committees:
        by_name[c["name"].upper()] = c
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(list(by_name.values()), indent=2))
    by_town = {}
    for c in by_name.values():
        by_town[c.get("town", "?")] = by_town.get(c.get("town", "?"), 0) + 1
    print(f"Wrote {len(by_name)} committees to {OUT}: {by_town}")


if __name__ == "__main__":
    main()
