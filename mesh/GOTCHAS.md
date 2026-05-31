# GOTCHAS

Common anti-patterns that break this framework:

## Mixing infra, app, and connector work in one Codex prompt
This causes context thrash and contract drift. Keep prompts domain-scoped.

## Building before requirements are clear
Unclear requirements create unstable specs and rework. Finish Phase 0 first.

## Editing implementation before specs exist
Implementation before `plan_spec` and `execution_spec` leads to unreviewable decisions.

## Skipping contract files
If `mesh_bus` is stale, domains silently diverge.

## Vague API definitions
Ambiguous payloads/status codes create connector instability and brittle tests.

## Vague database assumptions
Unspecified schema/index/migration assumptions break infra-app alignment.

## Overbuilding the framework
Do not add tooling/dependencies until demanded by current phase needs.

## Treating `memory.md` as active context too early
Premature memory loading can bias new work with stale assumptions.
