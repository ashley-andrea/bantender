# bantender — from tender to filled-in offer

Turns a public HVAC tender (PDF) into a priced offer, written back into the tender's own LV form.
Every number can be traced to a tender page, a catalogue row or a parameter.
Built for the Equans case at the sprintd hackathon (October 2026).

Estimators told us where the time goes: reading and extracting positions, retyping them into Excel, and writing prices back into the PDF. The calculation itself is simple. So the tool automates the reading and the write-back, and shows the calculation in steps an estimator recognises, so they can check it instead of redoing it.

## The flow

The estimator uploads one PDF. Five steps follow, with the tender page next to the work in every step:

| Step | What the estimator sees | Can change |
| --- | --- | --- |
| 1 Extraction | Positions appearing as the pages are read. Then, for each position, a graph of what the tender says (type, quantity, size, airflow, reference product, system), coloured by certainty. Hovering a node highlights its source in the PDF. | Quantity |
| 2 Catalogue | The same position connected to its catalogue product and net price, plus the installation rule. The matched row is highlighted in its catalogue family. The PDF highlight stays. | Supplier quote (only for supplier-package items) |
| 3 Price | The formula for the position: material + installation = direct cost; × factor m = unit price and amount on the form. Next to it, the project build-up and sliders for every coefficient in `project_parameters.json`. The offer price in the top bar follows each change. | Hours per unit, every parameter, location per system |
| 4 Offer options | Reserved for the AI bid-optimisation loop (aggressive / conservative variants with acceptance probability). Placeholder only. | — |
| 5 Fill & export | The original PDF with all prices written in (each filled field outlined), conditions from p.2, download. | Discount, cash discount |

Flags are limited to the cases that need a person: 28 supplier-package items waiting for a quote, and one position whose quantity the tender leaves blank.

## Writing back into the tender

The tender requires the original LV to be returned filled in, with the text unchanged (p.97: "zwingend das zugestellte Originalleistungsverzeichnis ausgefüllt einzureichen"). The filler only adds numbers. It finds each field from the page itself (the column under "Einheitspreis" / "Betrag", the row of the position, the dotted placeholders) and writes into the blank space, so nothing is hardcoded to this tender.

What is filled (Oberglatt, 610 fields):
- unit price and amount of every priced position, "inkl." where a position is included elsewhere;
- per section: "Total" rows; in section E: "Montage und Transport", "Dienstleistungen", the hygiene inspection, the CAD material ("Materialauszug") and the installation days;
- p.3 cost summary per system and lot, "Eingabesumme Los n", "Total Eingabesumme";
- p.2 BKP table (gross / net) and the conditions: discount, cash discount, deductions 1.30 %, VAT 8.1 % (both rates read from the form).

**How prices reach the form.** SIA 118 Art. 39: surcharges are included in the unit prices. So one factor, m = offer price ÷ direct cost, is applied to every cost component. That spreads project costs, overhead, risk and margin evenly, and the filled form adds up to the offer price within centimes of rounding. Items in sections A–D carry supply prices; their installation goes to "Montage und Transport" in section E, as the form asks. Insulation (F, "inkl. Montage") and install-only items keep their labour.

## The calculation

Per position:
- material = quantity × catalogue net price × (1 + waste %);
- hours = quantity × hours per unit × productivity factors (site efficiency as 1/x; mounting height by system location);
- labour = hours × hourly rate;
- direct cost = material + labour.

Project:
- direct cost = Σ positions + transport % + small material % + supplier contingency % + engineering + commissioning + hygiene + documentation;
- baseline = (direct + risk) × (1 + overhead %);
- offer price = baseline ÷ (1 − margin %), rounded up to CHF 1'000.

All rates come from the company's reference data (`data/reference/v2`) or the estimator's edits, which are logged (`GET /api/tenders/{id}/audit`).

## Results on the Oberglatt tender

With the company parameters unedited:
- **Offer price CHF 2'461'000** (margin 5.5 %); factor m = 1.1484;
- form gross total CHF 2'461'001.42; net incl. VAT CHF 2'625'758.08;
- 254 positions read: 22 included elsewhere or out of scope, 232 to price, 231 priced (192 calculated, 39 provisional: 28 supplier quotes, 11 assumptions), 1 without quantity;
- 77 further lines derived from the CAD component lists (ducts per DN and m², bends).

Extraction is checked independently: every unit in the LV's unit column has an extracted position, and the 22 verified example positions are all found with the right product (`tests/`).

**Reference data v2.** The provided catalogue (56 items) covers less than half the positions. We were told the catalogue is not the focus, so `data/reference/v2` keeps every v1 row unchanged and adds 70 synthetic catalogue items and 18 productivity rules (grilles, louvres, kitchen, ground ducts, services …). Replacing them with real company data means replacing two CSV files.

## Run it

Needs Docker.

```bash
cp .env.example .env          # set DOMAIN=localhost for a local run
docker compose up -d --build  # caddy (HTTPS) + web + api
open https://localhost        # accept the local certificate once
```

Drop `data/samples/oberglatt/BKP_244_LV_Lueftung_260804.pdf` on the upload screen. ↑/↓ moves through positions. EN/DE in the top bar.

```bash
make test   # backend tests, ~10 s, no network
make smoke  # smoke-test a running stack (BASE=https://your-domain)
make e2e    # walk the five steps in a browser; numbers on screen must match the API
make api    # dev API on :8000
cd frontend && npm install && npm run dev   # UI with hot reload on :5173, proxies /api to https://localhost
```

On the server: `.env` with the real `DOMAIN`, then `make deploy`. Caddy obtains the certificate.

## Layout

```
backend/app/
  parsing/     PyMuPDF rows → page kinds → LV positions with source boxes; tender facts (lots, conditions)
  matching/    lexicon (German HVAC terms → catalogue), product choice by size, CAD duct lines, attributes with certainty
  pricing/     engine (line + project formulas with trace), service (overrides, settings), scenarios (hook for the AI loop)
  offer/       build.py: prices on the form; pdf_fill.py: write them into the original PDF
  api/         FastAPI
backend/tests/ golden positions, parsing completeness, matching, offer reconciliation, API
data/reference/v1, v2   company reference data (server-side; v2 = v1 + synthetic rows)
data/samples/  the Oberglatt tender and the verified examples
frontend/      React + Vite + Tailwind; components/steps/ holds the five steps
e2e/flow.mjs   browser walk-through of the flow
deploy/        Caddyfile, smoke test
docs/          flow and infrastructure diagrams, parser decision
```

Parser choice: PyMuPDF alone, about one second per tender. Docling was benchmarked and removed ([docs/parser-benchmark.md](docs/parser-benchmark.md)).

## Path to production (Azure)

Each server component maps to an Azure service:
- Caddy → Front Door;
- containers → Container Apps;
- storage volume → Blob Storage;
- OpenAI → Azure OpenAI, for the bid-optimisation loop.

Configuration comes from environment variables only. Storage sits behind an interface with a local implementation now; an Azure one plugs in without code changes elsewhere. Reference data is a versioned folder the company maintains. No OpenAI calls are made today (`AI_PROVIDER=off`).
