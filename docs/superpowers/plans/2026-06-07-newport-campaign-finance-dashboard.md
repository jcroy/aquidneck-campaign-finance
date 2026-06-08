# Aquidneck Island Campaign Finance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape all historical campaign contributions to municipal candidates in Newport, Middletown, and Portsmouth from the RI Board of Elections, transform them into clean donor-focused aggregates, and present them in a static, screenshot-friendly dashboard published to GitHub Pages.

**Architecture:** Five isolated stages — Acquire (Playwright scraper, 3 towns) → Normalize → Resolve → Aggregate (pandas pipeline emitting small JSON) → Present (static HTML/JS reading the JSON). The pipeline is fully TDD'd against a sample-CSV fixture; the scraper is tested at its pure helper boundary and verified with live runs. All ERTS-specific quirks are walled off in one module. Focus is recipients (candidate + town) and their donors — no donor-origin geo classification.

**Tech Stack:** Python 3.11+, Playwright (Chromium), pandas, pyarrow, pytest; vanilla JS + Chart.js (vendored locally) for the dashboard; GitHub Actions for Pages deploy.

**Spec:** `docs/superpowers/specs/2026-06-07-newport-campaign-finance-dashboard-design.md`

---

## File Structure

```
scraper/
  __init__.py
  fetchers/
    __init__.py
    erts.py              # ERTS quirks: URL builders, org-id parse, Playwright discovery+export
  discover_committees.py # CLI: Org Search over 3 towns -> data/committees.json
  fetch_contributions.py # CLI: per-OrgID CSV export -> data/raw/<org_id>.csv (resumable)
  seed_candidates.json   # hand-maintained extra committee names (may be empty)
pipeline/
  __init__.py
  normalize.py           # field cleaners + load/normalize raw CSVs (adds town/office)
  entities.py            # donor_key
  aggregate.py           # build_* view builders + write_views
  build.py               # CLI: normalize -> aggregate -> site/data/*.json
data/
  committees.json
  raw/                   # downloaded CSVs (gitignored)
  processed/             # contributions.parquet + .csv (gitignored)
site/
  index.html
  css/styles.css
  js/app.js
  js/vendor/chart.umd.min.js
  data/                  # generated view JSON (committed for Pages)
tests/
  fixtures/sample_raw.csv
  fixtures/committees.json
  test_erts.py
  test_normalize.py
  test_entities.py
  test_aggregate.py
  test_pipeline_e2e.py
.github/workflows/pages.yml
requirements.txt
pytest.ini
.gitignore
README.md
```

---

### Task 1: Project scaffold

**Files:**
- Create: `requirements.txt`, `pytest.ini`, `.gitignore`
- Create: `scraper/__init__.py`, `scraper/fetchers/__init__.py`, `pipeline/__init__.py`
- Create: `scraper/seed_candidates.json`
- Create: `data/raw/.gitkeep`, `data/processed/.gitkeep`, `site/data/.gitkeep`

- [ ] **Step 1: Create `requirements.txt`**

```
playwright==1.48.0
pandas==2.2.3
pyarrow==18.0.0
pytest==8.3.3
```

