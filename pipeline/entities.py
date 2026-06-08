"""Stage 3: approximate donor grouping key (name + zip)."""
import re


def donor_key(full_name, zip_code=None):
    """Approximate donor identity: normalized name + zip."""
    name = re.sub(r"[^A-Z0-9 ]", "", str(full_name or "").upper())
    name = re.sub(r"\s+", " ", name).strip()
    z = str(zip_code).strip() if zip_code else ""
    return f"{name}|{z}"
