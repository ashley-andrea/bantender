#!/usr/bin/env bash
# Smoke test of a running stack: health, reference summary, upload + parse of the sample tender.
set -euo pipefail
BASE="${1:-https://localhost}"
PDF="${2:-data/samples/oberglatt/BKP_244_LV_Lueftung_260804.pdf}"
curl -sfk "$BASE/api/healthz" | grep -q '"status":"ok"' && echo "health ok"
curl -sfk "$BASE/api/reference" | grep -q '"catalog_items":126' && echo "reference ok"
RESULT=$(curl -sfk -F "file=@$PDF" "$BASE/api/tenders")
echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["lines"]>=240 and len(d["systems"])==6, d; print("upload ok:", d["pages"], "pages,", d["lines"], "lines,", d["anomalies"], "flags")'
