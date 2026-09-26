# Architecture

## 1. Objective and boundaries

Build a focused computer-use automation system that learns a workflow through
one genuine LLM-driven interaction with a browser, compiles the successful
mechanics into a typed and reviewable capability, and replays that capability
deterministically without model decisions.

The target is a local Member Contacts Admin web application containing only
synthetic data. It is a proxy for a legacy back-office application, not the
product under evaluation.

### Must demonstrate

- Natural-language goal to live-browser discovery.
- Typed, versioned, serializable capability artifact.
- Model-free deterministic replay with changed inputs.
- Semantic, viewport-independent target resolution.
- Explicit business outcomes, recovery, escalation, and hard failure.
- Runtime policy enforcement and sensitive-data minimization.
- Human takeover and verified resume in the same browser session.
- Structured, redacted evidence.

### Explicit non-goals

- Production multi-tenant infrastructure or distributed workers.
- General-purpose capability induction from arbitrary applications.
- Desktop automation in the implementation.
- Real banking, contact, or SSN data.
- A production remote-operator service.

## 2. Architectural thesis

The system separates five concerns that must not collapse into one another:

```text
Discovery       observes and proposes a successful mechanical trajectory
Recorder        captures browser facts independently of model narration
Compiler        combines observed mechanics with reviewed contracts and policy
Replay          executes the approved capability without an LLM
Session control transfers exclusive ownership between automation and a human
```

The model discovers. Policy is reviewed. Replay does not reason. An uncertain
external effect is reconciled instead of repeated. A leased live session always
has one accountable owner.

## 3. Proposed repository shape

```text
apps/
  contacts/              synthetic target web application
  operator/              minimal intervention and resume surface
packages/
  contracts/             Zod schemas and shared result types
  surface-playwright/    browser observation and action adapter
  discovery/             bounded model/tool loop and recorder
  compiler/              trace-to-capability compilation and approval
  policy/                allowlists, risks, permissions, redaction rules
  replay/                deterministic effect-aware executor
  session/               browser ownership lease and handoff state
  evidence/              structured events, masking, manifest, verification
cli/                     discover, approve, replay, reset, and demo commands
evidence/                committed redacted demonstration packages
```

This may initially be one npm workspace and one process. Package boundaries
represent responsibilities, not required services.

## 4. Target application

The Member Contacts Admin application will provide:

- Seeded, resettable synthetic members.
- Search by member ID, name, email, or phone.
- View, create, update, and delete operations.
- Expected outcomes such as not found, duplicate identity, and validation
  failure.
- Controlled fault injection for a transient interruption, unexpected dialog,
  and ambiguous UI.
- Desktop, tablet, and narrow/mobile layouts.
- A sensitive SSN input that never returns the raw value and stores only a
  non-reversible verification representation or `ssn_on_file` state.

The interface should be realistically awkward but fair: no automation-specific
test IDs, semantic labels where a real accessible application should have them,
responsive reflow, and at least one nested or dialog-based interaction.

## 5. Surface abstraction and responsive targeting

The portable capability vocabulary is:

```text
observe -> resolve -> authorize -> act -> settle -> check -> capture
                                         |
                                         +-> human_control
```

Capabilities do not store click coordinates as their primary target. A target
records a reviewed locator portfolio such as:

1. Accessible role, name, and contextual ancestor.
2. Associated label and nearby stable text.
3. Scoped structural selector when semantic data is insufficient.
4. Visual anchoring only for surfaces without a usable DOM or accessibility
   tree.

At replay time the adapter resolves the target in the current page, requires the
declared cardinality, verifies visibility and enabled state, scrolls it into
view, and lets the browser driver calculate current click coordinates.

Responsive layouts may use explicit branches. For example, replay may click a
visible `Edit` button on a wide layout or open a unique `Actions` menu and
select `Edit` on a narrow layout. These are reviewed alternatives, not model
guesses. If no approved variant resolves uniquely, replay reports drift or
escalates.

## 6. Discovery and compilation

The discovery worker receives a natural-language goal and bounded tools:

- Observe a minimized, redacted accessibility/DOM representation.
- Resolve and act on one control inside the allowed target.
- Fill non-sensitive values.
- Request human intervention.
- Declare success or a known business outcome.

Every tool call records the mechanical observation, resolved element facts,
state digest, action, result, and redacted evidence independently of the model
transcript.

