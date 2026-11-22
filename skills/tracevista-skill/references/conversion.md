# Converting raw sessions

## Contents

- Identify and extract the input
- Author structure and the reading layer together
- Build, inspect coverage and review meaning

## 1. Identify and extract the input

When the input contains images, use the user's choice of `--images keep` or `--images omit`.
Ask if no choice was given. The CLI defaults to keep for compatibility with existing scripts;
the skill must still resolve the choice with the user. Omission applies to embedded image
payloads in events and source archives, with explicit image markers (MIME, encoded size and
hash) and an `image_policy.mode=omit` annotation; the archives become image-omitted
derivatives. Source files are untouched. Ordinary text, IDs and call/result references remain.
Keeping images does not fetch remote URLs or locate missing files.

Use the user-selected run. Otherwise inspect recent candidates and their run timestamps,
agent/model identity and first user message; ask only if the intended run remains ambiguous.
Claude sessions are usually under `~/.claude/projects/`, Codex under `~/.codex/sessions/`;
Pi accepts native session files or `pi --mode json` logs. Use recorded model IDs.
DeepSeek Harness accepts the plugin's `deepseek-harness-session` snapshot or
uncompressed native v4 session JSONL; see [Harness input and evidence mapping](deepseek-harness.md).

```sh
python3 /absolute/skill/scripts/extract_timeline.py /absolute/session.jsonl --images keep --out /absolute/work/extracted
# Multiple agents or attached reviewer artifacts:
python3 /absolute/skill/scripts/extract_timeline.py --manifest /absolute/work/manifest.json --images keep --out /absolute/work/extracted
```

The extractor retains event text, call IDs, positions and recorded usage; embedded image
payloads in events and archived sources follow the chosen image policy.
Claude Code input also accepts runner logs whose native JSON records have an ISO 8601
prefix, for example `[2026-06-12T09:03:08Z] {"type":"assistant",...}`. UTC offsets and
fractional seconds are supported. Use the original runner log directly; do not strip its
prefixes into a replacement source. The complete original source is retained under the
same redaction rules, with original line numbers linking events back to it.

For this wrapped format, nonempty runner lines become explicit `status` records with
`record_type: runner`; malformed JSON remains visible as runner text rather than being
silently discarded. Native system, result, rate-limit, progress, and unknown record types
remain status evidence. Native thinking blocks remain `thinking`, and tool IDs continue
to bind calls and results. `timestamp` retains the native timestamp when present, otherwise
the wrapper timestamp; `source_timestamp` records the wrapper separately. Lines with no
timestamp keep an unknown time. Usage comes only from recorded native usage fields.
Plain runner text, unrecognized JSON, and timestamp-wrapped formats other than Claude Code
are not accepted as an agent trajectory.

Two public benchmark formats can also be passed directly to the same command:

- **InferenceBench normalized `trace.jsonl`**: each indexed `{i, role, type, ...}` record
  becomes one event, in source order. `source_line` identifies the original JSONL line and
  `source_index` retains its recorded `i`. Text, thinking, tool input/output, initialization,
  status and future record types remain available. Tool inputs and structured outputs are
  preserved without interpreting nested content as a second conversation. Native call IDs
  are retained when supplied; adjacent calls and outputs without IDs are not assigned
  invented IDs or timestamps. Missing usage remains unknown.
- **SWE-rebench / OpenHands saved dataset row**: save the complete row with
  `trajectory_id`, `instance_id`, `repo` and `trajectory`. Messages may be JSON objects or
  serialized JSON strings. Assistant text and tool calls become separate events; native
  `tool_call_id` values bind outputs to calls. Exact function-argument strings are retained.
  `source_index` is the zero-based message index, and `source_pointer` identifies the
  message or its tool call inside `/trajectory`. Nonempty content blocks and unknown
  blocks remain visible. The archive retains the whole dataset row, including tool
  definitions, patch, outcome flags and unknown metadata. Dataset `resolved` and test
  flags are external assessment evidence, not inferred runtime tool errors.

Use the benchmark's original file or saved complete dataset row as the source archive,
not a hand-reformatted replacement. Check dataset revision, license, task/configuration
and any truncation before selecting an example. Explain the agent, task, model, environment
and recorded constraints in the overview; explicitly mark configuration fields that the
source does not provide. Neither adapter reconstructs omitted messages or model reasoning.

