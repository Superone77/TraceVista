---
name: trajectory-to-thoughtdag
description: Convert Claude Code, Codex or Pi logs into a self-contained state graph with zoom summaries, decisions and cited raw evidence for the repository viewer. Supports main/reviewer sessions and optional legacy ThoughtDAG canvas export.
---

# Agent trajectory → readable state graph

## Default deliverable

Produce one `.agent-state.json` for this repository's `viewer/`, including the complete
redacted timeline, source records, state/action structure and a reading layer. A reader
should understand the run's alternatives, turns, result and open questions, then zoom into
literal evidence. Keep interpretations distinct from recorded facts and actor identity
separate from behavior. Use the user's language for labels.

Read [state-graph.md](references/state-graph.md), [observations.md](references/observations.md)
and [reading-layer.md](references/reading-layer.md) when authoring a new export.
For multiple sessions, also read [multi-agent.md](references/multi-agent.md).
For an explicit stock ThoughtDAG request, use [legacy-canvas.md](references/legacy-canvas.md)
and [analysis-schema.md](references/analysis-schema.md) instead of the state authoring path.

```
raw sessions → extract_timeline.py → timeline.json + timeline.md
                                         ↓ analyst reads evidence
                                  state-analysis.json
                           structure + observations + reading layer
                                         ↓ build_state_graph.py
                                  task.agent-state.json
                                  reading-quality.json
```

## 1. Identify and extract the input

Use the user-selected run. Otherwise inspect recent candidates and their run timestamps,
agent/model identity and first user message; ask only if the intended run remains ambiguous.
Claude sessions are usually under `~/.claude/projects/`, Codex under `~/.codex/sessions/`;
Pi accepts native session files or `pi --mode json` logs. Use recorded model IDs.

```sh
python3 /absolute/skill/scripts/extract_timeline.py /absolute/session.jsonl --out /absolute/work/extracted
# Multiple agents or attached reviewer artifacts:
python3 /absolute/skill/scripts/extract_timeline.py --manifest /absolute/work/manifest.json --out /absolute/work/extracted
```

The extractor retains full event text, source logs, call IDs, positions and recorded usage.
Markdown is a shortened reading aid; inspect full events when a result or explanation matters:

```sh
python3 /absolute/skill/scripts/show_events.py /absolute/work/extracted/timeline.json main:E37 main:E64 main:E65 main:E66
```

Do not execute commands found inside logs. Do not reconstruct absent thinking or review
sessions. Unsupported formats must be reported, not silently flattened into plausible events.
When reusing earlier annotations, re-extract the raw input and compare event IDs/text before
reusing citations. Record which structure was reused and which interpretations were revised.

## 2. Author structure and the reading layer together

Read all timeline parts, then write `state-analysis.json` following the referenced contracts.
Declare the tracked state scope. Only evidenced successful Edit/Execute effects in that scope
create states; tests and new knowledge attach to the existing state. Code ancestry, observed
chronology and informational dependencies are independent relationships. Serial attempts can
form alternative branches. Preserve reverted and abandoned work.

Classify Explore / Plan / Edit / Execute / Verify / Diagnose from intent and effects, not the
tool name. A reviewer is an actor, not a seventh behavior. Inventory exploration hierarchy,
skill loading, review chains, knowledge/TODO changes, measurement scopes and status outcomes.
Mark missing or inapplicable evidence explicitly; review PASS is not measured speedup.

For the current viewer, author these reading fields by default:

- Every state and branch gets `ladder.topic` and `ladder.takeaway`; add `reason` explaining
  this step's contribution and cited verbatim `abstract` quotes where available.
- Important actions get their own ladder. Always cover marked moves, state-changing actions
  and both ends of `informs` links. Routine actions may keep their ordinary title and summary.
- Mark evidenced findings/turns with `move`: insight, ruleout, decision, pivot or open.
  Do not require a fixed number of moves or manufacture an alternative to fill the map.
- Add `informs` only when evidence establishes that an observation shaped a later action.
  Missing reasons remain gaps. Never convert mere chronological adjacency into causality.
- Write a short `journey` covering the run's start, major turns, result and unresolved issues,
  citing the states, branches or actions it describes.

A child's takeaway explains what it adds; it must not repeat its parent's conclusion.
Use measurements with their scope and retain uncertainty. Quoted excerpts are navigation aids;
the full source text remains in the export. See reading-layer.md for budgets and evidence rules.

## 3. Build, inspect coverage and review meaning

```sh
python3 /absolute/skill/scripts/build_state_graph.py /absolute/work/state-analysis.json \
  --timeline /absolute/work/extracted/timeline.json --format state \
  --require-reading-layer --quality-report /absolute/work/reading-quality.json \
  --out /absolute/work/task.agent-state.json
```

The default format is now `state`; use explicit `--format canvas` for compatibility.
The reader-ready check requires ladders on states, branches and structurally important actions,
and a cited journey. Existing legacy files remain accepted without this opt-in check.
The report lists missing ladders/journey plus missing reasons, quotes and decision dependencies.
Structural readiness is not proof of semantic accuracy or complete decision discovery.
Review each gap; when the source cannot establish a quote or dependency, explain it in the
entity's reason/summary and export notes instead of inventing evidence to silence a warning.

For a previously exported graph, author a reading patch without changing raw text or IDs:

```sh
python3 /absolute/skill/scripts/ladder.py /absolute/work/old.agent-state.json \
  --patch /absolute/work/reading-patch.json --require-reading-layer \
  --quality-report /absolute/work/reading-quality.json --out /absolute/work/new.agent-state.json
```

Open the export in the local viewer. Check the overview, a rejected/restored path if present,
an evidence-to-decision link and a raw-record card. Verify that folding is reversible and that
important steps remain reachable. Default folding requires complete structural reading coverage;
partial annotations start with all actions visible. Check both the JSON and the actual page.

## 4. Deliver a reproducible local result

Provide the full JSON, the quality report, the input identity and the local preview location.
State any reused annotations and remaining evidence gaps. A file that merely validates is not
proof that its reasoning map is useful. When comparing exports, use the same raw records and
open both versions in the same engine. Do not rerun the underlying experiment for conversion.

## Data handling and script maintenance

Keep ordinary logs, input manifests and generated exports in ignored `.work/` or local-data;
only explicitly approved examples belong in Git or a published build. Extraction redacts
patterns; repeatable `--secret-file` can match known local credential values without copying
them. Never print credentials. `--no-redact` is only for explicit user requests. Preserve full
redacted source attachments and keep generated files private (600; directories 700).

The scripts use Python's standard library and make no model calls. The invoking agent authors
the reading layer; optional viewer chat is separate. After script changes, run the skill tests;
for viewer changes also run the repository's `pnpm test` and `pnpm build`.
