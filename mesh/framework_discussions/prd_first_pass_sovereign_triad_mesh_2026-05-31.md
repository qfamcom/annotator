# PRD (First Pass) - Sovereign Triad Mesh

Date: 2026-05-31
Source: Phase 0 discussion outcomes
Scope: Repository-local v1

## Problem Statement
- What user problem are we solving?
  - Specialists assigned to annotate files need a reliable workflow to upload a PDF, annotate any/all pages, and export a final file with annotations preserved.
  - The key product risk is data loss or partial persistence of annotations when working across multi-page files.
- Why now?
  - The workflow framework is already phase-gated and ready for spec work; locking the core use case and success criteria now reduces downstream spec drift.

## Users and Personas
- Primary user:
  - Specialists assigned to annotate a file.
- Secondary user:
  - App developer/operator responsible for delivery flow and phase-gate waiver approvals.

## Goals
- Business goals:
  - Deliver a dependable annotation flow in v1 within the current repository.
  - Establish enforceable quality around annotation persistence before expanding scope.
- User outcomes:
  - User can upload a PDF, annotate pages, and export annotated output.
  - User can export either as PDF or JPG.
  - User can trust that every annotated page is retained in final output.

## Non-Goals
- Explicitly out of scope:
  - Finalizing architecture decisions during Phase 0.
  - Adding domains beyond `infra`, `app`, `connector` in v1.
  - Multi-repository rollout in v1.
  - Formal compliance regime targeting (HIPAA/SOC 2/GDPR) for now.
  - AI-agent quality metrics (spec drift/hallucination/rework) for now.

## Requirements
- Functional:
  - Accept PDF file upload.
  - Support page-level annotation/marking workflow.
  - Allow output/export as annotated PDF.
  - Allow output/export as JPG output derived from annotated content.
  - Ensure annotations are included in exported file regardless of whether annotation UX operates on PDF or image surface.
  - Preserve annotations across all annotated pages regardless of total page count.
- Non-functional:
  - High reliability on save/export completion.
  - Deterministic output behavior across multi-page documents.
  - Clear gate/governance behavior for unresolved blockers.

## Constraints
- Technical:
  - Domain scope fixed to `infra`, `app`, `connector` for v1.
  - Framework follows strict phase gates; blocking questions must be answered or explicitly waived.
- Time:
  - Blocking questions are expected to be resolved ASAP.
- Compliance:
  - No formal compliance regime in scope for v1 at this stage.

## Success Metrics
- Metric 1:
  - Annotation persistence completeness = 100% of annotated pages appear with annotations in saved/exported output.
- Metric 2:
  - Export success rate for requested format (PDF/JPG) >= 99.0%.
- Metric 3:
  - Annotation QA pass rate on sampled outputs using dynamic fixed-random sampling (default 10%).
- Metric 4:
  - End-to-end turnaround time from upload to final export.

## Decisions from Follow-up Discussion
- Export success threshold for v1 release is 99.0%.
- Annotation QA sampling uses fixed random sampling at 10% by default, with dynamic/configurable sampling controls.
- JPG export behavior for multi-page files is ZIP package output with one JPG per page.
- v1 acceptance test scope limit is maximum 50 MB input file size and maximum 100 pages.

## Open Questions
- None currently open for this PRD pass.
