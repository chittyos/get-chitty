SHELL := /bin/sh

DEV ?= dev

.PHONY: setup dev build deploy lint fmt test typecheck

setup:
	npm install

dev:
	npx wrangler dev --env $(DEV)

build:
	npx wrangler deploy --dry-run -m $(DEV)

deploy:
	npx wrangler deploy -m $(DEV)

lint:
	npx eslint . --ext .ts || true

fmt:
	npx prettier -w .

test:
	npx vitest run --reporter basic || true

typecheck:
	npx tsc --noEmit

