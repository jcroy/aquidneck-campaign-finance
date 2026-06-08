from pipeline.entities import donor_key


def test_donor_key_normalizes_name_and_zip():
    assert donor_key("John Q. Public", "02840") == "JOHN Q PUBLIC|02840"
    assert donor_key("  acme   pac ", None) == "ACME PAC|"


def test_donor_key_same_person_same_zip_matches():
    assert donor_key("JOHN SMITH", "02840") == donor_key("john smith", "02840")
