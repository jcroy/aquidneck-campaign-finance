# Newport, RI Campaign Finance Dashboard — Design Spec

**Date:** 2026-06-07
**Status:** Approved design — ready for implementation planning

## 1. Purpose

Build an easy-to-read public dashboard of campaign donations to **Newport, Rhode Island
municipal candidates** (Mayor/Administrator, City/Town Council, School Committee). The
dashboard answers four questions ("lenses"):

1. **Who funds each candidate** — per-candidate totals, top donors, contribution sizes.
2. **Top donors / influence** — the biggest givers in Newport politics and who they back.
3. **Money over time** — fundraising trends across election cycles.
4. **In/out-of-town money** — Newport-resident money vs. rest-of-RI vs. out-of-state.

### Project parameters (decided during brainstorming)

| Parameter | Decision |
|---|---|
| Scope | Newport city offices only: Mayor/Administrator, City/Town Council, School Committee |
| Freshness | One-time snapshot (no live/auto-updating infrastructure) |
| History depth | All available history (~2002 → today; ~2002 is the source system's floor) |
| Audience / deploy | Run locally, publish static site to GitHub (Pages); screenshot-shareable |
| User involvement | "Build it for me" — minimize manual steps; clear run instructions |
| Stack | Python (scraper + data pipeline) + static HTML/JS dashboard |
| Acquisition | **Scrape everything directly from the official RI BOE source** (no third-party mirror) |

## 2. Data source (confirmed by recon)

All Newport municipal campaign finance data lives in the **RI Board of Elections ERTS**
(Campaign Finance Electronic Reporting & Tracking System), a 2002-era ASP.NET WebForms site:

- Public site: `ricampaignfinance.com` (e.g. `/RIPublic/Contributions.aspx`)
- Report page: `/RIPublic/Reporting/TransactionReport.aspx` — directly addressable by a numeric
  `OrgID` (no session needed to *load* the report).
- **No public API, no Socrata/data.ri.gov dataset, no single bulk download.**
- **Per-committee CSV export** ("Export Detail to comma delimited file") produces a clean
  22-field CSV. This is the extraction target.
- **Newport committees are discoverable** via the Org Search: filter `City = Newport` × an
  `Office` dropdown that includes exactly our three offices. Committees are per-candidate
  (org name = candidate name); there is no single "Newport" committee.
- No CAPTCHA, no login, no rate limiting observed; `robots.txt` is 404. Data is public record
  under RI APRA. We will still throttle politely.

**Confirmed CSV fields** (from a real 1,530-row sample export):
`ContributionID, ContDesc, IncompleteDesc, OrganizationName, ViewIncomplete, ReceiptDate,
DepositDate, Amount, ContribExplanation, MPFMatchAmount, FirstName, LastName, FullName,
Address, CityStZip, EmployerName, EmpAddress, EmpCityStZip, ReceiptDesc, BeginDate, EndDate,
TransType`

### Known risk
RI awarded a contract to vendor **Civix** to replace this system, expected live ~2026. URLs and
export format will change. Because this is a **one-time snapshot**, we capture data now; the
fetch layer is isolated so a future re-run is a contained change, not a rewrite.

## 3. Architecture — five stages

```
[1 Acquire] -> [2 Normalize] -> [3 Resolve] -> [4 Aggregate] -> [5 Present]
  scraper        pipeline         pipeline       pipeline        static site
  (Playwright)   (pandas)         (pandas)       (-> JSON)       (HTML/JS)
```

Each stage has one job and a well-defined hand-off artifact, so it can be built and tested
independently.

### Stage 1 — Acquire (`scraper/`)

**1a. Discover committees.** Drive the ERTS Org Search with Playwright for `City = Newport`
× each office in {Mayor/Administrator, City/Town Council, School Committee}. Paginate; capture
each committee's name, office, active/inactive status, and `OrgID`. Merge with a small
hand-maintained seed list (`scraper/seed_candidates.json`) of known Newport candidates to catch
committees registered with a non-Newport mailing address.
**Output:** `data/committees.json` — `[{org_id, name, office, status}]`.

**1b. Fetch contributions.** For each `OrgID`, open `TransactionReport.aspx` with an empty
date range (= all years), trigger the export postback chain
(`lnkExport` → `DownloadFile.aspx` → `hypFileDownload`), and save the CSV.
**Output:** `data/raw/<org_id>.csv` (one file per committee).
Requirements: polite throttle between requests; **resumable** (skip committees already
downloaded); log every fetch with row counts.

**Isolation:** all ERTS-specific behavior (URL shapes, postback chain, field names) lives in a
single `scraper/fetchers/erts.py` module behind a small interface
(`discover_committees()`, `fetch_contributions(org_id) -> path`). Nothing downstream knows
about ASP.NET.

### Stage 2 — Normalize (`pipeline/normalize.py`)

Concatenate all `data/raw/*.csv` into one canonical contributions table:
- Split `CityStZip` → `donor_city`, `donor_state`, `donor_zip` (regex; handle malformed rows
  gracefully, never crash on one bad row).
- Parse `Amount` → float; parse `ReceiptDate` → ISO date.
- Drop the `1/1/1900` placeholder deposit dates (treat as null).
- Dedupe on `ContributionID`.
- Classify each row's **type** from `ContDesc`/`TransType`: individual, PAC, party, in-kind,
  loan, refund, aggregate, other. Downstream views decide which to include (e.g. exclude
  refunds/loans from "money raised").
- Attach recipient candidate + office by joining `OrganizationName`/`OrgID` to
  `committees.json`.

**Output:** `data/processed/contributions.parquet` (canonical table) + a CSV copy for humans.

### Stage 3 — Resolve (`pipeline/entities.py`)

- **Donor grouping key:** normalized `FullName` (uppercase, punctuation/whitespace stripped) +
  `donor_zip`. Used to aggregate "top donors." Documented as **approximate** — not true
  identity resolution.
- **Geography classification** per contribution:
  - `in_town` — `donor_city == "NEWPORT"` OR `donor_zip ∈ {02840, 02841}`.
  - `rest_of_ri` — RI but not Newport (note: 02842 = Middletown, NOT Newport).
  - `out_of_state` — everything else.
  Missing/unparseable location → `unknown` bucket (surfaced, not silently dropped).

### Stage 4 — Aggregate (`pipeline/aggregate.py`)

Precompute small JSON files so the site is fully static and fast:
- `summary.json` — headline totals: total raised, # candidates, # donors, # contributions,
  date range, in/out percentages.
- `candidates.json` — per candidate: name, office, cycles active, total raised, # contributions,
  # donors, average gift, in/out split, yearly trend, top 10 donors.
- `donors.json` — top N donors: name, city, total given, # gifts, list of candidates funded.
- `timeline.json` — raised per year (optionally split by office).
- `geo.json` — in-town / rest-of-RI / out-of-state totals, overall and per candidate.
- Per-candidate detail split into `data/by_candidate/<id>.json` so no single payload bloats.

All aggregation excludes refunds/loans from "raised" totals by default; in-kind shown
separately where relevant.

### Stage 5 — Present (`site/`)

Single-page static dashboard, built to look credible and screenshot well, reading the JSON.

Layout:
```
┌─────────────────────────────────────────────────────────┐
│  NEWPORT, RI · WHO FUNDS CITY HALL        2002–2025       │
│  $X.XM raised   ·   N candidates   ·   N donors          │   hero (the screenshot)
│  ▓▓▓ in-town   ░░░ rest of RI   ▒▒ out-of-state          │
├──────────────────────┬──────────────────────────────────┤
│  MONEY OVER TIME      │  TOP DONORS                       │
│  bar/line by cycle    │  ranked table → # candidates      │
├──────────────────────┴──────────────────────────────────┤
│  BY CANDIDATE  [ pick a candidate ▾ ]                     │
│  total raised · top donors · in/out split · timeline     │
└─────────────────────────────────────────────────────────┘
```

- Stack: vanilla JS + Chart.js (lightweight, no build step required), reading the view JSON.
- Filters: by office and by cycle.
- Responsive; hero designed as a clean shareable screenshot.
- `frontend-design` skill applied for visual polish during implementation.
- Deploy: site output lives in the published folder (GitHub Pages — `docs/` or `site/` per
  Pages config); view JSON copied/built into `site/data/`.

## 4. Repository layout

```
scraper/
  fetchers/erts.py        ERTS-specific quirks (isolated fetch layer)
  discover_committees.py  Stage 1a -> data/committees.json
  fetch_contributions.py  Stage 1b -> data/raw/<org_id>.csv
  seed_candidates.json    hand-maintained Newport candidate seed list
pipeline/
  normalize.py            Stage 2 -> data/processed/contributions.parquet
  entities.py             Stage 3 (donor grouping + geo classification)
  aggregate.py            Stage 4 -> view JSON
data/
  committees.json
  raw/                    downloaded per-committee CSVs
  processed/              canonical table + view JSON
site/
  index.html, js/, css/, data/   the published dashboard
tests/                    pipeline tests on sample-CSV fixtures
README.md                 run order: scrape -> build -> view; limitations
requirements.txt          (or pyproject.toml)
```

## 5. Testing strategy

- **Pipeline is TDD'd** against small sample-CSV fixtures (built from the real export shape):
  `CityStZip` parsing (incl. malformed rows), `1/1/1900` handling, dedupe on `ContributionID`,
  type classification, in/out-of-town classification (incl. the 02842/Middletown trap),
  aggregation totals.
- **Scraper** is tested at the parsing boundary using saved HTML/CSV fixtures; live network
  calls are not part of the automated test suite (Playwright run is manual/one-time).
- A tiny end-to-end check: run the pipeline on a fixture committee and assert the produced JSON
  shape matches what the site expects.

## 6. Documented limitations (in README)

- History floors at ~2002 (source system limit).
- Donor grouping is name+zip — approximate, may merge/split distinct people.
- Source system is being replaced (~2026); URLs/format will change for future re-runs.
- Committees registered with a non-Newport mailing address rely on the seed list to be included.
- Self-reported employer/occupation fields are inconsistent in the source data.

## 7. Out of scope (YAGNI for v1)

- Live/auto-updating data; scheduled scraping.
- Expenditures (this is contributions only).
- State/federal candidates; donor-centric cross-level tracking.
- Map visualizations / geocoding beyond the in/out-of-town bucketing.
- True entity resolution / fuzzy donor de-duplication.
```
