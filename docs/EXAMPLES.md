# Example library

TraceVista's viewer and conversion skill work without a dataset checkout. The six public cases on the [website](https://tracevista.pages.dev/) live in a separate `TraceVista-examples` repository. The JSON format and `tracevista-skill` workflow are unchanged: import a complete `.agent-state.json` into either viewer.

The data repository has been prepared locally. Publishing it as `Superone77/TraceVista-examples` is pending; the commands below assume you already have a local copy.

## One codebase, two builds

Both variants compile the same `viewer/` source, including the example-gallery UI. The default build uses an empty catalog and shows a link to the website. The showcase build supplies the pinned catalog and copies its approved assets into `dist-site/`. `TraceVista-examples` contains data and attribution, while viewer features and fixes stay in the main code repository.

Deploy `dist-site/` to Cloudflare Pages for the website. Build it from a reviewed viewer commit and the data revision in `examples.lock.json`; no separate website code branch is needed.

## Run the showcase

Use this layout, or set `TRACEVISTA_EXAMPLES_DIR` to the example repository root:

```text
parent/
├── TraceVista/
│   ├── package.json
│   └── examples.lock.json
└── TraceVista-examples/
    ├── examples/index.json
    ├── examples/*.agent-state.json
    ├── example-thumbnails/
    ├── THIRD_PARTY_NOTICES.md
    └── LICENSES/
```

From the viewer repository, check out the data revision recorded in its lock file:

```bash
git -C ../TraceVista-examples checkout "$(node -p "require('./examples.lock.json').revision")"
pnpm test:examples
pnpm dev:site
```

Open [localhost:8876](http://127.0.0.1:8876/). For a different data location:

```bash
TRACEVISTA_EXAMPLES_DIR=/path/to/TraceVista-examples pnpm dev:site
```

The same variable applies to `pnpm test:examples`, `pnpm build:site`, and `pnpm examples:lock`. It names the repository root, not its `examples/` subdirectory. Default `pnpm dev`, `pnpm test`, and `pnpm build` do not require or load this library.

## Build and identify a release

| Command | Data required | Output |
|---|---|---|
| `pnpm test` | None | Viewer, skill, and small fixture checks |
| `pnpm build` | None | Standalone viewer in `dist/` |
| `pnpm test:examples` | Local example library | Full-export, source-evidence, catalog, and credential-pattern checks |
| `pnpm build:site` | Pinned local example library | Showcase in `dist-site/` |

`examples.lock.json` records the data repository, commit, and SHA-256 of each served asset: catalog, complete exports, thumbnails, source notices, and license files. Showcase builds validate those files against the lock and fail when a pinned asset is missing or changed. Use the recorded data revision to reproduce a website build.

Both build outputs include `tracevista-release.json`. It records the viewer Git revision and whether the checkout had local changes. Showcase metadata also records the example revision and lock-file hash; standalone metadata has `examples: null`. A dirty checkout is recorded as dirty, and a source archive without Git metadata has no verified viewer revision.

The showcase includes the library's notices at `examples/THIRD_PARTY_NOTICES.md` and license texts under `examples/LICENSES/`. Keep those files and the release metadata with the deployed output. Local imports under `viewer/public/local-data/` are excluded from production builds.

## Update examples

Keep the data and viewer changes reviewable as separate commits:

1. Edit the approved case in `TraceVista-examples`. Update `examples/index.json`, its thumbnail, and the library's source notices as needed. Each case remains one self-contained JSON export.
2. Commit the data changes in `TraceVista-examples`.
3. From the viewer checkout, run `pnpm examples:lock -- ../TraceVista-examples` to record that commit and the served-file hashes. Use your actual data path if it differs.
4. Run `pnpm test`, `pnpm build`, `pnpm test:examples`, and `pnpm build:site`. Inspect the affected example with `pnpm dev:site`, then commit the updated viewer lock and any engine changes.

Example tests validate the pinned files, so refresh the lock before testing changed data. These checks do not rerun the original model or benchmark.

Keep Pi Agent first in the catalog. Preserve the original messages, IDs, call/result pairing, source attachments, and license text. Analyst annotations must remain distinct from recorded evidence.

The Garden Animation case is a fixed excerpt, from `continued:E853` through `continued:E1098`, packaged as a complete export for that scope. Its full session export and later videos stay out of both repositories. Adding, replacing, or extending a public case follows the maintainer approval rule in [AGENTS.md](../AGENTS.md).
