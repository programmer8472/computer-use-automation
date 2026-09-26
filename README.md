# Computer-Use Automation System

This repository is being developed for the interface.ai Computer-Use Automation
System take-home assignment. It will demonstrate one complete flow:

```text
natural-language goal
  -> genuine LLM-driven browser discovery
  -> reviewed, versioned capability artifact
  -> deterministic replay without an LLM
  -> typed result or same-session human handoff
```

The target surface will be a local, synthetic **Member Contacts Admin** web
application. The application supports contact lookup and CRUD operations while
deliberately exercising responsive layouts, expected business outcomes, runtime
failures, and sensitive-field escalation.

> Current state: the resettable Contacts application, semantic browser surface,
> redacted evidence, and genuine bounded LLM discovery are implemented.
> Capability compilation and deterministic replay are next. See
> [`docs/STATUS.md`](docs/STATUS.md) for the exact current state.

## Available target application

```bash
npm install
npm run browser:install
npm run app:start
```

Open `http://127.0.0.1:4173`. In a separate terminal, restore the three-member
synthetic fixture at any time:

```bash
npm run data:reset
```

The deterministic test conditions are available at
`http://127.0.0.1:4173/admin/scenarios`. They cover a one-shot transient search
failure, duplicate visible actions, and a dismissible legacy interstitial. The
SSN page retains only whether an operator supplied a value; it never displays or
stores the submitted value.

New contacts receive server-generated sequential member IDs. The browser and
automation never choose the identifier.

Run the current verification suite with:

```bash
npm run check
npm test
```

## Discovery interface

With the Contacts app running and local `.env` configuration in place, run a
real model-driven discovery:

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
change invalidates the digest. The following commands will be added by later
milestones:

```bash
npm run replay -- --capability contact.update --member-id 12345 --phone 5550102
npm run demo
```

No API key or service dependency will be required for deterministic replay.
Discovery will use a provider adapter configured through user-supplied
environment variables; secrets must never be committed or copied into evidence.

## Planned demonstration matrix

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

## Continuing in a new session

Start a new coding session in this repository and say:

```text
continue
```

The repository-level instructions in [`AGENTS.md`](AGENTS.md) direct the coding
agent to reconstruct context from the documents above, run the recorded health
check, resume the first unblocked task, verify it, and update the handoff state
before stopping.

## Required final deliverables

The finished repository will contain:

- A working source tree and precise setup/run instructions.
- This evaluator-facing `README.md`.
- `/REPORT.md` using the seven headings required by the assignment.
- `/evidence/` containing a real discovery run, deterministic replay evidence,
  an exceptional-state replay, and same-session handoff evidence.
