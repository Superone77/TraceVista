---
name: tracevista-skill
description: Create, inspect and revise coding-agent trajectory files for TraceVista. Convert Claude Code, Codex or Pi logs, InferenceBench traces and SWE-rebench rows, including main/reviewer sessions, into a self-contained .agent-state.json with system states, work stages, actions and cited raw evidence; validate it and open it in the TraceVista web viewer.
---

# TraceVista

Generate standard `.agent-state.json` files that open in [TraceVista](https://tracevista.pages.dev/).
The skill extracts evidence and authors the state map and reading layer; the viewer handles
zooming, navigation, details and optional chat. Its scripts require Python 3.10 or later,
use only the standard library and make no model calls.

## Core workflow

1. **Choose create or revise.** For new logs, identify the requested run and extract it.
   For “this trajectory”, “the last one” or a correction, follow the incremental workflow
   below. An existing export can be validated and opened directly without reconversion.
2. **Create the standard file.** For new logs, read [conversion.md](references/conversion.md)
   and its linked contracts. If images are present, ask whether to keep or omit them unless
   the user has already chosen; pass `--images keep` or `--images omit` to extraction.
   Extract the timeline using that choice, read the evidence, and author
   `state-analysis.json` using [clear-writing.md](references/clear-writing.md).
   Explain the operation, observed result and supported next decision, then run
   `build_state_graph.py --require-reading-layer`.
   The invoking agent writes the interpretation; the compiler checks it.
3. **Validate.** Run `scripts/validate_trace.py FILE --require-reading-layer
   --quality-report REPORT`. Review gaps in causes, quotes and decision dependencies;
   never invent evidence to satisfy the report. An older file may be opened without
   `--require-reading-layer`; describe its missing annotations if relevant.
4. **Open the current file.** Open `https://tracevista.pages.dev/` in the user's browser
   and use **Import trajectory** to select the complete JSON just generated. In a loaded viewer, this action is inside the top-left **Viewer menu** (☰). When browser tools
   support file selection, perform the import. Otherwise provide the file and these
   manual steps.
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

## Preview and save

Use `create_view.py` only when a local preview is explicitly requested; see
[opening.md](references/opening.md#optional-local-preview).

Save available artifacts (omit optional arguments when unavailable):

```sh
python3 /absolute/skill/scripts/session_state.py save \
  --graph /absolute/task.agent-state.json \
  --analysis /absolute/work/state-analysis.json \
  --timeline /absolute/work/extracted/timeline.json \
  --quality-report /absolute/work/reading-quality.json \
  --request "Convert this run for analysis"
```

Save creates a revision snapshot and returns its paths, so temporary inputs can be removed
without breaking later edits. State directory options are in
[opening.md](references/opening.md#continuing-an-edit).

## Incremental edits

1. Prefer the file the user names. Otherwise run `scripts/session_state.py show` in the
   same project or with the previous `--state-dir`. Check its identity and checksum.
   If no saved file exists, locate the user-selected input; do not silently switch runs.
2. Read the existing graph and cited records. For a reading-only edit, author a patch and
   use `ladder.py --patch PATCH --out NEW_FILE`; patches accept `summary`, `ladder` and
   `move` per entity. Use the same clear-writing rules when revising an existing export.
   For a structure correction, edit a copy
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

## Image choice

Ask once when the source contains images: **keep embedded images for visual inspection,
or omit image content for a smaller export?** Honor a choice already given in this task.
Do not silently remove images or include them after the user chose omission.

Use `extract_timeline.py --images keep|omit`; omission details are in
[conversion.md](references/conversion.md). For an existing export, use
`python3 scripts/image_policy.py FILE --images omit --out NEW_FILE`, then validate NEW_FILE.

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
- Use one idea per sentence and stable technical terms. Keep the trajectory's language unless
  the user requests another. Short card text points to full explanations in `summary`;
  retain comparison conditions, numbers and uncertainty. Raw text and quotes stay verbatim.

## References

- [conversion.md](references/conversion.md): extraction, structure authoring and compiler commands.
- [state-graph.md](references/state-graph.md): standard schema, effects and version relationships.
- [reading-layer.md](references/reading-layer.md): zoom text, turns, quotes and reading coverage.
- [clear-writing.md](references/clear-writing.md): ASD-STE100-inspired explanations, evidence boundaries and before/after examples.
- [observations.md](references/observations.md): skill usage, review, knowledge, TODOs and measurements.
- [multi-agent.md](references/multi-agent.md): manifests and request/return evidence across sessions.
- [opening.md](references/opening.md): cloud import, browser verification and optional local preview.
- [legacy-canvas.md](references/legacy-canvas.md): only for an explicit stock ThoughtDAG canvas request.

Keep generated files private (600; new directories 700). Extraction redacts patterns;
repeatable `--secret-file` can match known local values without printing them. Keep raw logs
and ordinary exports out of source control.
