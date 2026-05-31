# Sovereign Triad Mesh (External / Codex Sequential Edition)

## Purpose
This framework is a practical operating system for building software with Codex **without** internal corp tooling.

It prevents "God-prompting" by splitting work into three sovereign domains and enforcing explicit contracts through a shared bus.

> Note: This repo intentionally contains framework structure, specs, templates, and contracts only. No app is built here yet.

## Folder Topology
```text
mesh/
├── mesh_bus/
│   ├── infra_state.json
│   ├── api_contract.json
│   └── integration_state.json
├── framework_discussions/
│   ├── README.md
│   └── artifacts_to_gpt/
├── infra/
│   ├── plan_spec/
│   ├── execution_spec/
│   └── implementation/
├── app/
│   ├── plan_spec/
│   ├── execution_spec/
│   └── implementation/
├── connector/
│   ├── plan_spec/
│   ├── execution_spec/
│   └── implementation/
├── templates/
├── README.md
├── WORKFLOW.md
├── CODEX.md
├── GOTCHAS.md
└── memory.md
```

## Triad Model
1. **infra**: environment, deployment, database, config, secrets, hosting
2. **app**: backend, frontend, domain logic, tests, UI
3. **connector**: integrations, APIs, adapters, mocks, end-to-end verification

Each domain is sovereign in implementation. Coordination happens through specs and `mesh_bus/` contracts.

## Sequential Codex Execution Model
- Only one Codex run should operate at a time.
- Each run anchors to exactly one domain folder.
- Do not jump domains unless the workflow phase requires it.
- Shared truth for cross-domain coordination is `mesh_bus/`.

## Start a New Project
1. Run Phase 0 ideation first and generate at least 10 clarifying questions plus top 3 risk assumptions.
2. Capture product goals using `templates/PRD_TEMPLATE.md`.
3. Resolve or explicitly waive blocking Phase 0 questions before Phase 1.
4. Write domain `plan_spec` files before writing code.
5. Convert approved plans into domain `execution_spec` files.
6. Keep `mesh_bus/*.json` in sync as contracts evolve.
7. Execute implementation sequentially by phase in `WORKFLOW.md`.

## How to Use `framework_discussions/`
- Use it for human-AI design discussion notes and decision logs.
- Keep iterative rationale there, not in production implementation folders.
- Never store secrets.

## How to Package Artifacts for Upload/Review
Use `framework_discussions/artifacts_to_gpt/` as a staging area for one-time upload snapshots:
1. Copy only recently changed framework files you want reviewed.
2. Include a short `INDEX.md` describing what changed and why.
3. Remove stale copies after review to avoid confusion.

> Guardrail: Only include non-sensitive files in upload bundles.
