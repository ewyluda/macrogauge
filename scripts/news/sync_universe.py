#!/usr/bin/env python3
"""Refresh config/ai_news.json's `universe` from the notebook's AI-infra taxonomy.

The notebook (~/Development/notebook) curates the 11-layer AI-infrastructure
taxonomy; /news filters the caktus tape to exactly those names plus the
hand-kept `extra_universe` (share-class aliases and names the taxonomy has no
row for). Every other config key is left alone. Reinstall the live exporter
afterwards (scripts/news/install_live_exporter.sh) so the Mac copy matches.

    python3 scripts/news/sync_universe.py [--taxonomy PATH]
"""
import argparse
import json
from datetime import date
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "config" / "ai_news.json"
TAXONOMY = Path.home() / "Development/notebook/public-equity/data/ai_infra_taxonomy.json"


def merge(cfg: dict, taxonomy: list) -> dict:
    layers, universe = [], {}
    for layer in taxonomy:
        layers.append(layer["name"])
        for sub in layer["subcategories"]:
            for co in sub["companies"]:
                universe.setdefault(co["ticker"], {"name": co["name"], "layer": layer["name"]})
    for ticker, row in cfg.get("extra_universe", {}).items():
        if row["layer"] not in layers:
            raise ValueError(f"extra_universe {ticker}: unknown layer {row['layer']!r}")
        universe.setdefault(ticker, row)
    return {**cfg, "layers": layers, "universe": dict(sorted(universe.items())),
            "as_of_curated": date.today().isoformat()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--taxonomy", type=Path, default=TAXONOMY)
    args = ap.parse_args()
    cfg = merge(json.loads(CONFIG.read_text()), json.loads(args.taxonomy.read_text()))
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
    print(f"{CONFIG}: {len(cfg['universe'])} tickers across {len(cfg['layers'])} layers")


if __name__ == "__main__":
    main()
