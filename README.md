# Computer-Use Automation System

This repository implements the interface.ai Computer-Use Automation System
take-home assignment and demonstrates one complete flow:

```text
natural-language goal
  -> genuine LLM-driven browser discovery
  -> reviewed, versioned capability artifact
  -> deterministic replay without an LLM
  -> typed result or same-session human handoff
```

The target surface is a local, synthetic **Member Contacts Admin** web
application. The application supports contact lookup and CRUD operations while
deliberately exercising responsive layouts, expected business outcomes, runtime
failures, and sensitive-field escalation.

> Current state: the resettable Contacts application, semantic browser surface,
> redacted evidence, bounded LLM discovery, approved capability compilation,
> deterministic replay, and same-session human handoff are implemented. See
> [`docs/STATUS.md`](docs/STATUS.md) for the exact current state.

## Quick evaluation (no credentials)

Prerequisites are Node.js 22.18 or newer and npm. From a clean checkout:

```bash
npm install
npm run browser:install
npm run demo
npm run check
npm test
```

`npm run demo` owns local port 4174 and should print eight `PASS` lines: seven
scenario results plus evidence verification. It requires no `.env`, API key, or
separately running server.

## Interactive automation console

Copy the public template to `.env`, add your local `OPENAI_API_KEY`, and keep
that file uncommitted:

```bash
cp -n .env.example .env
```

Then start the application (restart it after any `.env` change):

```bash
npm install
npm run browser:install
npm run app:start
```

Open `http://127.0.0.1:4173`. The default page is a guided, three-phase
demonstration. Its two-column desktop layout places the live Member Contacts
application on the left and the lifecycle controls on the right; narrow screens
stack the same content vertically.

The member application remains fully usable by a person: add, edit, remove, and
search members without leaving the page. Search accepts a member ID, name,
email, or phone number, reports the number of matches, and has an explicit
**Clear** action.

1. **LLM discovery (“training”)** — keep or edit the supplied goal and select
   **Run live LLM discovery**. A real model observes the browser and chooses one
   bounded semantic action per turn. The page then displays the model-call
   count, the discovered role/label targets, run ID, and redacted evidence path.
   The rehearsal changes are reset automatically so replay starts from the same
   fixture.
2. **Generate and approve** — inspect the typed draft and enter the reviewer's
   name. **Approve capability** signs the exact artifact with an integrity
   digest and unlocks execution.
3. **Deterministic replay** — select **Run deterministic replay**. The approved
   artifact performs the task and independently verifies the result with
   `modelCallCount: 0`. The updated contact and structured result are visible on
   the same page.

Use this goal for the complete path:

```text
Update member M-1001's phone number to 555-0195
```

After approval, the result panel also distinguishes a legitimate not-found
business outcome, bounded transient recovery, fail-closed ambiguity, an
unsupported instruction, and work requiring a human. Use the supplied example
buttons and scenario choices to exercise those paths without leaving the page.
Selecting **ambiguous-actions** immediately reveals a second identical **Edit**
control on each member card so the injected ambiguity is visible before the
automation is run.

Select **Reset entire demo** to restore the three seed members, clear the
session's discovery draft, approval, and latest run, and return the screen to
Phase 1. Generated evidence is deliberately retained as an audit record. The
credential-free `npm run demo` command remains the fastest automated evaluation
path and does not use an API key.

The console accepts only two reviewed replay intents—updating a member phone and
finding a member—so it is deliberately not an open-ended chatbot. Asking it to
update an SSN returns **Human control required** before any browser action or
model call. The separate headed handoff demonstration below proves the
same-session human workflow. The masked, human-only SSN control is also
available from each member's inline **Edit** form. It retains only whether an
operator supplied a value and never displays or stores the raw submission. When
this escalation occurs, the result card shows the exact member-specific handoff
command, a copy button, and the complete claim/edit/release sequence so the
evaluator does not need to search this README for the next step.

The separate `/contacts` and `/admin/scenarios` routes are implementation
surfaces used by deterministic browser replay and automated tests. They are not
part of the evaluator-facing navigation; use `/automation` for manual review.

### Typed capability API

The expandable catalog in Phase 3 is backed by a machine-readable, agent-facing
API. With the application running, discover the contracts:

```bash
curl -s http://127.0.0.1:4173/api/capabilities
```

Invoke a capability by name with validated typed arguments:

```bash
curl -s -X POST http://127.0.0.1:4173/api/capabilities/contact.update-phone/invoke \
  -H 'content-type: application/json' \
  -d '{"inputs":{"memberId":"M-1001","phone":"555-0199"},"scenario":"normal"}'
```

The interactive app requires the session's update capability to be discovered
and approved before that update invocation can execute. A successful response
includes typed outputs, the structured result, evidence location, and
`modelCallCount: 0`. Unknown capabilities return `404`; malformed or unknown
inputs return `400` before browser execution.

### Multi-run stability

Run every approved capability across repeated success and business-outcome
cases:

```bash
npm run stability -- --runs 5
```

