# Aquidneck Island Campaign Finance Dashboard — Design Spec

**Date:** 2026-06-07 (revised 2026-06-08: expanded to 3 towns, refocused on donors)
**Status:** Approved design — ready for implementation planning

## 1. Purpose

Build an easy-to-read public dashboard that tracks **who donates to local municipal
politicians on Aquidneck Island, Rhode Island** — the candidates for office in **Newport,
Middletown, and Portsmouth** (Mayor/Administrator, City/Town Council, School Committee).

The emphasis is the **politicians and their donors**, not where donors geographically live.
The dashboard answers:

1. **Who funds each candidate** — per-candidate totals, top donors, contribution sizes.
2. **Top donors / influence** — the biggest givers to these local politicians, and how many
   (and which) candidates each one backs. *(This is the centerpiece.)*
3. **Money over time** — fundraising trends across election cycles.
4. **By town** — filter and compare candidates across the three towns.

> Note: an earlier draft included an "in-town vs out-of-town donor money" lens. That has been
> **dropped** — the focus is the recipients and their donors, not classifying donor origin. A
> donor's city is still shown in tables (it's free in the source data) but is not an organizing
> feature.

### Project parameters (decided during brainstorming)

| Parameter | Decision |
|---|---|
| Scope | Municipal candidates in **Newport, Middletown, Portsmouth**: Mayor/Administrator, City/Town Council, School Committee |
| Freshness | One-time snapshot (no live/auto-updating infrastructure) |
| History depth | All available history (~2002 → today; ~2002 is the source system's floor) |
| Audience / deploy | Run locally, publish static site to GitHub (Pages); screenshot-shareable |
| User involvement | "Build it for me" — minimize manual steps; clear run instructions |
| Stack | Python (scraper + data pipeline) + static HTML/JS dashboard |
| Acquisition | **Scrape everything directly from the official RI BOE source** (no third-party mirror) |
| Organizing facets | Recipient **candidate**, recipient **town**, and **donor** |

## 2. Data source (confirmed by recon)

All municipal campaign finance data for these towns lives in the **RI Board of Elections ERTS**
(Campaign Finance Electronic Reporting & Tracking System), a 2002-era ASP.NET WebForms site:

- Public site: `ricampaignfinance.com` (e.g. `/RIPublic/Contributions.aspx`)
- Report page: `/RIPublic/Reporting/TransactionReport.aspx` — directly addressable by a numeric
  `OrgID` (no session needed to *load* the report).
- **No public API, no Socrata/data.ri.gov dataset, no single bulk download.**
- **Per-committee CSV export** ("Export Detail to comma delimited file") produces a clean
  22-field CSV. This is the extraction target.
- **Committees are discoverable by town** via the Org Search: filter `City = <town>` × an
  `Office` dropdown that includes exactly our three offices. We run this for each of the three
  towns. Committees are per-candidate (org name = candidate name); there is no single town
  committee.
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
fetch layer is isolated so a future re-run is a contained change.

## 3. Architecture — five stages

```
[1 Acquire] -> [2 Normalize] -> [3 Resolve] -> [4 Aggregate] -> [5 Present]
  scraper        pipeline         pipeline       pipeline        static site
  (Playwright)   (pandas)         (pandas)       (-> JSON)       (HTML/JS)
```

Each stage has one job and a well-defined hand-off artifact, so it can be built and tested
independently.

### Stage 1 — Acquire (`scraper/`)

**1a. Discover committees.** Drive the ERTS Org Search with Playwright for each
`City ∈ {Newport, Middletown, Portsmouth}` × each office in {Mayor/Administrator,
City/Town Council, School Committee}. Paginate; capture each committee's name, office,
active/inactive status, `OrgID`, and **town** (the search city it was found under). Merge with
a small hand-maintained seed list (`scraper/seed_candidates.json`) of known candidates to catch
committees registered with a different mailing-address city.
**Output:** `data/committees.json` — `[{org_id, name, office, town, status}]`.

**1b. Fetch contributions.** For each `OrgID`, open `TransactionReport.aspx` with an empty date
range (= all years), trigger the export postback chain
(`lnkExport` → `DownloadFile.aspx` → `hypFileDownload`), and save the CSV.
**Output:** `data/raw/<org_id>.csv` (one file per committee).
Requirements: polite throttle; **resumable** (skip committees already downloaded); log every
fetch with row counts.

**Isolation:** all ERTS-specific behavior lives in a single `scraper/fetchers/erts.py` module
behind a small interface. Nothing downstream knows about ASP.NET.

### Stage 2 — Normalize (`pipeline/normalize.py`)

Concatenate all `data/raw/*.csv` into one canonical contributions table:
- Split `CityStZip` → `donor_city`, `donor_state`, `donor_zip` (regex; never crash on a bad row).
- Parse `Amount` → float; parse `ReceiptDate` → ISO date; drop `1/1/1900` placeholder dates.
- Dedupe on `ContributionID`.
- Classify each row's **type** (individual, PAC, party, in-kind, loan, refund, aggregate, other);
  downstream excludes refunds/loans from "money raised."
- Attach recipient **candidate**, **office**, and **town** by joining `OrganizationName` to
  `committees.json`.

**Output:** `data/processed/contributions.parquet` (canonical table) + a CSV copy for humans.

### Stage 3 — Resolve (`pipeline/entities.py`)

- **Donor grouping key:** normalized `FullName` (uppercase, punctuation/whitespace stripped) +
  `donor_zip`. Used to aggregate "top donors." Documented as **approximate** — not true identity
  resolution.

(No donor-geography classification — deliberately out of scope per the donor-focused goal.)

### Stage 4 — Aggregate (`pipeline/aggregate.py`)

Precompute small JSON files so the site is fully static and fast:
- `summary.json` — headline totals: total raised, # candidates, # donors, # contributions,
  date range, and **per-town totals** (`by_town`).
- `candidates.json` — per candidate: name, **town**, office, total raised, # contributions,
  # donors, average gift, yearly trend, top 10 donors.
- `donors.json` — top N donors: name, city, total given, # gifts, list of candidates funded.
- `timeline.json` — raised per year.

All aggregation excludes refunds/loans from "raised" totals by default.

### Stage 5 — Present (`site/`)

Single-page static dashboard, built to look credible and screenshot well, reading the JSON.

Layout:
```
┌─────────────────────────────────────────────────────────┐
│  AQUIDNECK ISLAND · WHO FUNDS LOCAL OFFICE   2002–2025    │
│  Newport · Middletown · Portsmouth                       │
│  $X.XM raised   ·   N candidates   ·   N donors          │   hero (the screenshot)
│  Newport $X · Middletown $X · Portsmouth $X              │   per-town chips
├──────────────────────┬──────────────────────────────────┤
│  MONEY OVER TIME      │  TOP DONORS  (the centerpiece)    │
│  bar/line by cycle    │  ranked: donor → $ → # candidates │
├──────────────────────┴──────────────────────────────────┤
│  BY CANDIDATE   [ town ▾ ]  [ pick a candidate ▾ ]        │
│  total raised · # donors · avg gift · top donors · trend │
└─────────────────────────────────────────────────────────┘
```

- Stack: vanilla JS + Chart.js (vendored locally, no build step), reading the view JSON.
- A **town filter** narrows the candidate picker to Newport / Middletown / Portsmouth / All.
- The **Top Donors** table is global (across all three towns' candidates) — the "who is donating
  to local politicians" centerpiece.
- Responsive; hero designed as a clean shareable screenshot.
- `frontend-design` skill applied for visual polish during implementation.
- Deploy: `site/` published to GitHub Pages via a GitHub Actions workflow.

## 4. Repository layout

```
scraper/
  fetchers/erts.py        ERTS-specific quirks (isolated fetch layer)
  discover_committees.py  Stage 1a -> data/committees.json (3 towns)
  fetch_contributions.py  Stage 1b -> data/raw/<org_id>.csv
  seed_candidates.json    hand-maintained candidate seed list
pipeline/
  normalize.py            Stage 2 -> data/processed/contributions.parquet
  entities.py             Stage 3 (donor grouping key)
  aggregate.py            Stage 4 -> view JSON
  build.py                orchestrator
data/
  committees.json
  raw/                    downloaded per-committee CSVs
  processed/              canonical table + view JSON
site/
  index.html, js/, css/, js/vendor/, data/   the published dashboard
tests/                    pipeline tests on sample-CSV fixtures
README.md                 run order: scrape -> build -> view; limitations
requirements.txt
```

## 5. Testing strategy

- **Pipeline is TDD'd** against small sample-CSV fixtures (built from the real export shape):
  `CityStZip` parsing (incl. malformed rows), `1/1/1900` handling, dedupe on `ContributionID`,
  type classification, committee→town/office join, aggregation totals incl. per-town.
- **Scraper** is tested at its pure-helper boundary (org-id parse, URL build) using fixtures;
  live network calls are manual/one-time, not in the automated suite.
- A tiny end-to-end check runs the pipeline on a fixture and asserts the produced JSON shape.

## 6. Documented limitations (in README)

- History floors at ~2002 (source system limit).
- Donor grouping is name+zip — approximate, may merge/split distinct people.
- Source system is being replaced (~2026); URLs/format will change for future re-runs.
- A candidate's **town** is the town whose search surfaced their committee (registered mailing
  city); a committee registered out-of-town relies on the seed list.
- Self-reported employer/occupation fields are inconsistent in the source data.

## 7. Out of scope (YAGNI for v1)

- Live/auto-updating data; scheduled scraping.
- Expenditures (this is contributions only).
- **Donor geographic origin classification** (in/out-of-town bucketing) — dropped per the
  donor-focused goal.
- State/federal candidates; donor-centric cross-level tracking.
- Map visualizations / geocoding.
- True entity resolution / fuzzy donor de-duplication.
```
