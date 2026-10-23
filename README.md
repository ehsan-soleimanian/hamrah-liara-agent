# Golbazar deployment demo

Standalone flower shop for testing Hamrah deployments on Liara.
Node.js 22, PostgreSQL, Docker, port 3000.

## Configuration
- DATABASE_URL: PostgreSQL connection string (required).
- HAMRAH_CONTROL_TOKEN: secret bearer token of at least 32 characters for optional test and recovery controls. Leave unset to disable controls.
- PORT: defaults to 3000.

## Checks
- GET /health: database health.
- GET /api/checkout/check: transactional order write/read/rollback.
- POST /api/orders: persists a test order; no payment is processed.

## Import into Hamrah
Repository: https://github.com/ehsan-soleimanian/hamrah-liara-agent
Branch: golbazar-demo
Project root: leave empty.

Credentials must be supplied through deployment environment variables, never committed.
