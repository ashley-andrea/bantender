# Tender Pricing Assistant

Turns a public HVAC tender (PDF) into a transparent, reviewable first price for an estimator.
Built for the Equans case at the sprintd hackathon (October 2026).

**Principles:** deterministic where possible, AI only where it clearly helps (budget-capped), every number traceable to a tender page or a reference-data row, company data stays on the server, Azure-ready.

## Current state — layer 1 (foundation)

| Area | Status | Proof |
| --- | --- | --- |
| Company reference data (catalogue, productivity rules, parameters) loaded server-side, versioned folder | done | `tests/test_pricing_golden.py::test_reference_counts` |
| Pricing engine (line costs, project build-up, bid scenarios, award points) with a formula trace on every number | done | 22/22 golden positions, subset totals and all 3 scenarios reproduced exactly |
| PDF reading (PyMuPDF rows, fonts, boxes) + page classification | done | 202 pages: 121 LV, 12 component lists; 6 systems with correct page ranges and lots |
| LV segmentation (quantity rows + item header + attributes) | done | 251 lines; 22/22 verified examples found, 20/20 sizes correct, 22/22 systems correct |
| Size / unit / number normalisers (Ø cm → DN, B×H labels, inline DN tables, type codes, m² superscripts) | done | `tests/test_normalize.py` |
| Component lists (CAD duct/fitting tables) | done | hand-checked LA01 round-duct lengths 4/4 |
| Red flags (header mislabels pp.181–195, Ø 1155 cm typo p.78, blank quantity p.169) | done | `tests/test_parsing_tender.py` |
| Docling cross-check (tables, figures; cached, models baked into the image) + parser benchmark | done | `benchmarks/results/parse_bench.md` |
| API: upload PDF → parsed lines; PDF download; reference summary | done | `tests/test_api.py` |
| Server stack (Docker, Compose, Caddy HTTPS) | built and tested in Docker: HTTPS → API, upload parses 202 pages in 0.6 s; Docling runs offline in the container | `make smoke` |
| Matching, statuses, review UI, database, worker | next layers | — |

No OpenAI calls are made anywhere yet (`AI_PROVIDER=off`).

## Known follow-ups

- The API image is 5.9 GB because Docling + PyTorch (CPU) + models are in it. Next layer: a slim API image without Docling, and Docling only in the worker image.
- Docling runs synchronously when `DOCLING_TABLES=true`; it moves to the background worker with the database layer.

## Parser benchmark

Six configurations on the full tender, no OpenAI calls ([details](backend/benchmarks/results/parse_bench.md), regenerate with `make bench`):

| Config | LV lines | Examples found | Sizes correct | Component rows (independent count: 469) |
| --- | --- | --- | --- | --- |
| A PyMuPDF rows + bold headers | 251 | 22/22 | 20/20 | 468 |
| B PyMuPDF without fonts | 251 | 22/22 | 19/20 | 468 |
| C Docling layout, text only | 210 | 17/22 | 13/20 | 468 |
| D Docling + TableFormer accurate | 46 | 1/22 | 0/20 | 396 |
| E Docling + TableFormer fast | 111 | 4/22 | 2/20 | 282 |
| F A for lines + D for tables | 251 | 22/22 | 20/20 | 396 |

**Decision:** PyMuPDF is the primary reader (about 1 s per tender). With table structure on, Docling reads each LV page as one big table cell and drops about 15% of the component-list rows. Docling stays in the pipeline as an independent cross-check (`DOCLING_TABLES=true`), flagging pages where the two readers disagree. It also detects figures and is the route for scanned or unfamiliar layouts.

## Layout

```
backend/
  app/reference/   company reference data models + loader
  app/pricing/     deterministic pricing engine + scenarios
  app/parsing/     PyMuPDF layer, Docling layer, LV segmentation, normalisers, evaluation
  app/api/         FastAPI app
  tests/           golden, parsing, normaliser and API tests
  benchmarks/      parser configuration benchmark
data/
  reference/v1/    seed of the company reference data (internal)
  samples/         the Oberglatt tender + verified examples (test fixtures)
deploy/Caddyfile   HTTPS reverse proxy for our server
docker-compose.yml server stack (mirrors the Azure target)
```

## Run

```bash
make test        # all tests, ~5 s, no network
make bench-fast  # parser benchmark without Docling
make bench       # full benchmark incl. Docling (first run converts and caches)
make api         # dev API on :8000
make smoke       # smoke-test a running stack (BASE=https://your-domain)
```

On the server: copy `.env.example` to `.env`, set `DOMAIN`, then `make deploy` (git pull → docker compose up -d --build). Caddy obtains the HTTPS certificate automatically.

## Azure path

Every server component maps 1:1 to an Azure service (Caddy → Front Door, containers → Container Apps, volume → Blob Storage, PostgreSQL → Flexible Server, OpenAI → Azure OpenAI). Configuration is environment-only; storage and AI sit behind interfaces with a `local` / `openai` implementation now and an Azure one next.
