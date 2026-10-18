# Opening a trace in TraceVista

## Default: import the current file in the cloud viewer

After generating and validating the complete `.agent-state.json`:

1. Open [TraceVista](https://tracevista.pages.dev/) in the user's browser.
2. Click **Import trajectory** (older UI: **导入轨迹**) and select the current export.
   On the homepage the button is directly visible; in a loaded viewer, open the top-left
   **Viewer menu** (☰) first. Use browser tools to do this when they
   support local file selection. Loading a bundled example is a separate demonstration.
3. Confirm the task and state overview match this file. Inspect a turn or restored path
   when present and open a raw-record card to check its evidence.
4. Return the complete JSON and say what was checked. Include a screenshot if captured.

When browser access or file selection is unavailable, provide the JSON and tell the user
to open TraceVista, click **Import trajectory**, and choose that file. Describe browser verification
as pending. No local helper process is needed for this workflow.

The selected file is processed in the browser. Its loaded state belongs to the open tab;
`https://tracevista.pages.dev/` is the viewer address, not a saved link to that trajectory.
Reopen the JSON to restore the graph. Optional viewer chat sends selected context to the
configured model when the user asks a question.

## Optional local preview

For an explicitly requested local preview, use the standard-library helper below. This
requires Python 3.10 or later and starts a local server; it is not the default cloud import.

```sh
python3 /absolute/skill/scripts/create_view.py /absolute/task.agent-state.json \
  --out-dir /absolute/work/view --name task
```

The command prints one JSON result with `url`, `graph`, `quality_report`, `viewer_url` and
`counts`, then serves in the foreground. Keep it running in a long-lived command session.
Open and test the returned `url` before delivering it. The server selects a free port by
default; `--port` can request a specific one. `--prepare-only` writes the JSON and quality
report without starting a server, and therefore does not return a viewing URL.

The local page embeds the selected TraceVista engine and automatically passes it the
complete file. Default engine: `https://tracevista.pages.dev/`. A locally running engine can
be selected with `--viewer-url http://127.0.0.1:8875/`. The skill needs Python's standard
library; it does not need to build or run the engine's source.

### Lifetime and fallback

- The URL is local to the same machine and works while that helper process runs. Keep its
  command/session identity. Stop it when no longer needed; never kill unrelated servers.
- Refreshing the outer page reloads the complete trace automatically. View state and transient
  selection are not saved by this link. Graph revisions are preserved separately below.
- Restarting from the saved JSON produces a new live URL. Do not reuse a URL from a stopped
  server or promise a permanent/public share link.
- If the engine cannot load, no longer supports import, or a browser policy blocks embedding,
  show a loading error and offer the complete JSON plus manual import in a standalone viewer.
- The 64 MiB limit applies to automatic transfer. Do not truncate evidence to fit it. This
  size limit is not a guarantee of smooth rendering for graphs of that size.

Only the random route for this trace is served, not a filesystem directory. The helper binds
127.0.0.1, checks Host and returns no-store responses. It does not upload a copy to cloud
storage. The selected engine's code processes the file in the browser.

## Continuing an edit

Use `session_state.py save --graph FILE` with available analysis, timeline and quality report.
It stores a new private revision and atomically updates the latest pointer. `show` verifies
checksums and returns paths. Default `.work/tracevista/state` is project-scoped; use
`TRACEVISTA_STATE_DIR` or `--state-dir` when working elsewhere.

For a reading-only correction, patch the existing graph while preserving raw events and IDs.
For changed structure, edit the analysis and rebuild against the saved timeline. Validate the
result and import the new file in the cloud viewer. If a local preview was requested, start
it from the new revision and return its new local URL; an older running view keeps its
original file.
