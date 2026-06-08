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
