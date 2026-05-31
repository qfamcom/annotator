# WORKFLOW

This framework runs in strict sequential phases.

## Phase 0: Ideation and Grilling
- Clarify problem, constraints, users, and success criteria.
- Challenge vague assumptions early.
- Produce first-pass PRD and open questions.
- Raise a minimum of 10 clarifying questions before any spec writing.
- Identify top 3 risk assumptions that could invalidate the plan.
- Mark each open question as `answered`, `waived`, or `blocked`.

### Phase 0 Hard Gate (Required)
- Do not enter Phase 1 until blocking questions are answered or explicitly waived by a human.
- If blocking questions remain, Codex must stop and request answers instead of proceeding.

## Phase 1: Specification Creation
- Write `plan_spec` for infra, app, and connector.
- Resolve conflicts and translate into `execution_spec` per domain.
- Update `mesh_bus` contracts to draft or approved states.
- Produce explicit frontend and backend specifications, not just flow diagrams.
- Record concrete decisions for API shape, data/storage model, auth, testing, observability, and performance targets.

### Phase 1 Hard Gate (Required)
- Do not enter Phase 2 until frontend architecture is specified with component/page boundaries, state/data-fetch approach, and test strategy.
- Do not enter Phase 2 until backend architecture is specified with service boundaries, API endpoints, persistence model, and error handling strategy.
- Do not enter Phase 2 until `mesh_bus/api_contract.json` includes concrete endpoint definitions (methods, paths, request/response schema placeholders with named fields).
- If any Phase 1 technical area remains vague, Codex must stop and request clarification instead of proceeding.

## Phase 2: Infra Build
- Anchor Codex to `infra/`.
- Implement environment and platform prerequisites only.
- Emit state changes to `mesh_bus/infra_state.json`.

## Phase 3: App Build
- Anchor Codex to `app/`.
- Build backend/frontend/domain logic based on approved specs.
- Consume contract definitions from `mesh_bus/api_contract.json`.

## Phase 4: Connector and Integration Build
- Anchor Codex to `connector/`.
- Build adapters, API integrations, mocks, and E2E verification glue.
- Update `mesh_bus/integration_state.json` as checkpoints pass.

## Phase 5: Audit, Fix, and Sign-off
- Run cross-domain checks against contracts and specs.
- Fix drift between implementation and declared interfaces.
- Record sign-off decisions per domain.

## Phase 6: Retrospective and Memory Update
- Capture lessons learned and prevent repeat failures.
- Append outcomes to `memory.md`.
- Seed next project with concrete process improvements.
