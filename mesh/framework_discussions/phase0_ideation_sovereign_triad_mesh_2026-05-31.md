# Sovereign Triad Mesh - Phase 0 Ideation Notes

Date: 2026-05-31
Phase: 0 (Ideation and Grilling)
Anchor used: `/Users/rikquiao/workspace/annotator_mesh/mesh/framework_discussions` (closest existing path to requested anchor)

## Problem Framing
Sovereign Triad Mesh appears to be a multi-domain delivery framework (`infra`, `app`, `connector`) with strict phase gating and contract-driven handoffs. The likely core problem is reducing cross-domain drift, unclear ownership, and sequencing failures during AI-assisted delivery.

Working problem statement (first pass):
- Teams need a deterministic way to move from idea -> specs -> domain implementation -> audit, while preserving alignment via shared contracts and phase gates.
- Current risk without this framework: premature implementation, unresolved assumptions, and integration mismatch between domains.

Why now (first pass):
- The workflow already encodes strict gates; adoption value depends on strong Phase 0 quality before spec/implementation begins.

## Constraints
- Phase sequencing is strict; no Phase 1 until blocking questions are answered or explicitly waived by a human.
- This output is ideation only (no implementation, no detailed specification).
- Questions must be explicitly tracked as `answered`, `waived`, or `blocked`.
- At least 10 clarifying questions are required in Phase 0.
- Top 3 risk assumptions must be identified before moving forward.

## Success Metrics (Phase 0)
- `Question coverage`: >= 10 clarifying questions logged with status.
- `Blocking clarity`: all blocking questions are either answered or explicitly waived by human before Phase 1.
- `Risk quality`: top 3 invalidating assumptions are explicit and testable.
- `Framing quality`: problem, constraints, and outcomes are concrete enough to draft PRD/spec next.
- `Primary product KPI`: 100% persistence completeness for annotated pages in saved/exported output.

## Top 3 Risk Assumptions
1. Assumption: There is a single highest-priority user/workflow to optimize first.
- Why risky: if priorities are split across teams/use cases, one architecture may overfit and stall adoption.
- Invalidating signal: stakeholders cannot agree on primary user journey or MVP success path.

2. Assumption: Domain contracts in `mesh_bus` can be defined early and remain stable through build phases.
- Why risky: if contracts churn during implementation, strict sequencing may increase rework instead of reducing it.
- Invalidating signal: repeated contract rewrites across phases 2-4.

3. Assumption: Human governance will actively resolve/waive blockers at phase gates.
- Why risky: if no decision owner responds quickly, workflow halts at gates and throughput collapses.
- Invalidating signal: unresolved blockers persisting beyond agreed decision SLA.

## Open Questions (with Status)
1. What is the exact primary user persona for Sovereign Triad Mesh (e.g., solo founder, platform team, multi-team org)?
- Status: `answered`
- Answer: Specialists assigned to annotate a file.

2. What is the first concrete use case/project this framework must support end-to-end?
- Status: `answered`
- Answer: Upload PDF -> annotate/mark pages -> export annotated output as PDF or JPG. Annotation can happen on PDF or image as long as exported file includes annotations.

3. What business or delivery KPI should be considered the primary north-star (cycle time, defect escape rate, integration failure rate, etc.)?
- Status: `answered`
- Answer: Primary KPI is annotation persistence completeness: all annotated pages must be saved/exported with annotations regardless of page count.
- Note: Recommended secondary KPIs for now are export success rate, annotation QA pass rate, and end-to-end turnaround time.

4. Are we explicitly constrained to three domains (`infra`, `app`, `connector`) for v1, with no additional domains?
- Status: `answered`
- Answer: Yes. Stay strictly with `infra`, `app`, and `connector` for v1.

5. What governance model decides whether a blocking question is waived (single approver vs. group)?
- Status: `answered`
- Answer: Single approval role; approver is the developer creating the app.
- Note: This is a hard blocking control; no phase progression without explicit waiver decision from the approver role.

6. What is the target cadence/SLA for resolving Phase 0 blockers?
- Status: `answered`
- Answer: ASAP (highest-priority turnaround).

7. Is this framework intended to be repository-local only, or reused across multiple repositories/projects?
- Status: `answered`
- Answer: This repository only for now.

8. Which compliance/security regimes are in scope (if any) for generated artifacts and discussions?
- Status: `answered`
- Answer: No formal regime in scope for now.

9. Should success metrics include AI-agent quality metrics (rework rate, spec drift, hallucination incidents)?
- Status: `answered`
- Answer: Not needed for now; deferred.

10. Are there explicit non-goals for Phase 0 beyond “no implementation/no spec writing” (e.g., no architecture decisions yet)?
- Status: `answered`
- Answer: Yes. Explicit non-goal: no architecture decisions are finalized in Phase 0.

11. Must all Phase 0 outputs map 1:1 into `PRD_TEMPLATE.md` sections in this run?
- Status: `answered`
- Answer: Not strictly required by workflow text; first-pass PRD-aligned framing is sufficient.

12. Is the current run expected to stop if blockers remain unresolved?
- Status: `answered`
- Answer: Yes. `WORKFLOW.md` Phase 0 hard gate and prompt template both require stop-and-wait behavior.

13. Should we proceed despite path mismatch between requested anchor and actual repo structure?
- Status: `waived`
- Waiver basis: used closest existing framework path under `/mesh/framework_discussions` to avoid inventing parallel structure.

## Blocking Questions Requiring Human Answer
- None currently open.

## Gate Status
Phase 0 gate is passable. Original blocking questions Q1-Q10 were answered in discussion.
