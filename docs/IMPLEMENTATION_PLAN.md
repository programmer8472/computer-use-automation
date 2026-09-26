# Implementation Plan

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete and acceptance criteria verified
- `[!]` Blocked, with the blocker recorded in `docs/STATUS.md`

Tasks should be completed in dependency order. A task is complete only after its
verification command or equivalent evidence succeeds.

## Milestone 0: Project foundation

### [x] FOUNDATION-01 — Initialize the TypeScript workspace

Depends on: none

Deliver:

- npm workspace, TypeScript configuration, linting, formatting, and test runner.
- Initial directory boundaries from `ARCHITECTURE.md`.
- `.gitignore` and public `.env.example` containing placeholders only.

Acceptance:

- Fresh install succeeds.
- Type checking and the empty test suite succeed.
- No secret values or secret-bearing files are introduced.

Verify: `npm install && npm run check && npm test`

### [x] FOUNDATION-02 — Define shared contracts

Depends on: FOUNDATION-01

Deliver:

- Versioned schemas for capability packages, locators, inputs/outputs, steps,
  policy, evidence events, intervention requests, and terminal results.
- Valid and invalid schema fixtures.

Acceptance:

- Schemas reject missing versions, unknown action types, ambiguous success
  contracts, and unsafe retry declarations.
- A representative contact-update capability round-trips through JSON.

Verify: `npm test -- contracts`

## Milestone 1: Synthetic target

### [x] TARGET-01 — Build the Member Contacts Admin application

Depends on: FOUNDATION-01

Deliver:

- Search, view, create, update, and delete UI.
- Seeded synthetic records and deterministic reset.
- Server-rendered or equivalently inspectable accessible markup without test
  IDs.

Acceptance:

- CRUD works manually.
- Reset always produces the documented fixture state.
- No real PII exists in fixtures.

Verify: `npm test -- contacts`

### [x] TARGET-02 — Add responsive variants and controlled failures

Depends on: TARGET-01

Deliver:

- Wide, tablet, and narrow layouts.
- Not-found, duplicate, validation, ambiguous-control, transient-failure, and
  unexpected-dialog scenarios.
- Sensitive SSN flow that does not return or retain a raw value.

Acceptance:

- Each scenario has a deterministic trigger and reset path.
- Manual use remains possible at 1440x900, 768x1024, and 375x667.

Verify: `npm test -- target-scenarios`

## Milestone 2: Browser and evidence foundations

### [x] SURFACE-01 — Implement the Playwright surface adapter

Depends on: FOUNDATION-02, TARGET-01

Deliver:

- Observe, resolve, act, settle, check, and capture primitives.
- Semantic locator portfolios with expected cardinality.
- Route/frame and element-state validation.

Acceptance:

- The same semantic target resolves across all three viewports.
- Zero and multiple matches fail without performing the action.
- Stored actions do not depend on absolute coordinates.

Verify: `npm test -- surface`

### [x] EVIDENCE-01 — Implement redacted structured evidence

Depends on: FOUNDATION-02, TARGET-02

Deliver:

- Append-only structured events, artifact references, masked screenshots, and
  evidence manifest hashes.
- Redaction before model, log, and disk boundaries.

Acceptance:

- Synthetic SSN-like values cannot be found in generated evidence or test
  output.
- Manifest verification detects modified evidence.

Verify: `npm test -- evidence`

## Milestone 3: Discovery and compilation

### [x] DISCOVERY-01 — Implement bounded LLM discovery

Depends on: SURFACE-01, EVIDENCE-01

Deliver:

- Provider-neutral model interface with one working provider adapter.
- Bounded tool loop operating a real browser page.
- Recorder that separates mechanical facts from model narration.

Acceptance:

- A genuine model-driven run updates a synthetic contact.
- Evidence records a nonzero discovery model-call count.
- Disallowed routes, actions, and sensitive values are blocked before use.

Verify: `npm test -- discovery` plus the documented live discovery command

