# TraceVista local toolkit

Install once, invoke from your agent, then browse or query the same trajectory.
This toolkit packages the existing converter and viewer. Existing cloud import,
agent plugins, semantic zoom, Story/Map, playback and chat remain available.

## Install from this branch

Requires **Node.js 24+** and **Python 3.10+**. Building from source also needs pnpm 11+.
There is no public npm release of this toolkit yet. Build the local package:

```sh
git clone --branch codex/graphify-product-workflow https://github.com/Superone77/TraceVista.git
cd TraceVista
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm package:toolkit
(cd .work/tracevista-toolkit && npm pack --ignore-scripts)
npm install -g ./.work/tracevista-toolkit/tracevista-toolkit-0.1.0.tgz
tracevista doctor
```

In an existing local checkout, start with pnpm install. Install the generated `.tgz`,
not the package directory: npm links local directories, whereas the tarball is copied
into the installation. After tarball installation, the source checkout and generated
package can be moved or removed. The package includes the viewer and skill, with no
npm runtime dependencies or installation hooks.
For development, `pnpm tracevista --help` runs the same CLI without global installation.
Set `TRACEVISTA_PYTHON` if Python is installed under another executable name.

## Install the agent entry point

Run inside the project containing the logs (project-local installation is the default):

```sh
tracevista install --agent codex
# Or:
tracevista install --agent claude --project /path/to/project
tracevista install --agent pi --user
```

Restart the agent session. Invoke `$tracevista /path/to/session.jsonl` in Codex,
`/tracevista /path/to/session.jsonl` in Claude Code, or
`/skill:tracevista /path/to/session.jsonl` in Pi.

The installed skill is a self-contained copy, including the shared conversion
instructions and Python scripts. It does not depend on the source checkout.
Existing skill directories are preserved; choose a new project or move the old
copy before installing an update. Existing `tracevista-skill` plugins still work.

## From logs to a workspace

Your agent can perform these steps. `run` routes a completed export directly to
build; a raw log goes to prepare and still needs agent interpretation:

```sh
tracevista run /path/to/session.jsonl --images keep --out tracevista-work
# The agent reads TASK.md and the extracted evidence, writes state-analysis.json,
# then uses the existing build_state_graph.py and validate_trace.py scripts.
tracevista build tracevista-work/task.agent-state.json --out tracevista-out
tracevista open tracevista-out
```

Choose `--images omit` to omit images, or `keep` to retain them. For multiple sessions,
provide a conversion manifest and add `--manifest`. A folder input is accepted only
when it contains exactly one matching file; the CLI does not guess which run to use.
Repeated `--secret-file FILE` options pass known local secrets to the existing extractor
for redaction. No model is called by the CLI; the invoking agent writes the summaries.

```text
tracevista-out/
├── trace.html               offline reading snapshot, opens in a browser
├── trace.agent-state.json   byte-identical validated export, including source records
├── TRACE_REPORT.md          existing state and phase summaries in reading order
├── reading-quality.json     existing validator's reading-layer report
└── workspace.json           schema version, producer, counts and source checksum
```

`tracevista open` starts the complete existing viewer at `http://127.0.0.1:8877`
and loads this trajectory automatically through a private per-launch URL. Keep the
terminal running; Ctrl+C stops it. Reopening uses the same browser origin so the
existing model settings, chat history and language preferences remain available.
If the port is occupied, the command reports an error instead of silently choosing
another. Stop the earlier viewer, or choose `--port 8878` and reuse that port for
subsequent visits. Different ports have separate browser settings and chat histories;
settings from the old random-port implementation are not automatically migrated.
This mode includes the existing Chat and execution-order/version-tree controls.
It serves only built viewer assets and the selected trace, not your project directory.
Chat still uses user-configured endpoints and existing browser cross-origin constraints.

Double-click trace.html or use `tracevista open --offline` for the existing offline
reading mode, which hides Chat, import/export and view-setting menus. No server is
needed for this snapshot. Use `--no-open` to print either URL without launching a browser.
No CLI command configures or calls a model.

## Query, inspect and revise

```sh
tracevista info tracevista-out
tracevista query "latency" --in tracevista-out --limit 10
tracevista inspect s1 --in tracevista-out
tracevista inspect E12 --in tracevista-out
```

Commands return JSON for both humans and agents. Query is case-insensitive literal
search: all whitespace-separated terms must occur in an entity or original record.
It returns matching IDs and previews, not generated answers. Inspect returns the
complete entity, full cited events, direct relations and child IDs. IDs come from
your own export; s1 and E12 above are illustrative.

For revisions, use the conversion skill's existing incremental workflow. Rebuild
into a fresh directory, for example `--out tracevista-out-r2`, to preserve the
previous output. No automatic file watching or model regeneration is added.

Generated workspaces contain your evidence. They use private file permissions and
are excluded from this repository's Git defaults. The CLI does not upload them.

## Development checks

```sh
pnpm test:toolkit
pnpm test
pnpm build
pnpm test:toolkit-package
pnpm package:toolkit --out /tmp/tracevista-toolkit-package
```

Product packaging is inspired by [Graphify](https://github.com/Graphify-Labs/graphify):
install → invoke → generate → browse/query. Graphify is not a runtime dependency.
