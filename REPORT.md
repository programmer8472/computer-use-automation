# Architecture

The system is a narrow end-to-end vertical slice around a local, synthetic
Member Contacts Admin application. It deliberately separates discovery,
compilation, replay, policy, session ownership, and evidence. During discovery,
an OpenAI-backed bounded tool loop observes a minimized browser representation
and performs one semantic action per turn. A recorder stores mechanical facts,
not model narration. The compiler accepts only the reviewed contact-update
shape, binds invocation inputs, adds reviewed outcomes and policy, and produces
a draft. A named reviewer promotes that draft to a digest-bound approved
capability. Production replay consumes the approved artifact without an LLM.

An agent-facing Automation Console provides the demonstration entry point. It
visually gates one complete lifecycle: an API-backed discovery run generates a
fresh redacted trace, the compiler creates a typed draft, a named reviewer
digest-locks it, and deterministic replay consumes that exact in-memory approved
package. The screen reports discovery model calls and replay's zero model calls
separately. It labels the first phase `LLM discovery (“training”)` while
explicitly explaining that model weights are not changed. It uses one two-column
page: the live, inline CRUD member application is on the left, while lifecycle
controls, fault injection, and typed results are on the right. Reset restores
seed data and clears the session draft, approval, and latest run while retaining
immutable evidence. Internal target routes remain isolated from evaluator-facing
navigation. A versioned catalog endpoint exposes the two contracts for typed
invocation by another agent. A multi-run stability harness invokes the
pre-reviewed catalog repeatedly and reports pass rate, outcome variance,
latency, and flakiness. Neither replay path invokes a model.

The consolidated member application retains its normal human controls, including
search by ID, name, email, or phone. This keeps the target credible as an
application rather than making its basic operations available only through the
agent.

Playwright is behind a surface adapter exposing observe, resolve, inspect, act,
settle, and check operations. The replay engine depends on that interface rather
than directly on a DOM. A separate session controller owns the live page and
transfers an exclusive lease between automation and an operator. Evidence is
written through a privacy gateway into immutable, manifest-hashed packages.

This is intentionally one TypeScript process and an in-memory target. That keeps
the core behavior inspectable and reproducible while preserving seams that could
later become workers or services. The main trade-off is operational realism:
process restarts lose application and lease state, but the important contracts
and state transitions are real. The committed five-call discovery trace is in
`evidence/submission/discovery-live/`; `npm run demo` regenerates and verifies
the deterministic evidence matrix.

# Artifact schema

The versioned capability schema is a strict Zod contract with four concerns:

- Mechanical flow: ordered steps, semantic locator portfolios, expected
  cardinality, preconditions, settle conditions, postconditions, timeouts, and
  effect-aware retry declarations.
- Agent contract: typed inputs and outputs with required flags, validation
  constraints, and data classifications.
- Policy and outcomes: allowed origins, routes, and action types; blocked data
  classes; recovery limits; approval requirements; and distinct success,
  business-outcome, escalation, and hard-failure contracts.
- Compatibility and provenance: application family, surface type, semantic
  version range, responsive variants, discovery evidence references, model-call
  count, revision, approval metadata, and content digest.

Targets store ranked semantic strategies such as accessible role/name or label,
plus the requirement that exactly one visible control resolve. They do not store
screen coordinates. Literal action values are restricted to public data;
invocation-specific values are symbolic input bindings. External-effecting steps
cannot declare blind retries. The schema is readable JSON because both a
reviewer and a calling agent need to understand what the capability requires,
does, and returns. Strict objects reject unknown fields, making version drift
explicit instead of silently accepting it.

Approval is separate from compilation. The approval digest covers capability
content and reviewer metadata, so an edit after approval makes replay fail
before browser use. Discovered mechanics cannot broaden reviewed policy; runtime
authority is the intersection of artifact and runtime rules.

# Determinism & error handling

Replay never invokes a model. Given an approved capability and validated inputs,
each step follows
`PREFLIGHT -> RESOLVE_AUTHORIZE -> ACT -> SETTLE_RECONCILE -> CHECK_CLASSIFY`.
The live control is resolved semantically and inspected immediately before
action. Exactly-one cardinality fails closed. Playwright calculates physical
coordinates from the current layout, which is why the same artifact succeeds at
1440x900, 768x1024, and 375x667.

Checks verify URLs or element states rather than assuming a click worked.
Read-only steps may use bounded safe retries. A write executes at most once; if
settling times out, replay checks whether the postcondition already holds and
never blindly repeats the write. Results distinguish `success`, a reviewed
business outcome such as `CONTACT_NOT_FOUND`, `pending_escalation`, and a
structured `hard_failure` containing the step and observed mismatch.

