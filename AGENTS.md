# Project conventions

- Use plain language. Keep the viewer agent-neutral and task-neutral; put source-specific interpretation in adapters/examples.
- Preserve raw event text, IDs, call/result pairing and source attachments. Labels and inferred relationships need cited evidence.
- Chronology and code ancestry are separate. Review PASS is not correctness or performance evidence.
- Example traces may contain private research data. Keep credentials and ordinary local imports out of Git and production builds. Only examples explicitly approved for this repository belong under viewer/public/examples/. Each example is one complete JSON export; do not add separate original experiment files. Current approved examples, with English annotations, are Pi Agent, multi-LoRA shrink/expand kernel optimization, 2026-10-01; and the public Apache-2.0 PostTrainBench Fable 5 Max / AIME 2025 / Qwen3-4B-Base run 1, job 17337591, selected on 2026-10-04. Also approved on 2026-10-04: public Apache-2.0 InferenceBench run_0155 (Codex / GPT-5.5 High, Scenario D); and CC-BY-4.0 SWE-rebench OpenHands trajectory chatcmpl-86805430c534a25711dc2c50c473619c (dpkp/kafka-python issue 1312). Also approved on 2026-10-05: the public Apache-2.0 LiteResearcher SFT teacher trajectory, default/train row 60000, dataset revision `5c8caa17121e216f8ad8f928e6a8d4f51d3fefee`, with English annotations and a delivered-answer state scope. Keep Pi Agent first in the catalog. KDA was replaced by Pi Agent on 2026-10-04; do not bundle its export.
- Run `pnpm test` and `pnpm build` for relevant changes. Do not claim a model/benchmark ran when only conversion or UI tests ran.

## Branch and review workflow

- Treat `main` as the integration branch. Work on a development branch; local edits, experiments, previews, and commits may stay local. Completing a change does not by itself require pushing or opening a PR. Push when the user requests or has authorized remote delivery. When preparing to integrate changes into `main`, open a pull request.
- Wait for the user's explicit approval of the PR before merging. Never approve a PR on the user's behalf, enable auto-merge before approval, push directly to `main`, or bypass the local pre-push hook.
- `Superone77` is the designated code owner. GitHub does not allow a PR author to approve their own PR: when using the owner's login to create PRs, wait for the user's explicit review/approval in this chat. Do not report it as a GitHub approving review. A separate submitter identity is needed for GitHub-native owner approval.
- Install the local guard in a fresh clone with `pnpm setup:hooks`. GitHub-side protection must be independently enabled and verified; a local hook or CODEOWNERS file alone does not enforce remote approval.
