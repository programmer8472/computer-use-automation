# Current Project Status

Last updated: 2026-09-26

## Current milestone

Milestone 5 — Same-session human handoff

## Current state

The synthetic target, semantic Playwright surface adapter, redacted evidence,
genuine bounded LLM discovery, and digest-bound capability compilation are
implemented. A live OpenAI Responses API run updated a synthetic contact in five
model calls and passed an independent state check. That trace successfully
compiled into a readable draft and passed the explicit approval/verification
flow. Approved capabilities now replay deterministically with changed inputs and
zero model calls across responsive layouts and exceptional states. Effective
policy now inspects the resolved control immediately before action and blocks
the visible SSN field from automation. The next step is transferring that same
browser session to a human and safely resuming. The published Git repository is
on branch `main`; its initial commit is authored by Alex Shein.

## Completed

- Reviewed the complete assignment brief.
- Reviewed the complete public-reference assessment.
- Selected the Member Contacts Admin target and narrow vertical-slice strategy.
- Defined the discovery/compiler/replay/policy/session/evidence architecture.
- Defined responsive semantic targeting instead of stored screen coordinates.
- Defined the `continue` protocol in `AGENTS.md`.
- Created the initial evaluator README and executable implementation backlog.
- Initialized the local Git repository on branch `main`.
- Completed `FOUNDATION-01`: npm workspaces, strict TypeScript, ESLint,
  Prettier, Vitest, public configuration template, and package boundaries.
- Completed `FOUNDATION-02`: versioned schemas for capability packages,
  locators, typed values, policy, evidence, handoff, and terminal results.
- Completed `TARGET-01`: searchable synthetic contacts, create/update/delete,
  visible validation and business states, and deterministic reset.
- Completed `TARGET-02`: wide/tablet/narrow layouts, deterministic not-found,
  duplicate, validation, ambiguity, transient, and interstitial scenarios, plus
  SSN status storage without raw-value retention.
- Completed `SURFACE-01`: semantic observation, resolution, action, settle,
  check, capture, origin/route enforcement, and fail-closed cardinality.
- Completed `EVIDENCE-01`: recursive pre-storage redaction, append-only events,
  masked screenshot enforcement, manifest hashing, and tamper verification.
- Updated contact creation so member IDs are allocated server-side in a
  deterministic sequence and cannot be supplied by the browser.
- Completed `DISCOVERY-01`: provider-neutral bounded tool loop, OpenAI Responses
  adapter, symbolic inputs, independent success verification, pre-action route
  checks, sensitive-data barriers, and mechanics-only trace recording.
- Completed `COMPILER-01`: reviewed contact-update catalog, trace shape checks,
  input-bound locator template, least-authority action intersection,
  schema-validated draft output, and digest-bound explicit approval.
- Moved the masked SSN control onto the standard Edit screen, removed the extra
  SSN page, and retained only the non-sensitive `ssnOnFile` state after a human
  submission.
- Completed `REPLAY-01`: approval and input preflight, locator hydration,
  effect-aware execution, typed terminal results, model-free evidence, and
  reconcile-without-repeat handling for uncertain writes.
- Completed `REPLAY-02`: the same capability succeeds at wide, tablet, and
  narrow viewports; missing members classify as `CONTACT_NOT_FOUND`; ambiguity
  fails before click; and the real transient scenario recovers within bounds.
- Completed `POLICY-01`: artifact/runtime authority intersection, blocked-data
  union, resolved-control inspection, destination checks, and a hard barrier
  against agent entry into the visible SSN/password control.

## In progress

- None. The next session should begin same-session human handoff.

## Next three tasks

1. `HANDOFF-01` — Transfer the same browser session to a human for SSN entry and
   verify safe resume.
2. `DEMO-01` — Build the one-command scenario matrix and committed redacted
   evidence.
3. `DOCS-01` — Finish the evaluator README and required report.

## Blockers and decisions needed

- Discovery credentials are user-managed and must be consumed only by the
  provider SDK at runtime. Agents must never inspect the local `.env` file or
  print the configured value.
- The real submission capability still needs a reviewer identity at approval
  time; tests use an explicitly synthetic reviewer.

