# Aquidneck Island Campaign Finance Dashboard

An easy-to-read dashboard tracking who donates to municipal candidates in **Newport,
Middletown, and Portsmouth, RI** (Mayor/Administrator, Council, School Committee),
sourced from the RI Board of Elections.

## How it works
1. **Scrape** — `scraper/` discovers committees in all three towns and downloads each
   one's contribution CSV from ricampaignfinance.com.
2. **Build** — `pipeline/` cleans, dedupes, classifies, and aggregates the data into
   small donor-focused JSON files in `site/data/`.
3. **Present** — `site/` is a static dashboard that reads those JSON files. It is
   deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Run it
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium

python -m scraper.discover_committees   # -> data/committees.json (3 towns)
python -m scraper.fetch_contributions   # -> data/raw/<org_id>.csv (resumable)
python -m pipeline.build                # -> site/data/*.json

cd site && python -m http.server 8000   # view at http://localhost:8000
```

## Tests
```bash
pytest
```

## Limitations
- History floors at ~2002 (source system limit).
- Donor grouping is name + ZIP — approximate; may merge or split distinct people.
- The RI source system is being replaced (~2026); scraper URLs/format will change.
  All ERTS-specific code is isolated in `scraper/fetchers/erts.py`.
- A candidate's **town** is the town whose search surfaced their committee (registered
  mailing city); committees registered out-of-town rely on `scraper/seed_candidates.json`.
- Employer/occupation fields are self-reported and inconsistent.

Data is public record under RI APRA. Not affiliated with any candidate or campaign.
