| config | seconds | lines | examples_found | examples_size_ok | examples_system_ok | component_rows | hand_check |
|---|---|---|---|---|---|---|---|
| A pymupdf | 0.8 | 251 | 22/22 | 20/20 | 22/22 | 457 | 4/4 |
| B pymupdf_nobold | 0.0 | 251 | 22/22 | 19/20 | 22/22 | 457 | 4/4 |
| C docling_text | 7.1 | 210 | 17/22 | 13/20 | 17/22 | 457 | 4/4 |
| D docling_tables | 0.2 | 46 | 1/22 | 0/20 | 1/22 | 396 | 4/4 |
| E docling_fast | 0.1 | 111 | 4/22 | 2/20 | 4/22 | 282 | 0/4 |
| F hybrid (A lines + D tables) | 1.0 | 251 | 22/22 | 20/20 | 22/22 | 396 | 4/4 |

Notes (Oberglatt tender, 202 pages; Apple M-series CPU; no OpenAI calls):

- `seconds` for C–F is segmentation time on cached Docling output. First-run Docling conversion of pages 67–199 took about 36 s (text), 97 s (tables accurate), 210 s (tables fast).
- Independent check of the component lists with `pdftotext -layout`: 457 data rows (page headers excluded). PyMuPDF reads 457, Docling accurate 396, Docling fast 282.
- With table structure on, Docling treats each LV page as a single one-row table, so LV positions are lost (D, E).
- Decision: PyMuPDF is the primary reader. Docling is an optional cross-check in its own container, for figure detection, and the route for scanned or unfamiliar layouts.
