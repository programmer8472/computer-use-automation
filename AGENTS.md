# Project Instructions

## Secret handling

- Never read or expose `.env` files, credentials, tokens, private keys,
  certificates, or other secret-bearing files.
- Public templates such as `.env.example` may be read and edited, but they must
  contain placeholders only.
- Never place raw sensitive values, including SSNs, in prompts, logs, artifacts,
  screenshots, fixtures, reports, or test output.

## The `continue` command

When the user's message is exactly or substantially `continue`, resume the
project without requiring prior chat context:

1. Read `docs/STATUS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/ARCHITECTURE.md`,
   `docs/DECISIONS.md`, `README.md`, `REPORT.md`, and `evidence/README.md`.
2. Inspect the non-secret working tree and repository status.
3. Run the health check recorded in `docs/STATUS.md` when it exists.
4. Select the first unblocked task in `docs/IMPLEMENTATION_PLAN.md`, respecting
   dependencies and the current milestone in `docs/STATUS.md`.
5. Implement and verify that task. Continue with additional unblocked work when
   time permits.
6. Before ending, update:
   - task status and acceptance evidence in `docs/IMPLEMENTATION_PLAN.md`;
   - the current snapshot, tests, files changed, blockers, and next three tasks
     in `docs/STATUS.md`;
   - `docs/DECISIONS.md` if a significant design decision was made;
   - `docs/ARCHITECTURE.md` if system behavior or boundaries changed;
   - `README.md` if a user-facing command or workflow changed;
   - `REPORT.md` if a submission claim or limitation changed;
   - `evidence/README.md` if evidence generation, retention, or verification
     changed.

Do not report a task complete unless its listed acceptance criteria have been
verified. If the workspace and `docs/STATUS.md` disagree, investigate and make
`docs/STATUS.md` accurately describe the workspace.

## Engineering priorities

- Deliver a narrow, complete vertical slice before adding breadth.
- Keep LLM-driven discovery separate from model-free deterministic replay.
- Resolve controls semantically at runtime; do not persist screen coordinates as
  replay targets.
- Fail closed on ambiguous controls, policy uncertainty, sensitive actions, and
  unknown UI state.
- Keep evidence synthetic, minimized, redacted, and reproducible.