- [ ] **Step 2: Create `pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 3: Create `.gitignore`**

```
__pycache__/
*.pyc
.venv/
venv/
data/raw/*.csv
data/processed/*.parquet
data/processed/*.csv
.pytest_cache/
```

- [ ] **Step 4: Create empty package markers and placeholder data dirs**

Create these empty files:
- `scraper/__init__.py` (empty)
- `scraper/fetchers/__init__.py` (empty)
- `pipeline/__init__.py` (empty)
- `data/raw/.gitkeep` (empty)
- `data/processed/.gitkeep` (empty)
- `site/data/.gitkeep` (empty)

Create `scraper/seed_candidates.json` with:

```json
[]
```

- [ ] **Step 5: Create virtualenv and install deps**

Run:
```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python -m playwright install chromium
```
Expected: installs complete; `python -m playwright install chromium` downloads the browser.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold project structure and dependencies"
```

---

### Task 2: ERTS pure helpers (TDD)

The only unit-testable seams of the scraper: extracting an OrgID from a result link, and building the all-history report URL.

**Files:**
- Create: `scraper/fetchers/erts.py`
- Test: `tests/test_erts.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_erts.py`:
```python
from scraper.fetchers.erts import org_id_from_href, build_report_url, TOWNS, OFFICES


def test_org_id_from_relative_href():
    href = "Reporting/TransactionReport.aspx?OrgID=5004&ReportType=Contrib"
    assert org_id_from_href(href) == "5004"


def test_org_id_case_insensitive_param():
    assert org_id_from_href("x.aspx?orgid=7268&x=1") == "7268"


def test_org_id_missing_returns_none():
    assert org_id_from_href("x.aspx?foo=1") is None
    assert org_id_from_href("") is None


def test_build_report_url_includes_org_and_contrib():
    url = build_report_url("5004")
    assert "OrgID=5004" in url
    assert "ReportType=Contrib" in url
    assert "BeginDate=&EndDate=" in url  # all-history range


def test_towns_and_offices_constants():
    assert TOWNS == ["Newport", "Middletown", "Portsmouth"]
    assert "School Committee" in OFFICES
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `. .venv/bin/activate && pytest tests/test_erts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scraper.fetchers.erts'`

- [ ] **Step 3: Implement the helpers**

`scraper/fetchers/erts.py`:
```python
"""ERTS (RI Board of Elections) specific access. All site quirks live here."""
from urllib.parse import urlparse, parse_qs

ERTS_BASE = "https://www.ricampaignfinance.com/RIPublic"
CONTRIBUTIONS_URL = f"{ERTS_BASE}/Contributions.aspx"
TOWNS = ["Newport", "Middletown", "Portsmouth"]
OFFICES = ["Mayor/Administrator", "City/Town Council", "School Committee"]


def org_id_from_href(href: str) -> str | None:
    """Extract the numeric OrgID from an ERTS TransactionReport link."""
    if not href:
        return None
    params = parse_qs(urlparse(href).query)
    values = params.get("OrgID") or params.get("orgid")
    if values and values[0].isdigit():
        return values[0]
    return None


def build_report_url(org_id: str) -> str:
    """All-history contribution report URL for a committee OrgID."""
    return (
        f"{ERTS_BASE}/Reporting/TransactionReport.aspx"
        f"?OrgID={org_id}"
        "&BeginDate=&EndDate="
        "&ReportType=Contrib"
        "&ContSource=CF"
        "&CFStatus=F"
        "&MPFStatus=A"
        "&Level=S"
        "&SumBy=Type"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_erts.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add scraper/fetchers/erts.py tests/test_erts.py
git commit -m "feat(scraper): ERTS url/org-id helpers and town/office constants"
```

---

### Task 3: Committee discovery across 3 towns (Playwright)

Drive the ERTS Org Search to enumerate committees and OrgIDs for each town.

**Files:**
- Modify: `scraper/fetchers/erts.py` (add `discover_committees`)
- Create: `scraper/discover_committees.py`

- [ ] **Step 1: Add `discover_committees` to `scraper/fetchers/erts.py`**

Append:
```python
import time


def discover_committees(page, towns=None, offices=None) -> list[dict]:
    """Enumerate committees for each town across the given offices.

    Returns list of {org_id, name, office, town, status}. Uses Playwright `page`.
    Dropdowns are selected by visible label so we never hardcode ASP.NET option values.
    """
    towns = towns or TOWNS
    offices = offices or OFFICES
    found: dict[str, dict] = {}
    for town in towns:
        for office in offices:
            page.goto(CONTRIBUTIONS_URL, wait_until="networkidle")
            page.get_by_role("button", name="New Organization Search").click()
            page.wait_for_load_state("networkidle")
            page.get_by_label("City").fill(town)
            page.get_by_label("Office").select_option(label=office)
            page.get_by_role("button", name="Search").click()
            page.wait_for_load_state("networkidle")

            while True:
                rows = page.locator("table#dgResults tr, table[id*=Results] tr")
                for i in range(rows.count()):
                    link = rows.nth(i).locator("a[href*='OrgID']")
                    if link.count() == 0:
                        continue
                    href = link.first.get_attribute("href") or ""
                    org_id = org_id_from_href(href)
                    if not org_id or org_id in found:
                        continue
                    name = (link.first.inner_text() or "").strip()
                    status = "inactive" if "inactive" in rows.nth(i).inner_text().lower() else "active"
                    found[org_id] = {
                        "org_id": org_id, "name": name,
                        "office": office, "town": town, "status": status,
                    }
                nxt = page.get_by_role("link", name="Next")
                if nxt.count() == 0 or not nxt.first.is_enabled():
                    break
                nxt.first.click()
                page.wait_for_load_state("networkidle")
                time.sleep(1.0)  # polite throttle
    return list(found.values())
```

> NOTE FOR IMPLEMENTER: ERTS is legacy ASP.NET; exact element ids/labels may differ from the guesses above. During the live run (Step 4) use the Playwright MCP `browser_snapshot` to read the real selectors and adjust the locators in this function until discovery returns rows. Only this function changes; nothing downstream does.

- [ ] **Step 2: Create the CLI `scraper/discover_committees.py`**

```python
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

    # Merge hand-maintained seed names (keyed by name; discovered entries win).
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
```

- [ ] **Step 3: Run the discovery CLI against the live site**

Run: `. .venv/bin/activate && python -m scraper.discover_committees`
Expected: prints "Wrote N committees ... {'Newport': .., 'Middletown': .., 'Portsmouth': ..}" with N > 0 across all three towns; `data/committees.json` contains objects with non-empty `org_id`, `name`, `office`, and `town`.

- [ ] **Step 4: Verify the output looks sane**

Run: `python -c "import json; d=json.load(open('data/committees.json')); print(len(d)); print({c['town'] for c in d}); print(d[0])"`
Expected: a count (dozens), the set `{'Newport','Middletown','Portsmouth'}`, and a well-formed first record. If rows are empty, fix the locators per the NOTE and re-run.

- [ ] **Step 5: Commit**

```bash
git add scraper/fetchers/erts.py scraper/discover_committees.py data/committees.json
git commit -m "feat(scraper): discover committees across Newport/Middletown/Portsmouth"
```

---

### Task 4: Contribution fetch (Playwright export chain, resumable)

For each committee OrgID, trigger the CSV export and save it.

**Files:**
- Modify: `scraper/fetchers/erts.py` (add `fetch_contribution_csv`)
- Create: `scraper/fetch_contributions.py`

- [ ] **Step 1: Add `fetch_contribution_csv` to `scraper/fetchers/erts.py`**

Append:
```python
def fetch_contribution_csv(page, org_id: str, dest_path) -> int:
    """Open a committee's all-history report and save the exported CSV.

    Returns the number of data rows written. Drives the export postback chain:
    report page -> 'Export Detail to comma delimited file' -> download.
    """
    from pathlib import Path
    dest = Path(dest_path)
    page.goto(build_report_url(org_id), wait_until="networkidle")
    with page.expect_download() as dl_info:
        export = page.locator("#lnkExport")
        if export.count() == 0:
            export = page.get_by_text("Export Detail to comma delimited file")
        export.first.click()
        try:
            page.get_by_role("link", name="View/Save").click(timeout=5000)
        except Exception:
            pass
    download = dl_info.value
    download.save_as(str(dest))
    with open(dest, encoding="utf-8", errors="replace") as fh:
        return max(0, sum(1 for _ in fh) - 1)
```

> NOTE FOR IMPLEMENTER: the export postback may open `DownloadFile.aspx` then require a second `__doPostBack('hypFileDownload','')` click. If `expect_download` times out, snapshot the intermediate page and wire the second click. Keep all such logic inside this function.

- [ ] **Step 2: Create the CLI `scraper/fetch_contributions.py`**

```python
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
            if dest.exists():  # resumable: skip already-downloaded
                print(f"skip {org_id} ({c['name']}) - exists")
                continue
            try:
                n = fetch_contribution_csv(page, org_id, dest)
                print(f"ok   {org_id} ({c['name']}, {c.get('town')}) - {n} rows")
            except Exception as e:
                print(f"FAIL {org_id} ({c['name']}) - {e}")
            time.sleep(1.5)  # polite throttle
        browser.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the fetch CLI against the live site**

Run: `. .venv/bin/activate && python -m scraper.fetch_contributions`
Expected: a line per committee ("ok <id> ... - <n> rows"); `data/raw/` fills with `<org_id>.csv` files. Re-running prints "skip ... exists" for completed ones (resumability check).

- [ ] **Step 4: Verify a sample CSV has the expected 22-column header**

Run: `python -c "import csv,glob; f=sorted(glob.glob('data/raw/*.csv'))[0]; print(next(csv.reader(open(f))))"`
Expected: header includes `ContributionID, ContDesc, OrganizationName, ReceiptDate, Amount, FullName, CityStZip, EmployerName, TransType` (among the 22 fields).

- [ ] **Step 5: Commit**

```bash
git add scraper/fetchers/erts.py scraper/fetch_contributions.py
git commit -m "feat(scraper): resumable per-committee CSV export fetch"
```

---

### Task 5: Normalize field cleaners (TDD)

Pure functions that clean individual messy fields.

**Files:**
- Create: `pipeline/normalize.py`
- Test: `tests/test_normalize.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_normalize.py`:
```python
from pipeline.normalize import parse_city_state_zip, clean_date, classify_type


def test_parse_city_state_zip_basic():
    assert parse_city_state_zip("WASHINGTON, DC 20004") == ("WASHINGTON", "DC", "20004")


def test_parse_city_state_zip_plus4_and_newport():
    assert parse_city_state_zip("NEWPORT, RI 02840-1234") == ("NEWPORT", "RI", "02840")


def test_parse_city_state_zip_garbage():
    assert parse_city_state_zip("garbagecity") == (None, None, None)
    assert parse_city_state_zip("") == (None, None, None)


def test_clean_date_valid():
    assert clean_date("12/30/2020") == "2020-12-30"


def test_clean_date_placeholder_and_bad():
    assert clean_date("1/1/1900") is None
    assert clean_date("") is None
    assert clean_date("not a date") is None


def test_classify_type():
    assert classify_type("Individual", "Contribution") == "individual"
    assert classify_type("PAC", "Contribution") == "pac"
    assert classify_type("Refund", "Refund") == "refund"
    assert classify_type("In-Kind", "Contribution") == "in_kind"
    assert classify_type("Loan Proceeds", "Loan") == "loan"
    assert classify_type("Party", "Contribution") == "party"
    assert classify_type("Something else", "") == "other"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_normalize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.normalize'`

- [ ] **Step 3: Implement the cleaners**

`pipeline/normalize.py`:
```python
"""Stage 2: normalize raw ERTS contribution CSVs into a canonical table."""
import re
from datetime import datetime

_CSZ = re.compile(r"^(?P<city>.*?),\s*(?P<state>[A-Za-z]{2})\s+(?P<zip>\d{5})(?:-\d{4})?\s*$")


def parse_city_state_zip(raw):
    """'CITY, ST 12345[-6789]' -> (CITY, ST, 12345). Unparseable -> (None,None,None)."""
    if not raw or not str(raw).strip():
        return (None, None, None)
    m = _CSZ.match(str(raw).strip())
    if not m:
        return (None, None, None)
    city = m.group("city").strip().upper() or None
    return (city, m.group("state").upper(), m.group("zip"))


def clean_date(raw):
    """'M/D/YYYY' -> 'YYYY-MM-DD'. Placeholder 1/1/1900 and junk -> None."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%m/%d/%Y")
    except ValueError:
        return None
    if dt.year <= 1900:
        return None
    return dt.strftime("%Y-%m-%d")


def classify_type(cont_desc, trans_type=""):
    """Map ERTS ContDesc/TransType to a coarse contribution type."""
    text = f"{cont_desc or ''} {trans_type or ''}".upper()
    if "REFUND" in text:
        return "refund"
    if "LOAN" in text:
        return "loan"
    if "IN-KIND" in text or "IN KIND" in text or "INKIND" in text:
        return "in_kind"
    if "PAC" in text:
        return "pac"
    if "PARTY" in text:
        return "party"
    if "AGGREGATE" in text:
        return "aggregate"
    if "INDIVIDUAL" in text:
        return "individual"
    return "other"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_normalize.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/normalize.py tests/test_normalize.py
git commit -m "feat(pipeline): field cleaners for city/zip, dates, types"
```

---

### Task 6: Donor grouping key (TDD)

**Files:**
- Create: `pipeline/entities.py`
- Test: `tests/test_entities.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_entities.py`:
```python
from pipeline.entities import donor_key


def test_donor_key_normalizes_name_and_zip():
    assert donor_key("John Q. Public", "02840") == "JOHN Q PUBLIC|02840"
    assert donor_key("  acme   pac ", None) == "ACME PAC|"


def test_donor_key_same_person_same_zip_matches():
    assert donor_key("JOHN SMITH", "02840") == donor_key("john smith", "02840")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_entities.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.entities'`

- [ ] **Step 3: Implement**

`pipeline/entities.py`:
```python
"""Stage 3: approximate donor grouping key (name + zip)."""
import re


def donor_key(full_name, zip_code=None):
    """Approximate donor identity: normalized name + zip."""
    name = re.sub(r"[^A-Z0-9 ]", "", str(full_name or "").upper())
    name = re.sub(r"\s+", " ", name).strip()
    z = str(zip_code).strip() if zip_code else ""
    return f"{name}|{z}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_entities.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/entities.py tests/test_entities.py
git commit -m "feat(pipeline): approximate donor grouping key"
```

---

### Task 7: Normalize assembly (TDD with fixture)

Load raw CSVs into one canonical, deduped, enriched table tagged with candidate town/office.

**Files:**
- Create: `tests/fixtures/sample_raw.csv`
- Create: `tests/fixtures/committees.json`
- Modify: `pipeline/normalize.py` (add `load_raw_csvs`, `normalize_contributions`)
- Test: `tests/test_normalize.py` (add assembly tests)

- [ ] **Step 1: Create the fixture `tests/fixtures/sample_raw.csv`**

```csv
ContributionID,ContDesc,IncompleteDesc,OrganizationName,ViewIncomplete,ReceiptDate,DepositDate,Amount,ContribExplanation,MPFMatchAmount,FirstName,LastName,FullName,Address,CityStZip,EmployerName,EmpAddress,EmpCityStZip,ReceiptDesc,BeginDate,EndDate,TransType
1,Individual,,JANE DOE FOR COUNCIL,Complete,11/03/2020,11/05/2020,250.00,,0.00,John,Smith,JOHN SMITH,1 Main St,"NEWPORT, RI 02840",Acme,,,Check,,,Contribution
2,PAC,,JANE DOE FOR COUNCIL,Complete,10/01/2020,,500.00,,0.00,,,CVS PAC,1275 Penn Ave,"WASHINGTON, DC 20004",,,,Check,,,Contribution
3,Individual,,JANE DOE FOR COUNCIL,Complete,09/15/2018,09/16/2018,100.00,,0.00,Mary,Jones,MARY JONES,2 Oak St,"MIDDLETOWN, RI 02842",,,,Check,,,Contribution
4,Refund,,JANE DOE FOR COUNCIL,Complete,11/10/2020,,-50.00,,0.00,John,Smith,JOHN SMITH,1 Main St,"NEWPORT, RI 02840",,,,Check,,,Refund
1,Individual,,JANE DOE FOR COUNCIL,Complete,11/03/2020,11/05/2020,250.00,,0.00,John,Smith,JOHN SMITH,1 Main St,"NEWPORT, RI 02840",Acme,,,Check,,,Contribution
5,Individual,,BOB ROE SCHOOL,Complete,06/01/2022,1/1/1900,75.00,,0.00,Sue,Lee,SUE LEE,3 Elm,"MIDDLETOWN, RI 02842",,,,Check,,,Contribution
6,Individual,,BOB ROE SCHOOL,Complete,06/02/2022,,40.00,,0.00,A,B,AB DONOR,x,garbagecity,,,,Check,,,Contribution
7,Individual,,BOB ROE SCHOOL,Complete,05/01/2022,,200.00,,0.00,John,Smith,JOHN SMITH,1 Main St,"NEWPORT, RI 02840",Acme,,,Check,,,Contribution
```

- [ ] **Step 2: Create the fixture `tests/fixtures/committees.json`**

```json
[
  {"org_id": "100", "name": "JANE DOE FOR COUNCIL", "office": "City/Town Council", "town": "Newport", "status": "active"},
  {"org_id": "200", "name": "BOB ROE SCHOOL", "office": "School Committee", "town": "Middletown", "status": "inactive"}
]
```

- [ ] **Step 3: Write the failing assembly tests**

Append to `tests/test_normalize.py`:
```python
import json
from pathlib import Path
from pipeline.normalize import load_raw_csvs, normalize_contributions

FIX = Path(__file__).parent / "fixtures"


def _normalized():
    df = load_raw_csvs(FIX, pattern="sample_raw.csv")
    committees = json.loads((FIX / "committees.json").read_text())
    return normalize_contributions(df, committees)


def test_dedupe_on_contribution_id():
    n = _normalized()
    assert len(n) == 7  # 8 rows, one duplicate ID=1 removed


def test_recipient_town_and_office_join():
    n = _normalized()
    council = n[n["recipient_name"] == "JANE DOE FOR COUNCIL"]
    assert set(council["office"]) == {"City/Town Council"}
    assert set(council["town"]) == {"Newport"}
    school = n[n["recipient_name"] == "BOB ROE SCHOOL"]
    assert set(school["town"]) == {"Middletown"}


def test_amount_and_city_columns():
    n = _normalized()
    row = n[n["contribution_id"] == "2"].iloc[0]
    assert row["amount"] == 500.0
    assert row["donor_city"] == "WASHINGTON"


def test_year_derived_from_receipt_date():
    n = _normalized()
    row = n[n["contribution_id"] == "3"].iloc[0]
    assert row["year"] == 2018
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pytest tests/test_normalize.py -v`
Expected: the assembly tests FAIL with `ImportError: cannot import name 'load_raw_csvs'`

- [ ] **Step 5: Implement `load_raw_csvs` and `normalize_contributions`**

Append to `pipeline/normalize.py`:
```python
import glob
import os
import pandas as pd
from pipeline.entities import donor_key


def load_raw_csvs(raw_dir, pattern="*.csv") -> pd.DataFrame:
    """Concatenate every raw export CSV in raw_dir (all columns as strings)."""
    frames = []
    for path in sorted(glob.glob(os.path.join(str(raw_dir), pattern))):
        frames.append(pd.read_csv(path, dtype=str, keep_default_na=False))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _norm_name(name) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip().upper())


def normalize_contributions(df, committees) -> pd.DataFrame:
    """Clean, dedupe, and enrich raw rows into the canonical contributions table."""
    if df.empty:
        return df
    df = df.drop_duplicates(subset=["ContributionID"]).copy()
    by_name = {_norm_name(c["name"]): c for c in committees}

    csz = df["CityStZip"].apply(parse_city_state_zip)
    out = pd.DataFrame({
        "contribution_id": df["ContributionID"].astype(str),
        "recipient_name": df["OrganizationName"].str.strip(),
        "donor_name": df["FullName"].str.strip(),
        "employer": df["EmployerName"].str.strip(),
        "amount": pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0),
        "receipt_date": df["ReceiptDate"].apply(clean_date),
    })
    committee_for = [by_name.get(_norm_name(n), {}) for n in out["recipient_name"]]
    out["office"] = [c.get("office", "Unknown") for c in committee_for]
    out["town"] = [c.get("town", "Unknown") for c in committee_for]
    out["donor_city"] = [t[0] for t in csz]
    out["donor_state"] = [t[1] for t in csz]
    out["donor_zip"] = [t[2] for t in csz]
    out["year"] = out["receipt_date"].apply(lambda d: int(d[:4]) if d else None)
    out["type"] = [classify_type(cd, tt) for cd, tt in zip(df["ContDesc"], df["TransType"])]
    out["donor_key"] = [donor_key(n, z) for n, z in zip(out["donor_name"], out["donor_zip"])]
    return out
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_normalize.py -v`
Expected: all passed

- [ ] **Step 7: Commit**

```bash
git add pipeline/normalize.py tests/test_normalize.py tests/fixtures/sample_raw.csv tests/fixtures/committees.json
git commit -m "feat(pipeline): assemble canonical table with candidate town/office"
```

---

### Task 8: Aggregations → view JSON (TDD)

**Files:**
- Create: `pipeline/aggregate.py`
- Test: `tests/test_aggregate.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_aggregate.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_aggregate.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.aggregate'`

- [ ] **Step 3: Implement `pipeline/aggregate.py`**

```python
"""Stage 4: aggregate the canonical table into small view JSON files."""
import json
from pathlib import Path


def raised_only(df):
    """Money actually raised: everything except refunds and loans."""
    return df[~df["type"].isin(["refund", "loan"])]


def build_summary(df) -> dict:
    r = raised_only(df)
    years = r["year"].dropna()
    by_town = (r.groupby("town")["amount"].sum().sort_values(ascending=False))
    return {
        "total_raised": float(r["amount"].sum()),
        "num_candidates": int(r["recipient_name"].nunique()),
        "num_donors": int(r["donor_key"].nunique()),
        "num_contributions": int(len(r)),
        "year_min": int(years.min()) if not years.empty else None,
        "year_max": int(years.max()) if not years.empty else None,
        "by_town": [{"town": t, "total": float(a)} for t, a in by_town.items()],
    }


def build_timeline(df) -> list[dict]:
    r = raised_only(df).dropna(subset=["year"])
    g = r.groupby("year")["amount"].sum().sort_index()
    return [{"year": int(y), "amount": float(a)} for y, a in g.items()]


def build_donors(df, top_n=50) -> list[dict]:
    r = raised_only(df)
    rows = []
    for key, grp in r.groupby("donor_key"):
        rows.append({
            "donor_key": key,
            "name": grp["donor_name"].iloc[0],
            "city": grp["donor_city"].iloc[0],
            "total": float(grp["amount"].sum()),
            "gifts": int(len(grp)),
            "candidates": sorted(set(grp["recipient_name"])),
        })
    rows.sort(key=lambda x: x["total"], reverse=True)
    return rows[:top_n]


def build_candidates(df) -> list[dict]:
    r = raised_only(df)
    out = []
    for name, grp in r.groupby("recipient_name"):
        years = grp.dropna(subset=["year"]).groupby("year")["amount"].sum().sort_index()
        top = (grp.groupby("donor_key")
                  .agg(name=("donor_name", "first"), total=("amount", "sum"))
                  .sort_values("total", ascending=False).head(10))
        out.append({
            "name": name,
            "town": grp["town"].iloc[0],
            "office": grp["office"].iloc[0],
            "total_raised": float(grp["amount"].sum()),
            "num_contributions": int(len(grp)),
            "num_donors": int(grp["donor_key"].nunique()),
            "avg_gift": float(grp["amount"].mean()),
            "timeline": [{"year": int(y), "amount": float(a)} for y, a in years.items()],
            "top_donors": [{"name": row["name"], "total": float(row["total"])}
                           for _, row in top.iterrows()],
        })
    out.sort(key=lambda x: x["total_raised"], reverse=True)
    return out


def write_views(df, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(build_summary(df), indent=2))
    (out / "timeline.json").write_text(json.dumps(build_timeline(df), indent=2))
    (out / "donors.json").write_text(json.dumps(build_donors(df), indent=2))
    (out / "candidates.json").write_text(json.dumps(build_candidates(df), indent=2))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_aggregate.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add pipeline/aggregate.py tests/test_aggregate.py
git commit -m "feat(pipeline): donor-focused view aggregations with per-town totals"
```

---

### Task 9: Pipeline orchestrator + end-to-end fixture test

**Files:**
- Create: `pipeline/build.py`
- Test: `tests/test_pipeline_e2e.py`

- [ ] **Step 1: Write the failing end-to-end test**

`tests/test_pipeline_e2e.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pipeline_e2e.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline.build'`

- [ ] **Step 3: Implement `pipeline/build.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pipeline_e2e.py -v`
Expected: passed

- [ ] **Step 5: Run the full pipeline on real scraped data**

Run: `. .venv/bin/activate && python -m pipeline.build`
Expected: prints "Pipeline complete: N contributions -> site/data"; `site/data/{summary,timeline,donors,candidates}.json` populated with real numbers.

- [ ] **Step 6: Run the whole test suite**

Run: `pytest -v`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add pipeline/build.py tests/test_pipeline_e2e.py site/data/*.json
git commit -m "feat(pipeline): orchestrator + generated view data"
```

---

### Task 10: Dashboard frontend

Static page reading the view JSON. Use the `frontend-design` skill for visual polish.

**Files:**
- Create: `site/index.html`, `site/css/styles.css`, `site/js/app.js`, `site/js/vendor/chart.umd.min.js`

- [ ] **Step 1: Invoke the frontend-design skill**

Before writing markup, invoke `frontend-design` to establish a distinctive, credible visual
treatment (typography, color, the hero). Apply it to the structure below — do not ship generic
defaults.

- [ ] **Step 2: Vendor Chart.js locally, then create `site/index.html`**

Download Chart.js into the repo instead of loading it from a CDN — no Subresource Integrity
needed, works offline, removes CDN-compromise risk for the published site:
```bash
mkdir -p site/js/vendor
curl -L https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js \
  -o site/js/vendor/chart.umd.min.js
```

Then create `site/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aquidneck Island — Who Funds Local Office</title>
  <link rel="stylesheet" href="css/styles.css">
  <script src="js/vendor/chart.umd.min.js"></script>
</head>
<body>
  <header class="hero">
    <h1>Aquidneck Island — Who Funds Local Office</h1>
    <p class="subtitle">Newport · Middletown · Portsmouth <span id="date-range"></span></p>
    <div class="stat-row" id="headline-stats"></div>
    <div class="town-chips" id="town-chips"></div>
  </header>

  <main>
    <section class="panel">
      <h2>Money Over Time</h2>
      <canvas id="timeline-chart" height="120"></canvas>
    </section>

    <section class="panel">
      <h2>Top Donors to Local Politicians</h2>
      <table id="donors-table"><thead><tr>
        <th>Donor</th><th>City</th><th>Total</th><th>Gifts</th><th>Candidates funded</th>
      </tr></thead><tbody></tbody></table>
    </section>

    <section class="panel">
      <h2>By Candidate</h2>
      <div class="filters">
        <label>Town <select id="town-filter">
          <option>All</option><option>Newport</option>
          <option>Middletown</option><option>Portsmouth</option>
        </select></label>
        <label>Candidate <select id="candidate-select"></select></label>
      </div>
      <div id="candidate-detail"></div>
    </section>
  </main>

  <footer>
    <p>Source: RI Board of Elections (ricampaignfinance.com). Donor grouping is approximate
       (name + ZIP). Data ~2002–present. Built for transparency, not affiliated with any campaign.</p>
  </footer>

  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `site/js/app.js`**

```javascript
const fmt = (n) => "$" + Math.round(n).toLocaleString();

async function load(name) {
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`failed to load ${name}.json`);
  return res.json();
}

function renderHeadline(s) {
  document.getElementById("date-range").textContent = `· ${s.year_min}–${s.year_max}`;
  document.getElementById("headline-stats").innerHTML = `
    <div class="stat"><span class="num">${fmt(s.total_raised)}</span><span>raised</span></div>
    <div class="stat"><span class="num">${s.num_candidates}</span><span>candidates</span></div>
    <div class="stat"><span class="num">${s.num_donors.toLocaleString()}</span><span>donors</span></div>`;
  document.getElementById("town-chips").innerHTML = s.by_town
    .map((t) => `<span class="chip">${t.town}: ${fmt(t.total)}</span>`).join("");
}

function renderTimeline(timeline) {
  new Chart(document.getElementById("timeline-chart"), {
    type: "bar",
    data: {
      labels: timeline.map((d) => d.year),
      datasets: [{ label: "Raised", data: timeline.map((d) => d.amount) }],
    },
    options: { plugins: { legend: { display: false } } },
  });
}

function renderDonors(donors) {
  document.querySelector("#donors-table tbody").innerHTML = donors.map((d) => `
    <tr><td>${d.name}</td><td>${d.city || ""}</td><td>${fmt(d.total)}</td>
        <td>${d.gifts}</td><td>${d.candidates.length}</td></tr>`).join("");
}

function renderCandidates(cands) {
  const townSel = document.getElementById("town-filter");
  const sel = document.getElementById("candidate-select");
  const detail = document.getElementById("candidate-detail");

  function show(i) {
    const c = cands[i];
    detail.innerHTML = `
      <p><strong>${c.name}</strong> — ${c.town}, ${c.office}</p>
      <p><strong>${fmt(c.total_raised)}</strong> from ${c.num_donors} donors
         (${c.num_contributions} gifts, avg ${fmt(c.avg_gift)})</p>
      <ol>${c.top_donors.map((d) => `<li>${d.name} — ${fmt(d.total)}</li>`).join("")}</ol>`;
  }
  function populate(town) {
    const items = cands
      .map((c, i) => ({ c, i }))
      .filter((x) => town === "All" || x.c.town === town);
    sel.innerHTML = items
      .map((x) => `<option value="${x.i}">${x.c.name} — ${x.c.town} ${x.c.office}</option>`)
      .join("");
    if (items.length) show(items[0].i);
    else detail.innerHTML = "<p>No candidates for this town.</p>";
  }
  townSel.addEventListener("change", (e) => populate(e.target.value));
  sel.addEventListener("change", (e) => show(Number(e.target.value)));
  populate("All");
}

(async function main() {
  try {
    const [summary, timeline, donors, candidates] = await Promise.all([
      load("summary"), load("timeline"), load("donors"), load("candidates"),
    ]);
    renderHeadline(summary);
    renderTimeline(timeline);
    renderDonors(donors);
    renderCandidates(candidates);
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin",
      `<p style="color:red;padding:1rem">Error loading data: ${e.message}</p>`);
  }
})();
```

- [ ] **Step 4: Create `site/css/styles.css`**

Apply the frontend-design output here. Minimum required structural styles:
```css
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, sans-serif; color:#1a1a1a; }
.hero { padding: 2rem; background:#0b1f33; color:#fff; }
.hero h1 { margin:0 0 .25rem; font-size: clamp(1.5rem, 4vw, 2.5rem); }
.subtitle { opacity:.85; margin:0 0 1rem; }
.stat-row { display:flex; gap:2rem; flex-wrap:wrap; }
.stat { display:flex; flex-direction:column; }
.stat .num { font-size: clamp(1.5rem, 5vw, 3rem); font-weight:700; }
.town-chips { display:flex; gap:.75rem; flex-wrap:wrap; margin-top:1rem; }
.chip { background:rgba(255,255,255,.12); padding:.3rem .7rem; border-radius:999px; font-size:.9rem; }
main { max-width: 960px; margin: 0 auto; padding: 1rem; }
.panel { margin: 2rem 0; }
.filters { display:flex; gap:1.5rem; flex-wrap:wrap; margin-bottom:1rem; }
table { width:100%; border-collapse: collapse; }
th, td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid #eee; }
footer { padding: 2rem; color:#666; font-size:.85rem; max-width:960px; margin:0 auto; }
```

- [ ] **Step 5: Serve and verify in a browser**

Run: `. .venv/bin/activate && (cd site && python -m http.server 8765 &) && sleep 2`
Then use the Playwright MCP (`browser_navigate` to `http://localhost:8765`, `browser_console_messages`, `browser_take_screenshot`).
Expected: hero shows the real total/candidate/donor numbers and per-town chips; the timeline bar
chart renders; the donors table has rows; the town filter narrows the candidate dropdown and the
candidate detail updates. **No console errors.** Stop the server afterward (`kill %1` or
`pkill -f http.server`).

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/js/app.js site/css/styles.css site/js/vendor/chart.umd.min.js
git commit -m "feat(site): donor-focused dashboard with town filter"
```

---

### Task 11: GitHub Pages deploy + README

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `README.md`

- [ ] **Step 1: Create `.github/workflows/pages.yml`**

Deploys the `site/` folder to GitHub Pages on push to the default branch.
```yaml
name: Deploy dashboard to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "docs: README and GitHub Pages deploy workflow"
```

- [ ] **Step 4: Final verification**

Run: `pytest -v`
Expected: entire suite green. Confirm `git status` is clean and `site/data/*.json` are committed
(these are what Pages serves).

---

## Notes for the implementer

- **Live-site fragility:** Tasks 3 and 4 target a legacy ASP.NET site whose exact selectors recon
  could not fully capture. Treat the Playwright locators as starting points; use the Playwright
  MCP `browser_snapshot` against the live pages to read real ids/labels and adjust **only** inside
  `scraper/fetchers/erts.py`. Everything downstream is fixed and fully tested.
- **Order matters:** the pipeline (Tasks 5–9) is independent of the live site and can be built and
  fully tested first using the fixture; the scraper (Tasks 3–4) can be done in parallel or after.
- **Data commit policy:** raw CSVs and the parquet are gitignored; the generated `site/data/*.json`
  IS committed because GitHub Pages serves it.
```
