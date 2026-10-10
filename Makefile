.PHONY: test api deploy logs smoke e2e winprob-data

test:            ## run all backend tests (no OpenAI calls)
	cd backend && uv run pytest -q

winprob-data:    ## regenerate the synthetic bid history + market snapshots (data/reference/v2), deterministic
	cd backend && uv run --extra winprob python -m app.winprob.synthetic --summary

api:             ## run the API for development
	cd backend && uv run uvicorn app.api.main:app --reload --port 8000

deploy:          ## on the server: pull, rebuild and restart
	git pull --ff-only && docker compose up -d --build && docker compose ps

logs:
	docker compose logs -f --tail=100

smoke:           ## smoke-test a running stack (default https://localhost)
	./deploy/smoke.sh $(BASE)

e2e:             ## walk the guided flow against a running stack; numbers on screen must match the API
	cd e2e && npm install --silent && npx playwright install chromium >/dev/null && node flow.mjs $(BASE)
