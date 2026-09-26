# Architectural Decisions

This is a lightweight decision log. Add entries only for choices that materially
constrain later work.

## ADR-001 — Use a synthetic Member Contacts Admin target

Status: accepted — 2026-09-25

The target will be a local browser application containing only synthetic
member/contact data. It will support CRUD, responsive layouts, controlled
faults, and a sensitive SSN workflow. This supplies realistic states without
automating an external service or handling real personal data.

## ADR-002 — Separate discovery from deterministic replay

Status: accepted — 2026-09-25

An LLM may operate the live application during discovery. The successful
mechanics are compiled into a reviewed capability. Production replay consumes
only that capability and invocation inputs; it does not invoke an LLM for
decisions.

## ADR-003 — Resolve semantic targets at runtime

Status: accepted — 2026-09-25

Capabilities will store semantic locator portfolios and expected cardinality
rather than fixed screen coordinates. The browser driver calculates the physical
click location after resolving and validating the live element. Responsive
structural differences use explicit reviewed branches, and ambiguity fails
closed.

## ADR-004 — Keep mechanics and policy separate

Status: accepted — 2026-09-25

Discovery proves what mechanically worked once. It does not determine what is
safe, which outcomes are legitimate, or which retries are allowed. Runtime
permission is the intersection of reviewed runtime, artifact, and target policy.

## ADR-005 — Use an effect-aware replay state machine

Status: accepted — 2026-09-25

Each step uses `PREFLIGHT`, `RESOLVE_AUTHORIZE`, `ACT`, `SETTLE_RECONCILE`, and
`CHECK_CLASSIFY`. External-effecting actions execute at most once; uncertainty
is reconciled through observation rather than blind repetition.

## ADR-006 — Treat SSN entry as operator-only

Status: accepted — 2026-09-25

Automation may navigate to the sensitive operation but must transfer the same
live session to a human before entry or submission. Raw SSNs must not enter
model context, artifacts, logs, screenshots, fixtures, or evidence. Resume
checks only a non-sensitive postcondition such as `ssn_on_file`.

## ADR-007 — Use repository files as cross-session memory

Status: accepted — 2026-09-25

Project continuity must not depend on chat history. `ARCHITECTURE.md` records
stable design, `IMPLEMENTATION_PLAN.md` records work and acceptance criteria,
`STATUS.md` records the current handoff, and this file records durable
decisions. `AGENTS.md` defines `continue` as an instruction to reconstruct
context from those files and resume the first unblocked task.

## ADR-008 — Use a server-rendered, in-memory target application

Status: accepted — 2026-09-25

The synthetic target uses Express with server-rendered accessible HTML and a
deterministic in-memory repository. This keeps setup and reset reliable, exposes
a real HTTP/browser surface, and avoids spending assignment time on target-app
infrastructure. Target state persists for the lifetime of the app process and is
restored through the documented reset command.

## ADR-009 — Enforce privacy at the evidence boundary

Status: accepted — 2026-09-25

All structured evidence passes through one recursive privacy gateway before it
is serialized. Screenshot evidence is accepted only when the caller declares at
least one applied pixel mask. Finalized packages contain size and SHA-256
records and reject subsequent writer mutations. This boundary complements, but
does not replace, upstream data minimization in browser observations and model
inputs.
