"""One-off: port the notebook tracker's embedded NEO blob into config/capacity.json.

Drops the render-time valuation snapshot (px/cap/baseline — the pipeline's job
now), re-roles ORCL benchmark -> hyperscaler, and adds the private/valuation_b/
confidence fields the /capacity spec introduces. Kept for provenance."""
import json
import re
from pathlib import Path

SRC = Path.home() / "Development/notebook/public-equity/neocloud-capacity-tracker.html"
DST = Path(__file__).parent.parent / "config" / "capacity.json"

html = SRC.read_text()
blob = json.loads(re.search(r"/\*NEO-DATA-START\*/(.*?)/\*NEO-DATA-END\*/",
                            html, re.S).group(1))

companies = []
for c in blob["companies"]:
    c = dict(c)
    c.pop("px", None)
    c.pop("cap", None)
    if c["t"] == "ORCL":
        c["role"] = "hyperscaler"
        c["dupe"] = None
    c["private"] = False
    c["valuation_b"] = None
    c["confidence"] = "filed"
    companies.append(c)

out = {"schema_version": 1,
       "as_of_curated": blob["as_of"],
       "note": blob["note"],
       "basis": blob["basis"],
       "companies": companies,
       "tenants": blob["tenants"],
       "geo": blob["geo"],
       "geo_unmapped": blob["geo_unmapped"],
       "geo_note": blob["geo_note"]}
DST.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {DST}: {len(companies)} companies, {len(out['tenants'])} tenant edges, "
      f"{len(out['geo'])} geo sites")
