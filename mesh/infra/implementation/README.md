# Infra Implementation - v0.1.0 Annotation Workflow

This folder contains Phase 2 infrastructure prerequisites only.

## Scope
- Local infra scaffold for:
  - metadata database
  - export job queue/cache
  - object storage for uploads/exports
- Environment template for runtime limits and connection variables.
- Smoke-check script for basic service readiness.

## Files
- `docker-compose.infra.yml`: local service stack (Postgres, Redis, MinIO).
- `.env.infra.example`: required config variables and v1 limits.
- `scripts/smoke_check.sh`: validates local services are reachable.

## Local Bring-up
1. Copy `.env.infra.example` to `.env.infra` and set secrets.
2. Start services:
   - `docker compose -f docker-compose.infra.yml --env-file .env.infra up -d`
3. Run smoke check:
   - `./scripts/smoke_check.sh`

## Notes
- JPG export must be ZIP with one JPG per page (aligned with PRD).
- Limits are fixed for v1 acceptance: 50 MB input size, 100 pages max.
- No app or connector code should be added in this phase.
