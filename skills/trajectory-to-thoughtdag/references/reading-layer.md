# Reading layer: zoom ladders, epistemic moves, informs links, journey (optional v1 extension)

The state graph says *what happened*. This layer says *what each step established and why
the agent turned*, at a length a reader can take in at every zoom. It is adapted from
ThoughtDAG's summary ladder (`src/lib/ladder.ts`, `ladder-context.ts`, `gedankengang.ts`).
Files without it stay valid; the viewer falls back to titles and summaries.

Everything here is analyst interpretation. Write it while reading the timeline, cite raw
events, and keep it apart from facts. The viewer never calls a model: it only renders.

## 1. Ladder on a state, branch or action

```json
"ladder": {
  "topic": "identity 缓存",
  "takeaway": "identity 缓存只在复用对象时更快，放弃",
  "reason": "fresh 和 rotating 对象下比提交 2 慢，评分退步 7.6% 来自这里",
  "abstract": [{"event": "main:E451", "quote": "verbatim sentence copied from that event"}]
}
```

Four nested levels a reader sees in turn while zooming in:

| level | budget (zh / en) | what it is |
|---|---|---|
| topic | 6 chars / 3 words | the subject, a bare noun phrase **copied verbatim from inside the takeaway** |
| takeaway | 28 chars / 14 words | what **this** step adds: the conclusion first, then its key qualifier |
| brief | takeaway + reason ≤ 80 chars / 40 words | `reason` reads on from the takeaway: the main reason, condition or consequence |
| abstract | 1-3 quotes | sentences copied **verbatim** from raw events this entity cites (or that its children cite) |

CJK characters and Latin words count one unit each (`CUDA Graph 缓存` = 4).

Write like this:

- **Say what this step adds to the thread, not what the parent already says.** Before writing,
  read the plaques of what came before (the state's takeaway, earlier branches, earlier actions
  in the same branch). An action's takeaway must not restate its branch's summary.
- **Name the thing itself**: the number found, the option chosen, the error seen
  ("raw stream: 6.33 → 0.23 µs"), not the activity ("measured cost", "ran a test").
- Reuse the terms of earlier plaques so a reader scanning down sees the thinking progress.
- No dash characters inside topic, takeaway or reason; use commas or colons.
- For the abstract, prefer the agent's visible messages (`note` events) and measurement or
  error lines from tool results: they show what it saw and said. Do not quote `thinking` events;
  hidden reasoning may inform your reading, but the map cites what the agent said and observed.
- Every ladder is optional. Give one to every state and branch, and to every action a reader
  would stop at. Routine actions may keep only their title.

## 2. Epistemic move

`"move"` on a state, branch or action marks a turn in the reasoning. Most actions have none.

| move | use it when the step | example |
|---|---|---|
| `insight` | established a fact that later steps use (a measurement, a diagnosis, what the code does) | profile shows host overhead dominates |
| `ruleout` | excluded an option: tried and abandoned, measured worse, reverted | CUDA Graph removed, end-to-end gain too small |
| `decision` | chose among options or committed (keep, submit, select the final candidate) | finalize selects commit 4 |
| `pivot` | gave up the current direction for a different one | return to v2 and redo specialization keys |
| `open` | left a question unresolved | never measured with rotating inputs |

Branches: `ruleout` for a direction that was tried and dropped, `decision` for the direction
that was taken, `pivot` when the branch itself is the turn, none for routine work (setup,
submission, audits). A routine branch is drawn compact.

Landmarks are `ruleout`, `decision`, `pivot` and `open`. The viewer's "只看决策" view keeps
landmarks, the observations that informed them, and state transitions; it folds runs of three
or more other actions.

## 3. informs links: observation → decision

Add a link `{"source": <observing action>, "target": <deciding action>, "kind": "informs",
"evidence": "...", "events": [...]}` when an action's result visibly changed what the agent
did next. The source is usually Diagnose, Verify or Explore with `move: insight`; the target
has a landmark move. Cite the event where the agent states the connection. Do not link mere
neighbours in time. A decision with no observation behind it is worth an `open` note in its
reason ("decided without measuring").

## 4. Journey

A graph-level paragraph, read first in the overview (adapted from ThoughtDAG's Gedankengang):

```json
"journey": {"text": "...", "cites": ["s1", "s3-compare", "s4"]}
```

Where the run started, what it ruled out, where it turned, where it landed, what remains open.
Only the turns that mattered. At most 260 CJK characters or 110 words. Cite every entity it
narrates.

## Validation

`build_state_graph.py` calls `scripts/ladder.py` and rejects: an unknown move, a topic not found
in its takeaway, a level over budget by more than 15%, an abstract quote that is not verbatim in
its event or that comes from outside the entity's evidence, an informs link backwards in time,
and a journey without citations. To check a patch against an existing export:

```bash
python3 scripts/ladder.py task.agent-state.json --patch reading-layer.json
```
