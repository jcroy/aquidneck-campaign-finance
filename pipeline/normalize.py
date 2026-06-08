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


import glob
import os
import pandas as pd
from pipeline.entities import donor_key


def load_raw_csvs(raw_dir, pattern="*.csv") -> pd.DataFrame:
    """Concatenate every raw export CSV in raw_dir (all columns as strings).

    Each CSV is named ``<org_id>.csv`` (we fetch one file per committee), so we
    tag every row with the source committee's OrgID from the filename. That is
    the reliable join key to committee metadata -- far better than matching the
    filing's free-text OrganizationName, which drifts in whitespace/punctuation.
    Non-numeric filenames (e.g. test fixtures) get an empty tag and fall back to
    name matching downstream.
    """
    frames = []
    for path in sorted(glob.glob(os.path.join(str(raw_dir), pattern))):
        frame = pd.read_csv(path, dtype=str, keep_default_na=False)
        stem = os.path.splitext(os.path.basename(path))[0]
        frame["_src_org_id"] = stem if stem.isdigit() else ""
        frames.append(frame)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _norm_name(name) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip().upper())


def normalize_contributions(df, committees) -> pd.DataFrame:
    """Clean, dedupe, and enrich raw rows into the canonical contributions table.

    Each row is matched to its committee by source OrgID (from the CSV filename)
    when available, falling back to a normalized OrganizationName match. The
    recipient name is canonicalized to the committee's discovered name so filing
    variants (double spaces, punctuation) collapse to a single candidate.
    """
    if df.empty:
        return df
    df = df.drop_duplicates(subset=["ContributionID"]).copy()
    by_org_id = {str(c["org_id"]): c for c in committees if c.get("org_id")}
    by_name = {_norm_name(c["name"]): c for c in committees}

    src_org_id = df["_src_org_id"] if "_src_org_id" in df.columns else [""] * len(df)
    org_names = df["OrganizationName"].str.strip()
    committee_for = [
        by_org_id.get(str(oid)) or by_name.get(_norm_name(name)) or {}
        for oid, name in zip(src_org_id, org_names)
    ]

    csz = df["CityStZip"].apply(parse_city_state_zip)
    out = pd.DataFrame({
        "contribution_id": df["ContributionID"].astype(str),
        "donor_name": df["FullName"].str.strip(),
        "employer": df["EmployerName"].str.strip(),
        "amount": pd.to_numeric(df["Amount"], errors="coerce").fillna(0.0),
        "receipt_date": df["ReceiptDate"].apply(clean_date),
    })
    out["recipient_name"] = [c.get("name", n) for c, n in zip(committee_for, org_names)]
    out["office"] = [c.get("office", "Unknown") for c in committee_for]
    out["town"] = [c.get("town", "Unknown") for c in committee_for]
    out["donor_city"] = [t[0] for t in csz]
    out["donor_state"] = [t[1] for t in csz]
    out["donor_zip"] = [t[2] for t in csz]
    out["year"] = out["receipt_date"].apply(lambda d: int(d[:4]) if d else None)
    out["type"] = [classify_type(cd, tt) for cd, tt in zip(df["ContDesc"], df["TransType"])]
    out["donor_key"] = [donor_key(n, z) for n, z in zip(out["donor_name"], out["donor_zip"])]
    return out
