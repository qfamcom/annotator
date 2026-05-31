# CODEX Constitution

This is the operating constitution for Sovereign Triad Mesh.

## Single Root Anchor Rule
Every Codex run must start from one explicit anchor folder (`infra/`, `app/`, or `connector/`) and stay there unless phase transition is declared.

## No God Prompt Rule
Do not request multi-domain implementation in one prompt. Split intent by domain and phase.

## Sequential Execution Rule
Only one Codex run executes at a time. No parallel autonomous runs.

## Contract Bus Rule
All cross-domain coordination must flow through `mesh_bus/` contract files.

## No Premature Integration Rule
Do not integrate domains before each domain has approved `plan_spec` and `execution_spec`.

## Human Circuit Breaker Rule
When requirements are ambiguous, high-risk, or contradictory, pause and request human decision before continuing.

## Plan Spec vs Execution Spec Separation
- `plan_spec/`: what and why
- `execution_spec/`: how, order, and acceptance checks

Do not merge these responsibilities into one vague file.

## Implementation Folder Ownership Rule
Implementation changes belong only in the active domain's `implementation/` folder during its phase.

## Memory Blindfold Rule
`memory.md` is not default active context. Read it only on explicit request.

## Artifacts to GPT Rule
Use `framework_discussions/artifacts_to_gpt/` only for temporary review bundles. Include no secrets and no long-term canonical truth.
