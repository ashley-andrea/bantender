# Parser decision: PyMuPDF only

Six reader configurations were benchmarked on the full Oberglatt tender (202 pages) before Docling was removed from the project. The benchmark code went with it; the results are kept here as the record of the decision.

| config | seconds | lines | examples_found | examples_size_ok | examples_system_ok | component_rows | hand_check |
|---|---|---|---|---|---|---|---|
| A pymupdf | 0.8 | 251 | 22/22 | 20/20 | 22/22 | 457 | 4/4 |
| B pymupdf_nobold | 0.0 | 251 | 22/22 | 19/20 | 22/22 | 457 | 4/4 |
| C docling_text | 7.1 | 210 | 17/22 | 13/20 | 17/22 | 457 | 4/4 |
| D docling_tables | 0.2 | 46 | 1/22 | 0/20 | 1/22 | 396 | 4/4 |
| E docling_fast | 0.1 | 111 | 4/22 | 2/20 | 4/22 | 282 | 0/4 |
| F hybrid (A lines + D tables) | 1.0 | 251 | 22/22 | 20/20 | 22/22 | 396 | 4/4 |

Notes (Apple M-series CPU; no OpenAI calls):

- `seconds` for C–F is segmentation time on cached Docling output. Docling's first conversion of pages 67–199 took about 36 s (text), 97 s (tables accurate) and 210 s (tables fast).
- Independent check of the component lists with `pdftotext -layout`: 457 data rows (page headers excluded). PyMuPDF read 457, Docling accurate 396, Docling fast 282.
- With table structure on, Docling read each LV page as one single-row table, so LV positions were lost (D, E).

The parser has since improved; it now reads 254 positions. Completeness is checked in `backend/tests/test_parsing_tender.py`.

**Decision:** PyMuPDF is the only reader. It is faster, more complete on this layout, and keeps the image small. Scanned or unfamiliar layouts would need an OCR/layout model; that is a later addition, not part of the main path.
