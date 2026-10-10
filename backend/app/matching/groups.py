"""Parent/child structure of the LV positions, for display (the prices stay per line).

Two kinds of children:
- variants: positions in the same item block that are the same thing in another size or quantity
  (e.g. "Abluft - Tellerventil" DN100 × 5 and DN125 × 6). They get a virtual parent that sums them.
- parts: accessories priced or listed on their own line that belong to the item before them
  (an air-handling unit's "Zubehör", a rain cap's colour coating, a louvre hood's base pipe).

Same thing = same lexicon rule, same name, same unit and the same catalogue family; so a ground-duct block
splits into pipes (m), bends (pc) and the single fittings instead of adding metres to pieces.
"""

from __future__ import annotations

PART_RULES = {"accessory", "ahu_part", "colour_coating", "base_pipe", "mounting_frame", "install_kit"}
# Parts that follow their parent across item blocks (the AHU's accessory lists have their own bold header).
PARENT_RULE = {"ahu_part": "ahu"}


def assign_groups(rows: list[dict], lines: dict[str, dict], subcategory: dict[str, str]) -> None:
    """Add `group` to every LV row in place: None, {"kind": "variant", ...} or {"kind": "part", "parent": ...}."""
    lv = [r for r in rows if r["source"] == "lv"]
    for r in rows:
        r["group"] = None

    def block(r):
        line = lines[r["line_id"]]
        return (r["system"], r["section"], line.get("header_page"), line.get("header"))

    def variant_key(r):
        d = r["decision"]
        return (d["rule_key"], r["title_en"], d["unit"], subcategory.get(d["product_id"] or "", ""))

    # 1. Variants: same block, same variant key, at least two lines.
    members: dict[tuple, list[dict]] = {}
    for r in lv:
        if r["decision"]["rule_key"] not in PART_RULES:
            members.setdefault((block(r), variant_key(r)), []).append(r)
    for group in members.values():
        if len(group) < 2:
            continue
        gid = f"g:{group[0]['line_id']}"
        for i, r in enumerate(group):
            r["group"] = {"kind": "variant", "id": gid, "index": i, "count": len(group)}

    # 2. Parts: attach to the latest main item of the same block (or, for AHU parts, of the same system).
    last_main: dict | None = None
    for r in lv:
        rule = r["decision"]["rule_key"]
        if rule not in PART_RULES:
            last_main = r
            continue
        if last_main is None or last_main["system"] != r["system"]:
            continue
        same_block = block(last_main) == block(r)
        follows_parent = PARENT_RULE.get(rule) == last_main["decision"]["rule_key"]
        if same_block or follows_parent:
            parent = last_main["group"]["id"] if last_main["group"] else last_main["line_id"]
            r["group"] = {"kind": "part", "parent": parent}
