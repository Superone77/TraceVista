---
name: tracevista-skill
description: Create, inspect and revise coding-agent trajectory files for TraceVista. Convert Claude Code, Codex or Pi logs, including main/reviewer sessions, into a self-contained .agent-state.json with system states, work stages, actions and cited raw evidence; validate it and open it in the TraceVista web viewer.
---

# TraceVista

Generate standard `.agent-state.json` files that open in [TraceVista](https://tracevista.pages.dev/).
The skill extracts evidence and authors the state map and reading layer; the viewer handles
zooming, navigation, details and optional chat. The skill works independently of the viewer's
source checkout. Its scripts require Python 3.10 or later, use only the standard library
and make no model calls.

Install the complete `skills/tracevista-skill/` folder from the GitHub repository into the
project's `.agents/skills/tracevista-skill/` for Codex or `.claude/skills/tracevista-skill/`
for Claude Code. Repository access is required to download it; the viewer's Node environment
is not needed. See [opening.md](references/opening.md) for browser use and optional local preview.

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
4. **Open the current file.** Open `https://tracevista.pages.dev/` in the user's browser
   and use **Import trajectory** (older UI: **导入轨迹**) to select the complete JSON just generated. In a loaded viewer, this action is inside the top-left **Viewer menu** (☰). When browser tools
   support file selection, perform the import. Otherwise provide the file and these
   manual steps. The default workflow uses the cloud viewer and does not start a local server.
5. **Inspect the real view.** After importing, confirm the displayed task is the current
   export, then check the state overview, one turn or restored path if present, and a
   raw-record card. A bundled example does not validate this file. Report when browser
   inspection was unavailable. See [opening.md](references/opening.md).
6. **Keep the latest revision.** Use `scripts/session_state.py save` with the graph and
   available analysis, timeline and quality report. Skip only for a throwaway conversion.
   State is project-scoped by default; retain the reported state directory.
7. **Deliver.** Return the complete JSON, a link to [TraceVista](https://tracevista.pages.dev/),
   and whether this file was imported and checked in the browser. If import remains manual,
   say to click **Import trajectory** and choose the supplied file. Add a preview screenshot when
   captured and a short account of changes or evidence gaps.

Use absolute script and input paths in actual calls. Resolve `scripts/` relative to this
skill's directory, not the working directory. Keep generated work under an ignored `.work/`
directory or a temporary directory. Do not rerun the underlying experiment for conversion.

## Generate and open a file

```sh
# For an existing complete export:
python3 /absolute/skill/scripts/validate_trace.py /absolute/task.agent-state.json \
  --require-reading-layer --quality-report /absolute/work/reading-quality.json
```

Then import `/absolute/task.agent-state.json` at `https://tracevista.pages.dev/` and inspect
the loaded graph. The import is held in that browser tab; the homepage address does not
identify a saved trajectory. Keep the JSON for reopening or revision.

Use `create_view.py` only when a local preview is explicitly requested. Its loopback URL
and process lifetime are described in [opening.md](references/opening.md#optional-local-preview).

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
5. Validate the new file, import that revision into TraceVista, inspect the affected view and save a
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
- [opening.md](references/opening.md): cloud import, browser verification and optional local preview.
- [legacy-canvas.md](references/legacy-canvas.md): only for an explicit stock ThoughtDAG canvas request.

The skill was formerly named `trajectory-to-thoughtdag`. Renaming it does not change the
`.agent-state.json` v1 contract or existing IDs. Legacy canvas export remains available.

Keep generated files private (600; new directories 700). Extraction redacts patterns;
repeatable `--secret-file` can match known local values without printing them. Keep raw logs
and ordinary exports out of source control. Viewer chat is a separate, user-triggered action.
Run skill tests after script changes and repository tests/build after viewer changes.
