"""The company's own data (the reference folder: catalogue, productivity rules, parameters, past bids, market
snapshots …), every CSV and JSON file in it, so files added later are covered without code changes.

Queries are computed here, not by the model: the result text is what the answer must quote.
"""

from __future__ import annotations

import csv
from pathlib import Path
from statistics import mean

OPS = ("=", "!=", ">", ">=", "<", "<=", "contains")
FUNCS = ("count", "sum", "mean", "min", "max")
MAX_ROWS = 50


def _num(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fmt(v) -> str:
    if isinstance(v, float):
        return f"{v:.4g}" if abs(v) < 1000 else f"{v:.0f}"
    return str(v)


class CompanyData:
    def __init__(self, directory: Path):
        self.directory = directory
        self.tables: dict[str, list[dict[str, str]]] = {}
        self.documents: dict[str, str] = {}
        for path in sorted(directory.iterdir()):
            if path.suffix == ".csv":
                with path.open(newline="", encoding="utf-8") as fh:
                    self.tables[path.name] = list(csv.DictReader(fh))
            elif path.suffix == ".json":
                self.documents[path.name] = path.read_text(encoding="utf-8")

    def overview(self) -> str:
        """One line per file, for the model's instructions."""
        lines = [f"- {name}: {len(rows)} rows; columns: {', '.join(rows[0]) if rows else '-'}" for name, rows in self.tables.items()]
        lines += [f"- {name}: JSON document (read it whole)" for name in self.documents]
        return "\n".join(lines)

    def query(self, file: str, where: list[dict] | None = None, columns: list[str] | None = None, group_by: list[str] | None = None,
              metrics: list[dict] | None = None, sort_by: str | None = None, descending: bool = False, limit: int = 20) -> tuple[str, str]:
        """Returns (label, result text). Raises ValueError with a message the model can act on."""
        if file in self.documents:
            return file, self.documents[file]
        if file not in self.tables:
            raise ValueError(f"Unknown file {file!r}. Files: {', '.join([*self.tables, *self.documents])}")
        rows = self.tables[file]
        known = set(rows[0]) if rows else set()
        where, group_by, metrics, columns = where or [], group_by or [], metrics or [], columns or []
        for name in [*(w["column"] for w in where), *group_by, *columns, *(m["column"] for m in metrics if m.get("column"))]:
            if name not in known:
                raise ValueError(f"Unknown column {name!r} in {file}. Columns: {', '.join(rows[0])}")

        rows = [r for r in rows if all(_match(r[w["column"]], w["op"], str(w["value"])) for w in where)]
        cond = " and ".join(f"{w['column']} {w['op']} {w['value']}" for w in where)
        label = f"{file}{f' where {cond}' if cond else ''}: {len(rows)} rows"

        if group_by or metrics:
            metrics = metrics or [{"fn": "count", "column": None}]
            groups: dict[tuple, list[dict]] = {}
            for r in rows:
                groups.setdefault(tuple(r[g] for g in group_by), []).append(r)
            header = [*group_by, *(m["fn"] if not m.get("column") else f"{m['fn']}({m['column']})" for m in metrics)]
            table = [[*key, *(_aggregate(m, members) for m in metrics)] for key, members in groups.items()]
        else:
            header = columns or (list(rows[0]) if rows else [])
            table = [[r[c] for c in header] for r in rows]

        if sort_by:
            if sort_by not in header:
                raise ValueError(f"sort_by must be one of: {', '.join(header)}")
            i = header.index(sort_by)
            table.sort(key=lambda row: (_num(str(row[i])) is None, _num(str(row[i])) or 0, str(row[i])), reverse=descending)
        limit = max(1, min(limit, MAX_ROWS))
        shown = table[:limit]
        text = "\n".join([label + (f", showing {len(shown)}" if len(table) > len(shown) else ""),
                          ",".join(header), *(",".join(_fmt(v) for v in row) for row in shown)])
        return label, text


def _match(value: str, op: str, target: str) -> bool:
    if op not in OPS:
        raise ValueError(f"op must be one of {OPS}")
    if op == "contains":
        return target.lower() in value.lower()
    a, b = _num(value), _num(target)
    if a is not None and b is not None:
        return {"=": a == b, "!=": a != b, ">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]
    a_s, b_s = value.strip().lower(), target.strip().lower()
    return {"=": a_s == b_s, "!=": a_s != b_s, ">": a_s > b_s, ">=": a_s >= b_s, "<": a_s < b_s, "<=": a_s <= b_s}[op]


def _aggregate(metric: dict, rows: list[dict]):
    fn, column = metric["fn"], metric.get("column")
    if fn not in FUNCS:
        raise ValueError(f"fn must be one of {FUNCS}")
    if fn == "count":
        return len(rows)
    if not column:
        raise ValueError(f"{fn} needs a column")
    values = [v for v in (_num(r[column]) for r in rows) if v is not None]
    if not values:
        return "-"
    return {"sum": sum, "mean": mean, "min": min, "max": max}[fn](values)
