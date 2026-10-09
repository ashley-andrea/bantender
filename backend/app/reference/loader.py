from __future__ import annotations

import csv
import json
from pathlib import Path

from .models import CatalogItem, ProductivityRule, ProjectParameters, ReferenceData


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_reference(directory: Path) -> ReferenceData:
    """Load one reference-data version (catalog.csv, productivity.csv, project_parameters.json)."""
    catalog = {}
    for row in _read_csv(directory / "catalog.csv"):
        row["supplier_quote_required"] = row["supplier_quote_required"].strip().lower() == "true"
        item = CatalogItem.model_validate(row)
        catalog[item.product_id] = item

    rules = {}
    for row in _read_csv(directory / "productivity.csv"):
        keys = row.pop("factor_keys") or ""
        rule = ProductivityRule.model_validate({**row, "factor_keys": [k for k in keys.split("|") if k]})
        rules[rule.install_code] = rule

    raw = json.loads((directory / "project_parameters.json").read_text(encoding="utf-8"))
    parameters = ProjectParameters.model_validate(raw)
    return ReferenceData(version=directory.name, catalog=catalog, rules=rules, parameters=parameters)
