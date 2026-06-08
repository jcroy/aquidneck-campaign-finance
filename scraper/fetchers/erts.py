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
