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
| API: upload PDF → parsed lines; PDF download; tender list; reference summary | done | `tests/test_api.py` |
| Web client v0: upload with live stages, workspace (systems tree, lines table, line detail, PDF viewer with source highlight, red-flags panel) | done | screenshots checked with Playwright |
| Server stack (Docker, Compose, Caddy HTTPS) | built and tested in Docker: HTTPS → API, upload parses 202 pages in 0.6 s; Docling runs offline in the container | `make smoke` |
| Matching (German HVAC lexicon → catalogue by size), confidence checklist, 7 statuses | done | 22/22 golden products + statuses; every line classified |
| Install-only field devices (labour only), air-handling units sized by airflow, project costs not double-counted | done | `tests/test_matching.py` |
| Ductwork derived from the CAD component lists (m, m², bends; other fittings labour only) | done | 77 derived lines, each citing its list pages |
| Pricing service: overrides, settings, audit log; full build-up and bid scenarios | done | `tests/test_api.py` |
| Web client v1: prices, status filters, why-this-price, estimator actions, price build-up, scenarios, award points, EN/DE | done | Playwright edit flow: price updates and resets |
| Database (PostgreSQL), RFQ packs, exports, tender facts (LLM) | next layers | — |

No OpenAI calls are made anywhere yet (`AI_PROVIDER=off`).

Current result on the Oberglatt tender, before any estimator edits: indicative price CHF 1'758'000 at the 5.5 % target margin; 112 of 229 tender lines to price are priced (67 calculated, 45 provisional), 117 are unpriced (116 not in the 56-item catalogue, 1 without quantity); 22 lines are excluded; 77 further lines are derived from the CAD component lists.

## How the numbers are defined

Counts use **tender lines** only (lines read from the LV). Lines derived from the CAD component lists are priced and shown, but counted separately.

| Term | Definition |
| --- | --- |
| Excluded | Status `out_of_scope` (covered by project costs, by others, or excluded by the estimator) or `non_priceable` (part of a package, text only) |
| To price | Tender lines − excluded |
| Priced | To-price lines with a computed cost: `calculated`, `supplier_quote_required`, `assumption_applied`, or `review_required` with a price |
| Calculated | Priced with no open question (status `calculated`) |
| Provisional | Priced − calculated: a supplier quote, an assumption or a review is still open |
| Unpriced | To price − priced = "Needs price" (no catalogue item) + "Missing info" (no quantity) |
| Coverage | Priced ÷ to price |

Money, per line: material = quantity × net unit cost × (1 + waste %); hours = quantity × base hours × the rule's project factors (site efficiency as 1/x; the mounting-height factor follows the system's location); labour = hours × hourly rate; line cost = material + labour.
Project: direct cost = Σ line costs + transport % × Σ line costs + small material % × catalogue material + contingency % × supplier-package material + engineering + commissioning + hygiene + documentation; baseline = (direct + risk) × (1 + overhead %); indicative price = baseline ÷ (1 − margin %), rounded up to the rounding step. All percentages and steps come from `project_parameters.json` or the estimator's settings.
Scenarios use the win-probability model in the parameters; award points use the scoring rule read from the tender's conditions (hidden if the tender states none).

Invariants are tested (`tests/test_matching.py::test_summary_counts_and_formulas_add_up`) and the UI is checked against the API (`make e2e`).

## Known follow-ups

- Docling is optional: the API image (≈420 MB) has none of it; the cross-check runs in its own image on demand (`make crosscheck`).

## Parser benchmark

Six configurations on the full tender, no OpenAI calls ([details](backend/benchmarks/results/parse_bench.md), regenerate with `make bench`):

| Config | LV lines | Examples found | Sizes correct | Component rows (independent count: 457) |
| --- | --- | --- | --- | --- |
| A PyMuPDF rows + bold headers | 251 | 22/22 | 20/20 | 457 |
| B PyMuPDF without fonts | 251 | 22/22 | 19/20 | 457 |
| C Docling layout, text only | 210 | 17/22 | 13/20 | 457 |
| D Docling + TableFormer accurate | 46 | 1/22 | 0/20 | 396 |
| E Docling + TableFormer fast | 111 | 4/22 | 2/20 | 282 |
| F A for lines + D for tables | 251 | 22/22 | 20/20 | 396 |

**Decision:** PyMuPDF is the primary reader (about 1 s per tender). With table structure on, Docling reads each LV page as one big table cell and drops about 15% of the component-list rows. Docling is kept out of the main image; it runs as an optional cross-check in its own container (`make crosscheck`), flagging pages where the two readers disagree. It also detects figures and is the route for scanned or unfamiliar layouts.

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
frontend/          React + Vite + Tailwind web client (served by Caddy in its own container)
deploy/Caddyfile   HTTPS reverse proxy for our server
docker-compose.yml server stack (mirrors the Azure target)
```

## See it locally

Needs Docker running.

```bash
cp .env.example .env          # then set DOMAIN=localhost in .env
docker compose up -d --build  # caddy (HTTPS) + web + api
open https://localhost        # accept the local certificate once (Caddy issues it for localhost)
```

Drop `data/samples/oberglatt/BKP_244_LV_Lueftung_260804.pdf` on the upload screen. Click any line to see the tender page with the source row highlighted. ↑/↓ moves through lines.

UI development with hot reload (the Docker stack keeps serving the API):

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api to https://localhost
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