### [x] COMPILER-01 — Compile and approve a capability

Depends on: DISCOVERY-01

Deliver:

- Trace-to-capability compiler.
- Reviewed policy and business-outcome catalog integration.
- Schema/version/digest generation and explicit approval command.

Acceptance:

- A discovery trace produces a readable draft contact-update capability.
- Unapproved or modified artifacts cannot replay.
- Permissions cannot be broadened by discovered mechanics.

Verify: `npm test -- compiler`

## Milestone 4: Deterministic replay

### [x] REPLAY-01 — Implement the effect-aware replay state machine

Depends on: COMPILER-01

Deliver:

- `PREFLIGHT -> RESOLVE_AUTHORIZE -> ACT -> SETTLE_RECONCILE -> CHECK_CLASSIFY`
  execution.
- Typed success, business-outcome, escalation, and hard-failure results.
- Bounded recovery and at-most-once write behavior.

Acceptance:

- Approved contact-update capability replays with changed inputs.
- Replay has no model dependency and records zero model calls.
- A timeout after a possible write reconciles state instead of repeating the
  write.

Verify: `npm test -- replay`

### [x] REPLAY-02 — Prove responsive and exceptional replay

Depends on: REPLAY-01, TARGET-02

Deliver:

- Explicit desktop/tablet/mobile branches where UI structure differs.
- Not-found business outcome, transient recovery, and ambiguous-target failure.

Acceptance:

- One approved capability succeeds at 1440x900, 768x1024, and 375x667.
- Not found is not reported as a crash.
- Ambiguity causes no click and returns a structured result.

Verify: `npm test -- replay-scenarios`

## Milestone 5: Policy and human control

### [x] POLICY-01 — Enforce effective runtime authority

Depends on: REPLAY-01

Deliver:

- Intersection of runtime, artifact, and target policy.
- Pre-action inspection of resolved element semantics.
- Risk and irreversible-action barriers.

Acceptance:

- No policy layer can broaden another layer.
- A capability repointed toward a sensitive or disallowed control is blocked.

Verify: `npm test -- policy`

### [ ] HANDOFF-01 — Implement same-session intervention and resume

Depends on: POLICY-01, TARGET-02

Deliver:

- Exclusive browser-session lease and ownership states.
- Local operator surface with intervention context and release/resume controls.
- Resume reconciliation and redacted operator audit.

Acceptance:

- SSN update pauses before sensitive entry.
- A human acts in the same live session.
- Automation resumes only after lease release and checkpoint verification.
- No sensitive value appears in automation evidence.

Verify: `npm test -- handoff` plus the documented manual demonstration

## Milestone 6: Submission evidence and documentation

### [ ] DEMO-01 — Build the one-command scenario matrix

Depends on: REPLAY-02, HANDOFF-01

Deliver:

- Resettable `npm run demo` workflow.
- Redacted committed evidence for discovery, replay, exceptional state, and
  handoff.
- Evidence manifest verification.

Acceptance:

- A new reviewer can reproduce the automated scenarios from a clean checkout.
- Expected and actual results are clearly printed.

Verify: `npm run demo && npm run evidence:verify`

### [ ] DOCS-01 — Complete evaluator documentation

Depends on: DEMO-01

Deliver:

- Final `README.md` with exact setup and demonstration commands.
- Root `REPORT.md` with the assignment's seven required headings.
- Accurate limitations, safety discussion, and next steps.

Acceptance:

- Every documented command has been run successfully from a clean setup.
- Claims are supported by code or committed evidence.

Verify: follow the README verbatim and run the full test suite

## Optional stretch work

These tasks must not delay the milestones above:

- `[ ]` PORTABILITY-01 — Add a second tenant/layout overlay and compatibility
  probe.
- `[ ]` CATALOG-01 — Expose approved capabilities through a small agent-facing
  catalog.
- `[ ]` STABILITY-01 — Run repeated deterministic replay and summarize
  stability.
