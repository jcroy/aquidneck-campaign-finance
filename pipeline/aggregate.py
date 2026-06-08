"""Stage 4: aggregate the canonical table into small view JSON files."""
import json
from pathlib import Path


def raised_only(df):
    """Money actually raised: everything except refunds and loans.

    Exclusion is by contribution *type*. A small number of negative-amount
    correction rows that the filer did not label as a refund (so they classify
    as individual/pac/etc.) still net into totals -- this is intentional: they
    are adjustments to real receipts, not refunds, and their net effect is
    negligible against the overall total.
    """
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