The demo proves seven paths: three responsive successes, missing contact,
ambiguous target, one-shot transient recovery, and verified handoff. Ambiguity
returns `AMBIGUOUS_TARGET` before the ambiguous control is clicked. The
transient case records two bounded navigation attempts before success. Every
replay completion records `modelCallCount: 0`, while the genuine discovery
record contains five model calls.

# Heterogeneity & multi-tenant

The capability vocabulary is surface-neutral; only the adapter knows whether a
role, label, accessibility node, screenshot anchor, or OS control performs the
operation. A legacy-web adapter could add frame context, table-relative anchors,
and carefully scoped structural selectors. A desktop adapter could resolve the
same target contract against an OS accessibility tree and use visual anchors as
a final reviewed strategy. The replay state machine, policy intersection,
outcomes, leases, and evidence format would remain unchanged.

For multi-tenant use, a capability should be cataloged by vendor application
family, workflow, major version, and compatibility fingerprint rather than by
institution. Common mechanics would live in a base capability; reviewed tenant
or version overlays could narrow routes, replace a locator portfolio, or add an
explicit responsive branch. Overlays must never broaden the base or runtime
policy. A preflight fingerprint would select a known variant and reject unknown
drift. Replay telemetry would support promotion, rollback, and revalidation per
vendor/version cohort. This implementation includes the app-family, version,
surface, and responsive-variant fields, but not the registry, fingerprinting, or
overlay service.

# Escalation & handoff

Sensitive intent without a supplied value returns
`SENSITIVE_DATA_ENTRY_REQUIRED` before any discovery model call. Automation may
navigate to the requested member and confirm that the SSN control is a masked
password input, but it releases ownership before focus or entry. A local
operator page shows minimized context and drives the exclusive lease:

```text
automation -> released -> operator -> released -> automation
```

The operator claims the existing browser, types directly into the unchanged
Contacts page, saves, and requests resume. The target immediately discards the
submitted value and stores only `ssnOnFile`. Automation reacquires the lease
only after verifying the same page is on the member detail route and displays
the non-sensitive `On file` checkpoint. Failed verification leaves the browser
released so the operator can claim it again. Requested, claimed, released, and
resumed transitions are audited without the protected value.

The headed `npm run handoff` workflow was manually verified. The credential-free
demo uses a synthetic operator harness solely to reproduce the lease and resume
proof; production discovery and replay remain unable to interact with the
sensitive control. The current operator surface is local and in-memory, without
authentication, remote co-browsing, durable queues, or crash recovery. The
console's escalation result makes this separate path explicit by presenting the
member-specific launcher command, copy control, and operator steps directly on
screen.

# Safety

The target contains synthetic records only. Origin, route, and action allowlists
are checked both before navigation and against the resolved destination. Policy
is intersected so no artifact, runtime, or future tenant layer can broaden
another. Inputs carry data classes; sensitive, credential, and full-SSN classes
are blocked. Before any fill or click, replay inspects the actual resolved
control and rejects password or SSN semantics even if an approved artifact was
maliciously repointed.

The password mask is usability, not the security boundary. Browser observations
exclude input values, model inputs are minimized, raw sensitive values are not
accepted by the operator service, and the Contacts repository retains only a
boolean. All structured evidence passes through recursive key- and pattern-based
redaction before disk. Evidence packages are immutable after finalization and
contain file sizes and SHA-256 digests; `npm run evidence:verify` checks those
digests, required packages, and prohibited sensitive patterns.

Limits remain. Regex redaction is defense in depth, not a substitute for a
formal data-loss-prevention service. The local process has no institutional
identity, authorization backend, encrypted durable store, or tamper-evident
remote audit log. Risky real-world actions would also require authenticated,
purpose-bound approvals and stronger transaction reconciliation.

# Cuts

I chose depth in one workflow over breadth. The implementation omits desktop and
visual-only adapters, remote operator streaming, distributed scheduling,
multi-tenant catalogs and overlays, durable browser recovery, session login and
timeout renewal, generalized capability induction, and bounded LLM replay
fallback. The compiler intentionally recognizes one reviewed workflow instead of
turning arbitrary successful traces into executable authority. The target is
server-rendered and awkward enough to exercise responsive and runtime states,
but it is not a true frameset or native desktop application.

Next I would add vendor/version fingerprints and narrowing tenant overlays,
persist lease/run state with short-lived authenticated operator access, add a
second accessibility-based desktop or hostile legacy-web adapter, and derive
approval confidence thresholds from accumulated stability history. I would also
evolve the local typed catalog into a durable, authenticated service. I would
not add open-ended model recovery until its authority, data boundaries, and
evidence contract were as constrained as deterministic replay.
