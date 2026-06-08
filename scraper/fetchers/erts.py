"""ERTS (RI Board of Elections) specific access. All site quirks live here."""
import time
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
    """All-history contribution report URL for a committee OrgID.

    The TransactionReport page renders data from a *direct GET* only when the
    full criteria parameter set produced by the Contributions.aspx Search form
    is supplied (live-validated). A minimal URL (just OrgID + BeginDate/EndDate)
    is silently rejected: the page falls back to a default quarter range and
    shows "Unable to complete the search with the criteria provided." with no
    rows -- and the export then 500s ("ExecuteReader: CommandText property has
    not been initialized"). Empty BeginDate/EndDate here means all-history.
    """
    return (
        f"{ERTS_BASE}/Reporting/TransactionReport.aspx"
        f"?OrgID={org_id}"
        "&BeginDate=&EndDate="
        "&LastName=&FirstName="
        "&ContType=0"
        "&State=&City=&ZIPCode=&EmployerName="
        "&Amount=0"
        "&ReportType=Contrib"
        "&CFStatus=F"
        "&MPFStatus=A"
        "&Level=S"
        "&SumBy=Type"
        "&Sort1=ReceiptDate&Direct1=desc"
        "&Sort2=None&Direct2=asc"
        "&Sort3=None&Direct3=asc"
        "&Site=Public"
        "&Incomplete=A"
        "&ContSource=CF"
    )


# --- Live committee discovery -------------------------------------------------
#
# Flow established by exploring the live site (ASP.NET WebForms, no UpdatePanel,
# all state in __VIEWSTATE):
#
#   1. Contributions.aspx has a "New Organization Search" button (#lnkSearchOrg)
#      that reveals an inline org-search panel with:
#         #txtOrgCity        - free-text City filter (contains-match)
#         #lstOffice         - Office <select> (Mayor/Administrator, etc.)
#         #lstDisplayResults - results-per-page (default "All", so no paging)
#         #lnkSubSearchOrg   - the org-search submit button
#   2. Submitting renders a results <table id="dgdOrgSearchResults"> with a
#      header row + one row per committee. Columns:
#         [0] Organization Name (an <a> whose href is a __doPostBack selecting
#             that org -- the link control id is dgdOrgSearchResults_ctlNN_lnkOrgID)
#         [1] Address  [2] City  [3] State  [4] Status (Active/Inactive)
#      The numeric OrgID is NOT present in the DOM -- it lives only in viewstate.
#   3. To resolve a row's OrgID: fire its postback to select the org, then click
#      the main search button (#btnSearch). The page then navigates to
#      Reporting/TransactionReport.aspx?OrgID=<digits>&... -- org_id_from_href
#      pulls the OrgID out of that URL.
#
# Because OrgID resolution navigates away from the result list, we re-run the
# org search once per committee to restore the list before selecting the next
# row (reliable, if chatty -- this is a one-time discovery pass).

ORG_RESULTS_TABLE_ID = "dgdOrgSearchResults"


def _open_org_search(page, city: str, office: str) -> None:
    """Open the org-search panel, fill City + Office, request all results, submit."""
    page.goto(CONTRIBUTIONS_URL, wait_until="networkidle")
    page.locator("#lnkSearchOrg").click()
    page.locator("#txtOrgCity").wait_for(state="visible")
    page.locator("#txtOrgCity").fill(city)
    page.locator("#lstOffice").select_option(label=office)
    # Ask for every result on one page so there is nothing to paginate.
    try:
        page.locator("#lstDisplayResults").select_option(label="All")
    except Exception:
        pass
    page.locator("#lnkSubSearchOrg").click()
    page.wait_for_load_state("networkidle")


def _read_org_rows(page) -> list[dict]:
    """Read name/city/status/postback-control for each committee row, or []."""
    return page.evaluate(
        """(tableId) => {
            const t = document.getElementById(tableId);
            if (!t) return [];
            const rows = [];
            for (let i = 1; i < t.rows.length; i++) {
                const r = t.rows[i];
                if (r.cells.length < 5) continue;
                const a = r.cells[0].querySelector('a');
                if (!a) continue;
                // a.id looks like dgdOrgSearchResults_ctl02_lnkOrgID;
                // the postback target uses '$' separators.
                const target = a.id.replace(/_/g, '$');
                rows.push({
                    target,
                    name: r.cells[0].textContent.replace(/\\s+/g, ' ').trim(),
                    city: r.cells[2].textContent.replace(/\\s+/g, ' ').trim(),
                    status: r.cells[4].textContent.replace(/\\s+/g, ' ').trim(),
                });
            }
            return rows;
        }""",
        ORG_RESULTS_TABLE_ID,
    )