The command starts its own isolated application, invokes the typed API five
times per case, verifies final application state, reports pass rate, outcome
variation, median/p95 duration, and a flakiness signal, then writes the detailed
report to `evidence/generated/stability-report.json`. It requires no API key or
separately running server. Supported run counts are 2 through 25.

## Sensitive-data controls and handoff

The visual password mask is not treated as the security boundary. Browser
observations exclude field values, effective policy inspects the resolved
control before every action, and automation is denied access to password/SSN
semantics.

To demonstrate the SSN handoff without an API key or a separately running app:

```bash
npm run handoff -- --member-id M-1001
```

The command opens two tabs. In the Human handoff tab, select **Claim browser**;
in the existing Contacts tab, enter a synthetic nine-digit value and select
**Save changes**; then return to Human handoff and select **Release and request
verified resume**. The command succeeds only after the unchanged Contacts page
shows the non-sensitive `On file` checkpoint. Use synthetic data only. The value
is never supplied to the model, CLI, operator app, audit, or stored contact
record.

New contacts receive server-generated sequential member IDs. The browser and
automation never choose the identifier.

Run the current verification suite with:

```bash
npm run check
npm test
```

## Discovery interface

Live discovery is the only credential-dependent path. Copy `.env.example` to a
local `.env`, set `OPENAI_API_KEY` without committing it, and start the Contacts
app in one terminal. Then run a real model-driven discovery in another:

```bash
npm run discover -- --goal "Update member M-1001's phone number to the provided phone input" --member-id M-1001 --phone 555-0199
```

The command uses the Responses API only during discovery, drives Chromium with
semantic targets, verifies the resulting application state independently, and
writes redacted, manifest-hashed evidence under `evidence/generated/`.

Compile a discovery trace into a draft, then have a named reviewer explicitly
approve it into a separate digest-bound artifact:

```bash
npm run capability:compile -- --trace evidence/generated/<run-id>/trace.json --manifest evidence/generated/<run-id>/manifest.json
npm run capability:approve -- --capability capabilities/contact-update.draft.json --approved-by <reviewer-name>
```

Approval covers both capability content and reviewer metadata. Any subsequent
change invalidates the digest. Replay is deterministic and does not use an LLM:

```bash
npm run replay -- --capability capabilities/contact-update.approved.json --member-id M-1002 --phone 555-0299
```

Run the complete credential-free evaluation matrix with one command:

```bash
npm run demo
```

The demo starts and resets its own local Contacts server, runs every scenario in
headless Chromium, prints expected versus actual typed outcomes, regenerates the
redacted deterministic evidence under `evidence/submission/demo/`, and verifies
all manifest digests and privacy rules. It does not use an API key or external
service. Run the verifier independently with:

```bash
npm run evidence:verify
```

The genuine five-call discovery record is curated under
`evidence/submission/discovery-live/`; rerunning live discovery remains a
separate, optional credential-dependent step.

## Repository map

- `apps/contacts`: resettable synthetic target and controlled runtime states.
- `apps/operator`: local claim/release surface for human control.
- `packages/contracts`: strict capability, evidence, result, and intervention
  schemas.
- `packages/discovery`, `compiler`, and `replay`: learn once, review, then run
  model-free.
- `packages/surface-playwright`, `policy`, `session`, and `evidence`: browser
  seam, effective authority, exclusive ownership, and redacted audit.
- `evidence/submission`: committed discovery and reproducible demo packages.

## Demonstration matrix

| Scenario                        | Viewport | Expected result                       |
| ------------------------------- | -------: | ------------------------------------- |
| Existing contact lookup/update  | 1440x900 | `success`                             |
| Same approved capability        | 768x1024 | `success`                             |
| Same approved capability        |  375x667 | `success`                             |
| Missing contact                 |      Any | `CONTACT_NOT_FOUND` business outcome  |
| Duplicate or ambiguous target   |      Any | Fail closed without clicking          |
| Recoverable transient condition |      Any | Bounded recovery, then `success`      |
| SSN update                      |      Any | Same-session human handoff            |
| Unknown layout or postcondition |      Any | Escalation or structured hard failure |

## Project documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): system design and invariants.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md): ordered tasks
  and acceptance criteria.
- [`docs/STATUS.md`](docs/STATUS.md): current work, verification, blockers, and
  next actions.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): durable architectural decisions.
- [`REPORT.md`](REPORT.md): required seven-section design write-up.

## Continuing in a new session

Start a new coding session in this repository and say:

```text
continue
```

The repository-level instructions in [`AGENTS.md`](AGENTS.md) direct the coding
agent to reconstruct context from the documents above, run the recorded health
check, resume the first unblocked task, verify it, and update the handoff state
before stopping.

## Included deliverables

The repository contains:

- A working source tree and precise setup/run instructions.
- This evaluator-facing `README.md`.
- `/REPORT.md` using the seven headings required by the assignment.
- `/evidence/` containing a real discovery run, deterministic replay evidence,
  an exceptional-state replay, and same-session handoff evidence.
