# Project conventions

- Use plain language. Keep the viewer agent-neutral and task-neutral; put source-specific interpretation in adapters/examples.
- Preserve raw event text, IDs, call/result pairing and source attachments. Labels and inferred relationships need cited evidence.
- Chronology and code ancestry are separate. Review PASS is not correctness or performance evidence.
- Keep credentials and ordinary local imports out of Git and production builds. Only examples approved by the maintainer belong under viewer/public/examples/; each one is listed in `viewer/public/examples/index.json` with its source and license in THIRD_PARTY_NOTICES.md. Each example is one complete JSON export; do not add separate original experiment files. Do not add, replace or extend a bundled export without the maintainer's approval. Keep Pi Agent first in the catalog.
- The garden example is a fixed excerpt (events `continued:E853` through `continued:E1098`) of a longer session. Bundle only that self-contained excerpt and its thumbnail; the full export and later videos stay out of the repository.
- Run `pnpm test` and `pnpm build` for relevant changes. Do not claim a model/benchmark ran when only conversion or UI tests ran.

## Branch and review workflow

- Treat `main` as the integration branch. Work on a development branch; local edits, experiments, previews, and commits may stay local. Completing a change does not by itself require pushing or opening a PR. Push when the user requests or has authorized remote delivery. When preparing to integrate changes into `main`, open a pull request.
- Wait for the user's explicit approval of the PR before merging. Never approve a PR on the user's behalf, enable auto-merge before approval, push directly to `main`, or bypass the local pre-push hook.
- `Superone77` is the designated code owner. GitHub does not allow a PR author to approve their own PR: when a PR is created with the owner's login, wait for the user's explicit approval in the conversation and do not report it as a GitHub approving review.
- Install the local guard in a fresh clone with `pnpm setup:hooks`. GitHub-side protection must be enabled and verified separately (see CONTRIBUTING.md); a local hook or CODEOWNERS file alone does not enforce remote approval.
