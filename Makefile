.PHONY: test bench bench-fast api deploy logs smoke crosscheck

test:            ## run all backend tests (no OpenAI calls)
	cd backend && uv run pytest -q

bench-fast:      ## parser benchmark without Docling (seconds)
	cd backend && uv run python -m benchmarks.parse_bench --skip-docling

bench:           ## full parser benchmark incl. Docling configurations (minutes; cached after first run)
	cd backend && uv run --extra docling python -m benchmarks.parse_bench

crosscheck:      ## Docling cross-check of all stored tenders, in its own container
	docker compose --profile docling run --rm docling crosscheck --all

api:             ## run the API for development
	cd backend && uv run uvicorn app.api.main:app --reload --port 8000

deploy:          ## on the server: pull, rebuild and restart
	git pull --ff-only && docker compose up -d --build && docker compose ps

logs:
	docker compose logs -f --tail=100

smoke:           ## smoke-test a running stack (default https://localhost)
	./deploy/smoke.sh $(BASE)
