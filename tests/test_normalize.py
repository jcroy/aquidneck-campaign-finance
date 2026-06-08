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
