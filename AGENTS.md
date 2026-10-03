# Project conventions

- Use plain language. Keep the viewer agent-neutral and task-neutral; put source-specific interpretation in adapters/examples.
- Preserve raw event text, IDs, call/result pairing and source attachments. Labels and inferred relationships need cited evidence.
- Chronology and code ancestry are separate. Review PASS is not correctness or performance evidence.
- Example traces are private research data. Keep credentials and ordinary local imports out of Git and production builds. Only examples explicitly approved for this repository belong under viewer/public/examples/. Each example is one complete JSON export; do not add separate original experiment files. The current approved example is Kernel Design Agent (KDA), W8A16, 2026-10-02, with English annotations.
- Run `pnpm test` and `pnpm build` for relevant changes. Do not claim a model/benchmark ran when only conversion or UI tests ran.

## Branch and review workflow

- Treat `main` as the integration branch. Make every change on a separate `feat/*`, `fix/*`, or `chore/*` branch and open a pull request into `main`.
- Wait for the user's explicit approval of the PR before merging. Never approve a PR on the user's behalf, enable auto-merge before approval, push directly to `main`, or bypass the local pre-push hook.
- `Superone77` is the designated code owner. GitHub does not allow a PR author to approve their own PR: when using the owner's login to create PRs, wait for the user's explicit review/approval in this chat. Do not report it as a GitHub approving review. A separate submitter identity is needed for GitHub-native owner approval.
- Install the local guard in a fresh clone with `pnpm setup:hooks`. GitHub-side protection must be independently enabled and verified; a local hook or CODEOWNERS file alone does not enforce remote approval.
