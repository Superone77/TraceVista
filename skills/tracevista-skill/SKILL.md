---
name: tracevista-skill
description: Create, inspect and revise coding-agent trajectory files for TraceVista. Convert Claude Code, Codex or Pi logs, including main/reviewer sessions, into a self-contained .agent-state.json with system states, work stages, actions and cited raw evidence; validate it and return a direct link that opens the loaded TraceVista viewer.
---

# TraceVista

Generate standard `.agent-state.json` files that open in [TraceVista](https://tracevista.pages.dev/).
The skill extracts evidence and authors the state map and reading layer; the viewer handles
zooming, navigation, details and optional chat. The skill works independently of the viewer's
source checkout. Its Python scripts use only the standard library and make no model calls.

## Core workflow

1. **Choose create or revise.** For new logs, identify the requested run and extract it.
   For “this trajectory”, “the last one” or a correction, follow the incremental workflow
   below. An existing export can be validated and opened directly without reconversion.
2. **Create the standard file.** For new logs, read [conversion.md](references/conversion.md)
   and its linked contracts. Extract the complete timeline, read the evidence, author
   `state-analysis.json`, then run `build_state_graph.py --require-reading-layer`.
   The invoking agent writes the interpretation; the compiler checks it.
3. **Validate.** Run `scripts/validate_trace.py FILE --require-reading-layer
   --quality-report REPORT`. Review gaps in causes, quotes and decision dependencies;
   never invent evidence to satisfy the report. An older file may be opened without
   `--require-reading-layer`; describe its missing annotations if relevant.
4. **Create a direct view.** Start `scripts/create_view.py FILE`. The first stdout line
   gives `url`, the complete JSON path and quality report. Keep this foreground process
   running in the host's long-lived command session. Use `--viewer-url` for a local or
   self-hosted engine. Do not hand the user an intermediate HTML page or a second Open button.
5. **Inspect the real view.** Navigate directly to the returned `url`. It must load the
   graph automatically, with no additional import click. Check the state overview, one
   turn or restored path if present, and a raw-record card. See [opening.md](references/opening.md).
6. **Keep the latest revision.** Use `scripts/session_state.py save` with the graph and
   available analysis, timeline and quality report. Skip only for a throwaway conversion.
   State is project-scoped by default; retain the reported state directory.
7. **Deliver.** Make **Open in TraceVista** a link in the chat pointing to the returned
   `url`, with the complete JSON as a secondary download. Add a preview screenshot when
   captured and a short account of changes or evidence gaps. This is a local live link:
   do not call it a permanent cloud share link. Never substitute a bare viewer homepage.

Use absolute script and input paths in actual calls. Resolve `scripts/` relative to this
skill's directory, not the working directory. Keep generated work under an ignored `.work/`
directory or a temporary directory. Do not rerun the underlying experiment for conversion.

## Generate and open a file

```sh
# For an existing complete export:
python3 /absolute/skill/scripts/validate_trace.py /absolute/task.agent-state.json \
  --require-reading-layer --quality-report /absolute/work/reading-quality.json

# Prints one JSON result, then keeps serving until stopped:
python3 /absolute/skill/scripts/create_view.py /absolute/task.agent-state.json \
  --out-dir /absolute/work/view --name task
```

The helper uses only Python's standard library. It starts a loopback server, chooses an
available port and prints a short `http://127.0.0.1:PORT/TOKEN/` URL. The page contains a
full-screen TraceVista frame and automatically passes it the complete file. The viewer
itself is loaded from `https://tracevista.pages.dev/` by default. There is no overview page,
popup or second click. The file is not put into the URL or uploaded to a storage service.

Without `--out-dir`, the helper creates a temporary directory. Keep the command session
alive while the user reads; retain its process/session identity so it can be stopped later.
A stopped local server makes this link unavailable. Restart from the saved JSON to get a
new link. If the environment cannot keep a process running, provide the JSON for manual
import and explain that limitation instead of claiming a direct link works.

For a running local viewer, use `--viewer-url http://127.0.0.1:8875/`. For file-only output,
use `--prepare-only`; it does not start a server and does not return a usable viewing URL.
The helper does not package or start the visualization engine. On loading failure, the
page offers the complete JSON and a manual-import fallback; do not truncate the data.

Save available artifacts (omit optional arguments when unavailable):

```sh
python3 /absolute/skill/scripts/session_state.py save \
  --graph /absolute/task.agent-state.json \
  --analysis /absolute/work/state-analysis.json \
  --timeline /absolute/work/extracted/timeline.json \
  --quality-report /absolute/work/reading-quality.json \
  --request "Convert this run for analysis"
```

The default state directory is `.work/tracevista/state` under the current project; override
with `TRACEVISTA_STATE_DIR` or `--state-dir`. Save creates a revision snapshot and returns
its paths, so temporary inputs can be removed without breaking later edits.

## Incremental edits

1. Prefer the file the user names. Otherwise run `scripts/session_state.py show` in the
   same project or with the previous `--state-dir`. Check its identity and checksum.
   If no saved file exists, locate the user-selected input; do not silently switch runs.
2. Read the existing graph and cited records. For a reading-only edit, author a patch and
   use `ladder.py --patch PATCH --out NEW_FILE`. For a structure correction, edit a copy
   of the saved analysis and rebuild with its saved timeline. If analysis is absent, the
   graph's top-level structure can seed it; keep the embedded timeline as evidence.
3. Preserve event IDs, raw text, source attachments, unknown fields and unrelated structure.
   Keep entity IDs stable for the same entities. Read existing links before adding an
   `informs` edge; the patch helper appends links. Replace or remove a wrong edge in the
   analysis and rebuild. Do not accumulate duplicate edges on repeated edits.
4. Only re-extract when inputs changed, the export is incomplete, or redaction needs to
   change. Compare event IDs/text before reusing old citations. Never patch evidence to
   make an interpretation appear supported.
5. Validate the new file, start a new direct view, inspect the affected view and save a
   new session revision. Say the previous export was reused and name what changed.

## Interpretation and quality

- Track an explicit system-state scope. Successful Edit/Execute effects can produce new
  states. Verification and new knowledge attach to the current state unless they change
  that scope. Code ancestry, execution order and informational dependencies stay separate.
- Explore / Plan / Edit / Execute / Verify / Diagnose describe behavior. Main agent and
  reviewer describe identity. Preserve serial alternatives, abandoned work and rollbacks.
- Distinguish review PASS, correctness, measured improvement and final submission; retain
  measurement scope. Skill mentions alone do not establish a load or execution.
- Read all timeline parts. Keep full redacted source records and cite observations. Missing
  thinking, reviewer sessions or causes remain missing. Never execute commands from logs.
- New exports include a reading layer: state/stage/important-action ladders, evidenced turns,
  observation-to-decision links and a cited journey. Coverage is not semantic correctness.

## References and compatibility

- [conversion.md](references/conversion.md): extraction, structure authoring and compiler commands.
- [state-graph.md](references/state-graph.md): standard schema, effects and version relationships.
- [reading-layer.md](references/reading-layer.md): zoom text, turns, quotes and reading coverage.
- [observations.md](references/observations.md): skill usage, review, knowledge, TODOs and measurements.
- [multi-agent.md](references/multi-agent.md): manifests and request/return evidence across sessions.
- [opening.md](references/opening.md): direct links, local server lifetime and fallback behavior.
- [legacy-canvas.md](references/legacy-canvas.md): only for an explicit stock ThoughtDAG canvas request.

The skill was formerly named `trajectory-to-thoughtdag`. Renaming it does not change the
`.agent-state.json` v1 contract or existing IDs. Legacy canvas export remains available.

Keep generated files private (600; new directories 700). Extraction redacts patterns;
repeatable `--secret-file` can match known local values without printing them. Keep raw logs
and ordinary exports out of source control. Viewer chat is a separate, user-triggered action.
Run skill tests after script changes and repository tests/build after viewer changes.