The compiler produces a draft capability from the successful trace. It may
retain observed locator candidates and checkpoints, but permissions, risk
classification, business outcomes, retries, and escalation rules come from
reviewed configuration. A capability becomes executable only after schema
validation and explicit approval.

## 7. Capability contract

A capability package contains four logically separate layers:

### Mechanical flow

- Ordered states and actions.
- Typed input and output bindings.
- Locator portfolios and expected cardinality.
- Frame/route context.
- Preconditions, settle conditions, and postconditions.
- Explicit action idempotency or external-effect classification.

### Execution policy

- Allowed origins, routes, and action types.
- Risk levels and required approval.
- Outcome taxonomy.
- Recovery budget and backoff.
- Evidence and redaction requirements.

### Compatibility scope

- Application family and semantic version range.
- Approved surface types.
- Expected fingerprints and layout variants.

### Provenance

- Schema version, capability ID, revision, and immutable digest.
- Discovery run and redacted evidence references.
- Reviewer and approval state.

Runtime authority is the intersection of runtime policy, artifact policy, and
any applicable target overlay. No layer may broaden another layer's permissions.

## 8. Deterministic replay state machine

Every step executes through these phases:

1. `PREFLIGHT`: validate package, typed inputs, compatibility, policy, and
   session lease.
2. `RESOLVE_AUTHORIZE`: resolve exactly one target, inspect actual semantics,
   and calculate effective authority.
3. `ACT`: execute the external-effecting action at most once.
4. `SETTLE_RECONCILE`: wait for the declared condition; after timeout or
   handoff, observe whether the effect already happened rather than blindly
   repeating it.
5. `CHECK_CLASSIFY`: verify the postcondition and return a typed result with
   evidence references.

Terminal result classes are:

- `success`
- `business_outcome`, such as `CONTACT_NOT_FOUND`
- `pending_escalation`
- `hard_failure`, such as ambiguous target, policy denial, incompatible UI, or
  unknown postcondition

Recoverable conditions are bounded internal transitions. Exhausted recovery
becomes an explicit terminal result.

## 9. Safety and sensitive data

The privacy gateway runs before data reaches a model, artifact, log, or evidence
store. It applies structured-field classification, allowlisted accessible text,
DOM value suppression, and screenshot masking.

SSN updates follow these rules:

- The natural-language goal names the operation but does not include the raw
  value.
- Automation may navigate to the correct member and sensitive field.
- Policy blocks focus/fill/submission and raises an intervention request.
- A human enters the value directly in the live target session.
- The target immediately stores only a non-reversible verification
  representation or boolean state.
- Resume verifies only `ssn_on_file`; no raw value or last-four digits enter
  automation evidence.

Delete and other irreversible actions require an explicit barrier and must never
be automatically retried after uncertain completion.

## 10. Human handoff

The browser-session controller owns the live page independently of replay and
maintains an exclusive lease:

```text
automation -> released -> operator -> released -> automation
```

An intervention record includes run ID, capability and step, reason, redacted
context, lease state, and required resume condition. The operator uses the same
browser session. Resume is allowed only after the operator releases control and
replay re-observes the declared checkpoint. Human actions are audited in
minimized, redacted form.

The take-home implementation may use a local operator surface and short-lived
token, but the state transition and same-session proof must be real.

## 11. Evidence and verification

Each run writes an evidence package containing:

- Run, capability, application, and version identifiers.
- Capability and evidence digests.
- Structured step events and state transitions.
- Expected and observed conditions.
- Typed terminal result.
- Redacted DOM/accessibility evidence and masked screenshots where useful.
- Discovery model-call count and replay model-call count.

Committed evidence will demonstrate genuine discovery, changed-input replay,
three viewport sizes, a business outcome, bounded recovery, fail-closed
ambiguity, and same-session human handoff. Replay evidence must show zero model
calls.

## 12. Verification strategy

- Unit tests: schemas, policy intersection, redaction, state transitions, and
  result classification.
- Integration tests: target resolution, responsive branches, recovery, and
  evidence serialization.
- End-to-end tests: discover/approve/replay, changed inputs, exceptional
  outcomes, and handoff/resume.
- A single `npm run demo` command will reset synthetic state and exercise the
  documented scenario matrix.
