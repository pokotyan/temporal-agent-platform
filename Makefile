.PHONY: start stop restart status build clean install lint

# ── Development ──

## Start all services (Temporal + Workers)
start: build
	@node scripts/tap-service-manager.js start

## Stop all services
stop:
	@node scripts/tap-service-manager.js stop

## Restart all services
restart: build
	@node scripts/tap-service-manager.js restart

## Show service status
status:
	@node scripts/tap-service-manager.js status

## Open TAP Web UI
ui:
	@open http://localhost:8234 2>/dev/null || xdg-open http://localhost:8234 2>/dev/null || echo "Visit: http://localhost:8234"

# ── Build & Quality ──

## Install npm dependencies
install:
	@npm install

## Build all TypeScript packages + frontend
build:
	@npm run build
	@cd frontend && npm install --prefer-offline && npm run build

## Clean build artifacts
clean:
	@npm run clean --workspaces --if-present
	@rm -rf node_modules packages/*/node_modules

## Lint (Biome)
lint:
	@npm run lint

## Type check
typecheck:
	@npm run typecheck

## Run tests
test:
	@npm run test:scripts
