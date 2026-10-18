# Contributing to TraceVista

Thanks for helping. Bug reports, new log adapters, viewer improvements, and interesting agent runs are all welcome.

Please follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through
the private channel in [SECURITY.md](SECURITY.md).

## Before you start

- **Bugs and ideas:** [open an issue](https://github.com/Superone77/TraceVista/issues). For a rendering problem, include the example or a small `.agent-state.json` that shows it, if you can share one.
- **Larger changes:** open an issue first so we can agree on the approach before you write code.
- **New examples:** open an issue that names the source, its license, and why the run is interesting. See [Adding an example](#adding-an-example).

## Set up

Requires **Node.js 24+**, **pnpm 11+**, and **Python 3.10+**. CI checks Node.js 24 and the latest Node.js release. `.nvmrc` provides a default; newer runtimes are accepted.

```bash
git clone https://github.com/Superone77/TraceVista.git
cd TraceVista
npm install -g pnpm@11
pnpm install --frozen-lockfile --ignore-scripts
pnpm setup:hooks   # optional: blocks accidental pushes to main
pnpm dev           # http://127.0.0.1:8875/
```

## Check your change

Run both before you open a pull request. CI runs the same commands.

```bash
pnpm test    # skill and viewer tests using small fixed fixtures
pnpm build   # type check and static build into dist/
```

Report what you actually ran. A conversion or UI test does not show that a model or benchmark ran.

## Where things live

| Path | What it is |
|---|---|
| `viewer/src/trajectory/` | React Flow viewer: map, Story, playback, chat |
| `viewer/scripts/` | Viewer tests, run by `pnpm test` |
| `skills/tracevista-skill/scripts/` | Python conversion scripts (standard library only) |
| `skills/tracevista-skill/references/` | Export format, reading layer, and writing guide |
| `examples.lock.json` | Pinned external example revision and file hashes |
| `docs/EXAMPLES.md` | Example library setup and website release commands |

## Design principles

- **Stay neutral.** The viewer works for any agent and any task. Source-specific interpretation belongs in adapters and examples.
- **Keep the evidence.** Preserve raw event text, IDs, call/result pairing, and source attachments. Every label or inferred relationship cites the evidence behind it.
- **Time and ancestry are different.** Execution order and code ancestry are separate views. A passing review is not proof of correctness or performance.
- **Write plainly.** Follow the [writing guide](skills/tracevista-skill/references/clear-writing.md): concrete verbs, consistent terms, one idea per sentence.

## Adding a log adapter

1. Add the parser to `skills/tracevista-skill/scripts/` and keep it on the Python standard library.
2. Map the source into the [state graph format](skills/tracevista-skill/references/state-graph.md). Keep original text and IDs.
3. Add a small fixture and tests under `skills/tracevista-skill/tests/`.
4. Document the new source in [conversion.md](skills/tracevista-skill/references/conversion.md).

## Adding an example

Examples are public. Each one must:

- come from a source whose license allows redistribution, or from a run you own and agree to publish;
- contain no credentials, private data, or unpublished research (`pnpm test:examples` runs a secret scan, but review the file yourself too);
- be one complete, self-contained `.agent-state.json` with English annotations;
- live in the separate `TraceVista-examples` repository, with an entry in its `examples/index.json`, a thumbnail in `example-thumbnails/`, and a source and license note in its `THIRD_PARTY_NOTICES.md`.

Open an issue before you send a large example so we can check the source and license.

Follow [the example-library workflow](docs/EXAMPLES.md) to pin the data revision, run
`pnpm test:examples`, and build the website with `pnpm build:site`. Default builds
and core tests work without downloading the example library.

## Pull requests

1. Branch from `main` with a short name such as `feat/…`, `fix/…`, or `docs/…`.
2. Keep each pull request focused on one change.
3. Fill in the pull request template: what changed and how you checked it.
4. A maintainer reviews and merges. Direct pushes to `main` are not accepted.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## For maintainers

The intended protection rules for `main` are in [.github/main-protection.json](.github/main-protection.json): pull requests only, one approving review from a code owner, stale approvals dismissed, no force pushes or deletion. Administrators are exempt from these rules. Apply and verify them with:

```bash
gh api --method PUT repos/Superone77/TraceVista/branches/main/protection \
  --input .github/main-protection.json
gh api repos/Superone77/TraceVista/branches/main/protection
```

GitHub does not let an author approve their own pull request, so code-owner approval needs a pull request opened by a different account.
