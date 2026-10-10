from __future__ import annotations

from dataclasses import dataclass, field

BBox = tuple[float, float, float, float]  # x0, y0, x1, y1 in PDF points


class SrcText(str):
    """A text row that remembers where it was printed (page and box), so every attribute can be traced."""

    page: int
    bbox: BBox

    def __new__(cls, text: str, page: int, bbox: BBox):
        obj = super().__new__(cls, text)
        obj.page, obj.bbox = page, tuple(bbox)
        return obj

    def __reduce__(self):
        return (SrcText, (str(self), self.page, self.bbox))


@dataclass
class Segment:
    """A run of text on one visual row, separated from its neighbours by a column gap."""
    text: str
    bbox: BBox
    bold: bool

    @property
    def x0(self) -> float:
        return self.bbox[0]


@dataclass
class Row:
    page: int  # 1-based
    y: float
    segments: list[Segment]

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segments)

    @property
    def bbox(self) -> BBox:
        xs0, ys0, xs1, ys1 = zip(*(s.bbox for s in self.segments))
        return (min(xs0), min(ys0), max(xs1), max(ys1))

    @property
    def bold(self) -> bool:
        return all(s.bold for s in self.segments)


@dataclass
class PageInfo:
    page: int
    kind: str  # conditions | lv | component_list | plans | cover
    header_system: str | None = None  # system code printed in the page header, e.g. "244.03"
    unit_x: float | None = None  # left edge of the unit column (LV pages)
    qty_x: float | None = None
    price_x: float | None = None


@dataclass
class LVLine:
    line_id: str
    page: int
    system: str  # e.g. "244.05" (document order, not page header)
    system_name: str
    lot: str  # "1" | "2"
    section: str  # A..F or ""
    section_name: str
    header: str  # bold item header
    shared_text: list[str]  # attribute rows shared by all sizes of the item
    local_text: list[str]  # rows that belong only to this quantity row
    quantity: float | None
    unit_raw: str
    unit: str | None
    row_bbox: BBox
    header_page: int | None
    header_bbox: BBox | None
    flags: list[str] = field(default_factory=list)
    # Rows printed after the quantity row (e.g. an air-handling unit's data below its head row).
    trailing_text: list[str] = field(default_factory=list)
    # Set when this quantity row names its own (sub-)item within the header's block, e.g. an accessory.
    item_title: str | None = None

    @property
    def description(self) -> str:
        parts = [self.header, *self.shared_text, *self.local_text, *self.trailing_text]
        return " | ".join(p for p in parts if p)


@dataclass
class Anomaly:
    page: int
    code: str
    message: str
    message_de: str = ""


@dataclass
class ComponentRow:
    page: int
    system: str
    table: str  # ducts_rect | ducts_round | fittings_rect | fittings_round
    quantity: float  # mm for ducts, pieces for fittings
    code: str
    name: str
    dims: list[float]
    bbox: BBox | None = None


@dataclass
class ParsedTender:
    pages: list[PageInfo]
    lines: list[LVLine]
    component_rows: list[ComponentRow]
    anomalies: list[Anomaly]
    systems: dict[str, dict]  # code -> {name, lot, location, first_page, last_page}
    project: dict = field(default_factory=dict)  # name, bkp, trade
    lots: dict = field(default_factory=dict)  # lot -> {name, systems}
    award: dict | None = None  # price-scoring rule from the conditions
