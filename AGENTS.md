# Project conventions

- Use plain language. Keep the viewer agent-neutral and task-neutral; put source-specific interpretation in adapters/examples.
- Preserve raw event text, IDs, call/result pairing and source attachments. Labels and inferred relationships need cited evidence.
- Chronology and code ancestry are separate. Review PASS is not correctness or performance evidence.
- Keep credentials and ordinary local imports out of Git and production builds. Public examples live in the independent `TraceVista-examples` repository, with a catalog at `examples/index.json`, complete JSON exports, thumbnails, and their own `THIRD_PARTY_NOTICES.md` and `LICENSES/`. Do not restore example data under `viewer/public/`. Only maintainer-approved cases belong in that library; do not add, replace or extend an export without that approval. Each case is one complete JSON export; do not add separate original experiment files. Keep Pi Agent first in the catalog.
- The garden example is a fixed excerpt (events `continued:E853` through `continued:E1098`) of a longer session. Include only that self-contained excerpt and its thumbnail in the example library; the full export and later videos stay out of both repositories.
- Default `pnpm dev`, `pnpm test`, and `pnpm build` must work without the example library. Use small synthetic fixtures for core tests. `pnpm dev:site` and `pnpm build:site` load the library from `TRACEVISTA_EXAMPLES_DIR` or the sibling `../TraceVista-examples`; `examples.lock.json` records the data commit and SHA-256 of served assets. Commit an approved data update before refreshing the lock with `pnpm examples:lock -- ../TraceVista-examples`.
- Run `pnpm test` and `pnpm build` for relevant engine changes. For example or showcase changes, also run `pnpm test:examples` and `pnpm build:site`. Standalone output is `dist/`; showcase output is `dist-site/`. Preserve `tracevista-release.json` with each release so the viewer revision, dirty state, and example revision/lock hash can be inspected. Do not claim a model/benchmark ran when only conversion or UI tests ran.

## Branch and review workflow

- Treat `main` as the integration branch. Work on a development branch; local edits, experiments, previews, and commits may stay local. Completing a change does not by itself require pushing or opening a PR. Push when the user requests or has authorized remote delivery. When preparing to integrate changes into `main`, open a pull request.
- Wait for the user's explicit approval of the PR before merging. Never approve a PR on the user's behalf, enable auto-merge before approval, push directly to `main`, or bypass the local pre-push hook.
- `Superone77` is the designated code owner. GitHub does not allow a PR author to approve their own PR: when a PR is created with the owner's login, wait for the user's explicit approval in the conversation and do not report it as a GitHub approving review.
- Install the local guard in a fresh clone with `pnpm setup:hooks`. GitHub-side protection must be enabled and verified separately (see CONTRIBUTING.md); a local hook or CODEOWNERS file alone does not enforce remote approval.