## Health check

```bash
npm install && npm run browser:install && npm run check && npm test
```

Expected result: dependency audit succeeds, pinned Chromium is available, strict
checks pass, and all tests pass. In restricted execution environments, the
browser and HTTP tests may require permission to launch Chromium and open an
ephemeral loopback port.

## Verification performed

- Source documents were inspected page-by-page.
- Repository contents were inspected before planning files were added.
- The documented planning health check completed with exit code `0`.
- Git publication was verified on branch `main`; the initial commit is authored
  by Alex Shein.
- `npm install && npm run check && npm test` passed for the foundation before
  target implementation.
- `npm run check` passed after the target implementation.
- Full `npm test` passed: 3 test files and 26 tests, including 7 real HTTP CRUD
  and reset tests.
- `npm run app:start` launched the target at `http://127.0.0.1:4173`, and
  `npm run data:reset` restored exactly 3 synthetic members.
- `npm test -- target-scenarios` passed 8 deterministic fault, reset,
  responsive-markup, and sensitive-value tests.
- `npm test -- surface` passed 8 real-browser tests, including all three
  viewport sizes, the narrow-layout action branch, fail-closed resolution, route
  denial, and value-minimized observations.
- Wide, tablet, and narrow screenshots were visually inspected with no clipping
  or unusable controls; the temporary screenshots were then removed.
- `npm test -- evidence` passed 4 privacy, immutability, masking, and tamper
  tests.
- Final full `npm test` passed: 6 test files and 46 tests, including the pinned
  Chromium suite.
- Member-ID generation checks and both focused target suites passed: 16 contact
  tests and 8 target-scenario tests.
- `DISCOVERY-01` tests passed, and a genuine live run completed successfully in
  5 model calls. Its evidence manifest verified and contained no submitted phone
  value.
- The live trace compiled through `npm run capability:compile`; the explicit
  approval command produced an artifact that passed digest verification.
- Final full verification passed: 8 test files and 53 tests, plus type checking,
  linting, and formatting.
- The integrated Edit/SSN target suites passed: 17 contact tests and 9 focused
  target-scenario tests.
- `REPLAY-01` passed its focused suite, including changed-input replay,
  pre-browser approval rejection, and post-write timeout reconciliation with one
  write attempt.
- A real `npm run replay` CLI execution succeeded with `modelCallCount: 0`; its
  evidence manifest verified and contained no submitted phone value.
- `REPLAY-02` passed 4 real-browser scenarios covering all three viewports,
  not-found classification, ambiguity without click, and transient recovery.
- `POLICY-01` passed focused policy tests and an integration test proving that
  an approved capability repointed at the SSN control is blocked before fill.
- Final full verification passed: 11 test files and 65 tests, plus type
  checking, linting, and formatting.

## Files changed in the latest session

- `README.md`
- `package.json`, `package-lock.json`
- `apps/contacts/src/*`, `apps/contacts/test/*`
- `packages/contracts/src/*`
- `packages/surface-playwright/package.json`
- `packages/surface-playwright/src/*`, `packages/surface-playwright/test/*`
- `packages/evidence/package.json`
- `packages/evidence/src/*`, `packages/evidence/test/*`
- `packages/discovery/package.json`, `packages/discovery/src/*`,
  `packages/discovery/test/*`
- `packages/compiler/package.json`, `packages/compiler/src/*`,
  `packages/compiler/test/*`
- `packages/replay/package.json`, `packages/replay/src/*`,
  `packages/replay/test/*`
- `packages/policy/package.json`, `packages/policy/src/*`,
  `packages/policy/test/*`
- `cli/package.json`, `cli/src/*`
- `README.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/STATUS.md`
- `docs/DECISIONS.md`

## Resume instruction

Read this file and `docs/IMPLEMENTATION_PLAN.md`, run the health check above,
then start `HANDOFF-01`. Pause on SSN intent before sensitive entry, retain the
same live browser session, transfer an exclusive lease to the operator, resume
only after release and checkpoint verification, and prove that no raw SSN enters
model context or evidence. Before stopping, record exact verification results
and update this snapshot.
