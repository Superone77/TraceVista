# State-first trajectory export

Use when the reader wants **state changes first**, expandable exploration branches second,
and concrete Explore / Plan / Edit / Execute / Verify / Diagnose actions third.
Actor (for example `main`, `reviewer`, `system`, or a provider-neutral participant ID) is an independent dimension. Review is a role, not a
seventh behavior; for example, a reviewer can Explore, Verify, or Diagnose.

## What counts as a state

Declare the tracked scope before annotating. A useful default is the target implementation,
candidate artifacts, and submission/deployment state. Harness edits and reports can remain
actions without introducing a new state **in this scope**. If the user wants environment,
database, or harness state, add those components to snapshots and collect corresponding evidence.
This is a scoped model, not a complete machine snapshot.

Only a successful **Edit or Execute with an observed effect in that scope** may create a
transition. Exit code 0 alone is insufficient: reads, tests, no-op writes, and successful
review calls do not imply a changed implementation. A failed batch can still have partial
effects; represent a separately evidenced successful sub-action, or leave the effect unknown.
Use actual hashes/diffs/artifacts/results. Do not invent before/after snapshots. Keep
verification and newly learned facts attached to the state without conflating them with mutation.

Classify intent from command arguments, results, surrounding messages, and artifact changes.
Do not classify every shell invocation as Execute. One conceptual action can cite several
events. A mixed batch gets a primary behavior and `secondary` behaviors, or separate supported
sub-actions citing the same record. State that labels are analyst interpretations.

| Behavior | Evidence of intent |
|---|---|
| Explore | Read/search existing code, environment or documentation |
| Plan | Select or describe what to try next |
| Edit | Change code, configuration or a document |
| Execute | Run workload, build, submission or other actual operation |
| Verify | Check against a contract, test, benchmark or review criterion |
| Diagnose | Explain a failure, unexpected result or bottleneck |

Branches group intentions under their starting state; they do not imply parallel execution.
Mark alternatives `proposed` or `rejected` when merely considered, with `outcome: proposed` on
their Plan actions. Never turn an untried suggestion into an execution path.
Use `sequence` for observed order; `informs` for an evidenced informational dependency;
`review_request` / `review_return` for invocation-linked reviewer handoffs. These are separate
from state-transition edges. Preserve source IDs and do not invent private reasoning.

## Authoring contract

Write `state-analysis.json` with:

- `title`, `scope`, optional `subtitle`, `notes`.
- `states[]`: `id`, `title`, `summary`, `events`, `snapshot` (component → value or null).
- `branches[]`: `id`, `state`, `title`, `summary`, `events`, `status`
  (`attempted`, `retained`, `proposed`, `rejected`).
- `actions[]`: `id`, `state`, `branch`, `title`, `summary`, `events`, `actor`, `behavior`,
  optional `secondary`, `outcome`, `classification_reason`.
  `outcome: success` must refer to the action's actual effect, not blanket success of a
  compound shell batch. Other labels may be observed, unknown, failure, proposed or a review verdict.
- `transitions[]`: `source` state, `target` state, `action`, `label`, `changes[]`.
  Each change has `component`, `before`, `after`, `basis`, `events`.
  List every difference between the two tracked snapshots, no extras.
- `links[]`: `source` action, `target` action, `kind`, `evidence` explanation, `events`.
- `excluded[]`: `events`, `reason` for records without a behavior interpretation
  (input text, runner notifications, empty blocks). They remain in the full source archive.
- Optional `artifacts[]`: `name`, `path`, `sha256`, full redacted `text` of retained snapshots.

Every meaningful event needs classification or an explicit exclusion reason. Evidence accepts
the same session-prefixed IDs/ranges as the existing analysis schema. Node IDs are globally
unique. Temporal state occurrences form a DAG; a revert is a new occurrence that can share
an earlier content hash, not an edge backwards in time.

```bash
python3 /path/to/skill/scripts/build_state_graph.py state-analysis.json \
  --timeline extracted/timeline.json --format state --out task.agent-state.json
```

The recommended file is a standalone `format: coding-agent-state-trajectory`, `version: 1`
graph with the complete redacted timeline and sources. Import it directly in the local viewer.
The default format is `state`. Use explicit `--format canvas` to get a v1
ThoughtDAG backup, whose first state's `data.stateTrajectory` holds the same graph.
No records are deleted on collapse. Privacy/redaction rules still apply.
Files from the skill's earlier name, `trajectory-to-thoughtdag`, use the same v1 contract and IDs.

Optional `states[].lineage` records `{parent, relation, reason, events}` where relation is
`derived`, `restored` or `retained`. Chronological `transitions` remain unchanged. A rollback
can be followed by new edits: that is `derived` from the restored source, not an identical
snapshot restoration. Do not infer ancestry from a worse score alone.

Optional `states[].assessment` supplies `metric`, finite `value`, optional `previous` and
`previousState`, `higherIsBetter`, required nonnegative `tolerance` (use `0` for no tolerance),
optional `correctness`, `measurement` (`measured` or `historical`) and `note`. The comparison
fields are named `previous` and `previousState`, not `comparisonValue` or `comparisonState`. Compare only
matching measurement scopes and protocols. Historical final selection is not a fresh result.
`correctness` is an optional boolean for an explicitly observed correctness check. Omit it
when only a task score or accuracy measurement is available. A successful evaluator call
does not establish correctness, and an accuracy below 100% is not a failed correctness gate.
Executed alternatives that are later abandoned remain branch `status: attempted` and use an
exploration observation with `disposition: rejected`; branch `rejected` means untried.

## Reading-layer authoring

For a new viewer export, include `ladder` on every state/branch and important action,
`move` on evidenced turns, `informs` links and a cited graph-level `journey`. Follow
[reading-layer.md](reading-layer.md). Use `--require-reading-layer --quality-report report.json`
to check structural coverage; inspect its evidence gaps before delivery. Existing files
without the extension remain valid and start with all actions visible.

## Reader support

Stock ThoughtDAG at inspected commit `f1afae2688291079dd743a49a40ff6cfd0de137e` only folds a
node's text. Its frame is spatial decoration, not an expandable subgraph. **The interactive
state/branch view requires the local modified reader**, at `index.html` / `trajectory.html` in this repository’s `viewer/` directory. Do not promise that stock ThoughtDAG provides it.

The reader accepts the canvas backup above or its extracted `stateTrajectory` object.
Default: state nodes only. Expand a state for branches, expand a branch for actions.
When endpoints are collapsed, relevant cross-links aggregate onto visible ancestors;
when opened, links return to the exact action endpoints. Full raw evidence remains searchable.
Importing and rendering are local. Optional chat sends selected context only when the user invokes it. Ordinary real logs belong in ignored local-data. Explicitly approved examples are bundled separately under examples; publish only examples the user has authorized for that destination.

## Exploration, review and measurement observations

Use [observations.md](observations.md) for the optional generic observation layer. This
separates work steps, hypotheses and parameter trials; skill loading modes; review loops;
knowledge/TODO lifecycles; measurement scopes and independent status conclusions. The local
reader supports typed badges, per-node/global filtering, relation navigation and raw evidence.
