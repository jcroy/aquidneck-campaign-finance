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


def test_org_id_from_filename_overrides_unmatchable_name(tmp_path):
    # A committee CSV named <org_id>.csv whose filing OrganizationName does NOT
    # match any committee by name must still map to the right committee via the
    # filename OrgID, with the recipient name canonicalized to the committee's
    # discovered name. (Real exports drift in punctuation/wording.)
    header = (
        "ContributionID,ContDesc,IncompleteDesc,OrganizationName,ViewIncomplete,"
        "ReceiptDate,DepositDate,Amount,ContribExplanation,MPFMatchAmount,FirstName,"
        "LastName,FullName,Address,CityStZip,EmployerName,EmpAddress,EmpCityStZip,"
        "ReceiptDesc,BeginDate,EndDate,TransType"
    )
    row = (
        '9001,Individual,,FRIENDS OF JANE DOE,Complete,11/03/2020,,300.00,,0.00,'
        'Pat,Roe,PAT ROE,1 St,"NEWPORT, RI 02840",,,,Check,,,Contribution'
    )
    (tmp_path / "100.csv").write_text(header + "\n" + row + "\n")  # org_id 100 = JANE DOE / Newport
    committees = json.loads((FIX / "committees.json").read_text())
    n = normalize_contributions(load_raw_csvs(tmp_path, pattern="100.csv"), committees)
    assert set(n["town"]) == {"Newport"}
    assert set(n["recipient_name"]) == {"JANE DOE FOR COUNCIL"}
