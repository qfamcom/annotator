# Codex Run Prompt Template

## Anchor
- Domain anchor: infra|app|connector
- Current phase:

## Objective
- Single run objective:

## Inputs
- Required spec files:
- Required contract files from `mesh_bus/`:

## Phase 0 Question Gate (Required when current phase is 0)
- Minimum 10 clarifying questions
- Top 3 risk assumptions
- Blocking questions list
- Rule: stop and wait for human answers before entering Phase 1

## Phase 1 Technical Gate (Required when current phase is 1)
- Minimum 8 technical clarifying questions across frontend, backend, data, and integration boundaries
- Frontend spec must include: UI surface map, state management approach, data-fetch/caching approach, and frontend test plan
- Backend spec must include: service/module boundaries, endpoint inventory, request/response shapes, persistence model, and error model
- NFR spec must include: authN/authZ approach, observability plan, performance targets, and deployment constraints
- Rule: stop and wait for human answers when technical blockers remain

## Constraints
- No cross-domain implementation edits
- No dependency additions unless explicitly approved
- Keep changes scoped to objective

## Deliverables
- Files to create/edit:
- Validation output expected:

## Exit Criteria
- What must be true before run ends:
  - For Phase 0: blocking questions are answered or explicitly waived by a human
  - For Phase 1: frontend/backend/NFR specifications are concrete and blockers are resolved or explicitly waived by a human