def _resolve_org_id(page, target: str) -> str | None:
    """Select the org via its postback then submit to land on TransactionReport;
    return the numeric OrgID parsed from the resulting URL, or None."""
    page.evaluate("(t) => { __doPostBack(t, ''); }", target)
    page.wait_for_load_state("networkidle")
    page.locator("#btnSearch").click()
    page.wait_for_load_state("networkidle")
    return org_id_from_href(page.url)


def discover_committees(page, towns=None, offices=None) -> list[dict]:
    """Enumerate municipal committees across ``towns`` x ``offices`` on the live
    ERTS site. Returns a list of {org_id, name, office, town, status}, deduped by
    org_id."""
    towns = towns or TOWNS
    offices = offices or OFFICES
    found: dict[str, dict] = {}
    for town in towns:
        for office in offices:
            _open_org_search(page, town, office)
            rows = _read_org_rows(page)
            print(f"[discover] {town} / {office}: {len(rows)} committees", flush=True)
            time.sleep(1)
            for i, row in enumerate(rows):
                org_id = _resolve_org_id(page, row["target"])
                if (i + 1) % 10 == 0:
                    print(f"[discover]   {town}/{office}: {i + 1}/{len(rows)} resolved", flush=True)
                if org_id and org_id not in found:
                    found[org_id] = {
                        "org_id": org_id,
                        "name": row["name"],
                        "office": office,
                        "town": town,
                        "status": "active"
                        if row["status"].strip().lower() == "active"
                        else "inactive",
                    }
                time.sleep(1)
                # Resolving an OrgID navigates away from the result list, so
                # restore it before selecting the next row.
                if i + 1 < len(rows):
                    _open_org_search(page, town, office)
    return list(found.values())


# --- Contribution CSV export --------------------------------------------------
#
# Export flow established by exploring the live site (ASP.NET WebForms):
#
#   1. GET build_report_url(org_id). With the full criteria param set this
#      renders the committee's all-history Contribution Report (Summary level)
#      WITH data and an export link #lnkExport
#      ("(Export Detail to comma delimited file)"). If criteria are bad the page
#      instead shows "Unable to complete the search with the criteria provided."
#      and exporting 500s -- so we guard on that text and on a missing link.
#   2. Clicking #lnkExport does __doPostBack('lnkExport','') which generates a
#      server-side temp CSV and opens a NEW popup window/tab at
#      Reporting/DownloadFile.aspx?path=...&file=<guid>.csv. That popup says
#      "Your file has been successfully generated" and contains a link
#      #hypFileDownload ("View/Save", __doPostBack('hypFileDownload','')).
#   3. Clicking #hypFileDownload in the popup streams the actual .csv file
#      (Content-Disposition: attachment), which Playwright captures via
#      expect_download. The CSV is a 22-column ERTS export (header:
#      ContributionID, ContDesc, IncompleteDesc, OrganizationName, ...,
#      CityStZip, EmployerName, ..., TransType).
#
# Zero-contribution handling: municipal candidate committees in scope all have
# at least some contributions, but a committee with none would render the
# "Unable to complete" message (no result set). In that case -- or if the export
# link is absent -- we write a header-only CSV and return 0 rather than crash,
# so downstream parsing sees a valid (empty) file and the run stays resumable.

_NO_DATA_MARKER = "Unable to complete the search"
_CSV_HEADER = (
    "ContributionID,ContDesc,IncompleteDesc,OrganizationName,ViewIncomplete,"
    "ReceiptDate,DepositDate,Amount,ContribExplanation,MPFMatchAmount,FirstName,"
    "LastName,FullName,Address,CityStZip,EmployerName,EmpAddress,EmpCityStZip,"
    "ReceiptDesc,BeginDate,EndDate,TransType\n"
)


def fetch_contribution_csv(page, org_id: str, dest_path) -> int:
    """Download a committee's all-history contribution CSV to ``dest_path``.

    Returns the number of data rows (lines minus the header). A committee with
    no contributions writes a header-only file and returns 0.
    """
    from pathlib import Path

    dest = Path(dest_path)
    page.goto(build_report_url(org_id), wait_until="networkidle")

    # No result set (genuinely empty committee, or rejected criteria): the
    # export would 500. Write a header-only CSV and report zero rows.
    body = page.content()
    export = page.locator("#lnkExport")
    if _NO_DATA_MARKER in body or export.count() == 0:
        dest.write_text(_CSV_HEADER, encoding="utf-8")
        return 0

    # Clicking export opens a DownloadFile.aspx popup; in that popup the
    # "View/Save" link streams the actual CSV as a download.
    with page.context.expect_page() as popup_info:
        export.first.click()
    popup = popup_info.value
    popup.wait_for_load_state("networkidle")
    try:
        with popup.expect_download() as dl_info:
            popup.locator("#hypFileDownload").click()
        download = dl_info.value
        download.save_as(str(dest))
    finally:
        popup.close()

    with open(dest, encoding="utf-8", errors="replace") as fh:
        return max(0, sum(1 for _ in fh) - 1)