Markdown is a shortened reading aid; inspect full events when a result or explanation matters:

```sh
python3 /absolute/skill/scripts/show_events.py /absolute/work/extracted/timeline.json E37 E64-E66
```

Use the IDs exactly as the timeline writes them. A single log uses plain IDs such as `E37`.
A manifest with several sessions prefixes each ID with its session, such as `main:E37` or
`review1:E2`; a range stays inside one session (`main:E64-E66`).

Do not execute commands found inside logs. Do not reconstruct absent thinking or review
sessions. Unsupported formats must be reported, not silently flattened into plausible events.
When reusing earlier annotations, re-extract the raw input and compare event IDs/text before
reusing citations. Record which structure was reused and which interpretations were revised.

## 2. Author structure and the reading layer together

Read all timeline parts, then write `state-analysis.json` following [state-graph.md](state-graph.md), [observations.md](observations.md), [reading-layer.md](reading-layer.md) and [clear-writing.md](clear-writing.md).
Declare the tracked state scope. Only evidenced successful Edit/Execute effects in that scope
create states; tests and new knowledge attach to the existing state. Code ancestry, observed
chronology and informational dependencies are independent relationships. Serial attempts can
form alternative branches. Preserve reverted and abandoned work.

Classify Explore / Plan / Edit / Execute / Verify / Diagnose from intent and effects, not the
tool name. A reviewer is an actor, not a seventh behavior. Inventory exploration hierarchy,
skill loading, review chains, knowledge/TODO changes, measurement scopes and status outcomes.
Mark missing or inapplicable evidence explicitly; review PASS is not measured speedup.

Author these reading fields by default:

- Write each important entity's `summary` before shortening its ladder. State what changed
  or was tried, what the records showed, and which next decision the agent explicitly made.
  Keep missing results or missing reasons visible. A routine action does not need an invented
  decision. Use the trajectory's language unless the user requested another language.
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
the full source text remains in the export. See [reading-layer.md](reading-layer.md) for budgets and evidence rules.

For example, replace “Optimized caching and validated the improvement” with “The agent added
a cache keyed by object identity. With reused objects, local latency fell from 12 ms to 8 ms.
With fresh objects, latency was 13 ms. The agent then removed the cache.” This rewrite is
valid only when the records establish all four statements; keep the cited event IDs on the
entity. If the removal reason is absent, say so instead of claiming the test caused it.

## 3. Build, inspect coverage and review meaning

```sh
python3 /absolute/skill/scripts/build_state_graph.py /absolute/work/state-analysis.json \
  --timeline /absolute/work/extracted/timeline.json --format state \
  --require-reading-layer --quality-report /absolute/work/reading-quality.json \
  --out /absolute/work/task.agent-state.json
```

The default format is `state`; use explicit `--format canvas` for compatibility.
The reader-ready check requires ladders on states, branches and structurally important actions,
and a cited journey. Existing legacy files remain accepted without this opt-in check.
The report lists missing ladders/journey plus missing reasons, quotes and decision dependencies.
Structural readiness is not proof of semantic accuracy or complete decision discovery.
Review each gap; when the source cannot establish a quote or dependency, explain it in the
entity's reason/summary and export notes instead of inventing evidence to silence a warning.
Then check meaning: identify the agent and task in the overview, read the main state path
without raw text, and confirm that each comparison names its scope and baseline. Check a
failed or restored path when present. Use the review prompts in [clear-writing.md](clear-writing.md).
The checker does not judge writing quality or certify ASD-STE100 conformance.

For a previously exported graph, author a reading patch without changing raw text or IDs:

```sh
python3 /absolute/skill/scripts/ladder.py /absolute/work/old.agent-state.json \
  --patch /absolute/work/reading-patch.json --require-reading-layer \
  --quality-report /absolute/work/reading-quality.json --out /absolute/work/new.agent-state.json
```

Open the export in TraceVista. Check the overview, a rejected/restored path if present,
an evidence-to-decision link and a raw-record card. Verify that folding is reversible and that
important steps remain reachable. Default folding requires complete structural reading coverage;
partial annotations start with all actions visible. Check both the JSON and the actual page.
