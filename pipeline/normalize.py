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
