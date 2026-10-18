# analysis.json

## Contents

- Fields
- Kinds
- Branches: turning a linear log into a tree
- Granularity
- Actor identity and full-record layer

The one file you write. `scripts/build_canvas.py` turns it into the canvas and rejects it with a
list of problems when it does not fit. The example below is invented (a flaky-test fix) to show the
shape; take every name and number in your file from the trajectory you are reading.

```json
{
  "title": "Fixing a flaky checkout test — Codex, 38 min",
  "language": "en",
  "outcome": "Race in the retry queue fixed; 200/200 runs green",
  "overview": "Markdown for the root card: the goal, how the session ended, the key numbers, and the 2-4 turning points a reader should look at first.",
  "phases": [
    {"id": "P1", "title": "Reproduce", "takeaway": "Fails 1 run in 12, only in parallel", "color": "violet"},
    {"id": "P2", "title": "Find the cause", "takeaway": "Two workers share one retry queue"},
    {"id": "P3", "title": "Fix and verify", "takeaway": "Per-worker queue, 200/200 green"}
  ],
  "steps": [
    {"id": "S1", "phase": "P1", "kind": "observation", "title": "Fails only with -n 4",
     "takeaway": "1/12 failures, never serial", "body": "Ran the test 12 times each way ...",
     "t0": 1.0, "t1": 4.2, "events": ["E5-E19"], "informs": ["S2"]},
    {"id": "S2", "phase": "P1", "kind": "decision", "title": "Suspect shared state",
     "takeaway": "Look for state shared across workers, not timing", "t0": 4.2, "events": ["E20"]},
    {"id": "S3", "phase": "P2", "kind": "dead_end", "title": "Raise timeouts",
     "takeaway": "Still fails 1/10: not a timeout", "t0": 5.0, "t1": 9.5, "events": ["E21-E33"],
     "after": "S2", "branch": true},
    {"id": "S4", "phase": "P2", "kind": "observation", "title": "Queue is a module global",
     "takeaway": "Both workers push to the same list", "t0": 10.1, "events": ["E36"], "informs": ["S5"]},
    {"id": "S5", "phase": "P2", "kind": "pivot", "title": "Isolate the queue",
     "takeaway": "Make the retry queue per worker", "t0": 10.4, "events": ["E37"], "after": "S2"},
    {"id": "S6", "phase": "P3", "kind": "result", "title": "200 runs green",
     "takeaway": "0/200 failures with -n 4", "t0": 31.0, "t1": 37.5, "events": ["E80-E96"], "after": "S5",
     "analyst": "The agent never ran the full suite, only this test."}
  ]
}
```

## Fields

| field | meaning |
|---|---|
| `title`, `outcome`, `overview` | the root card: `title` is its heading, `outcome` its one-line zoomed-out plaque, `overview` its markdown body |
| `language` | `zh` or `en`: the language of badges on the canvas; write every text field in the same language |
| `phases[]` | 3-8 stretches of the session with one purpose each. Each becomes a coloured frame; zoomed out, the frames are what a reader sees first. Give every phase at least one step that is not an observation (a phase of notes alone has no frame). A pivot opens the phase it starts, so put it at the start of the new phase. `color` is optional: violet, sky, green, amber, rose, gray |
| `steps[].id` | `S1`, `S2`, ... unique |
| `steps[].phase` | the phase it belongs to. Steps are laid out phase by phase, in time order inside a phase |
| `steps[].kind` | `observation` · `decision` · `pivot` · `action` · `result` · `dead_end` · `open` (see below) |
| `steps[].title` | what happened, short enough to read at a glance: about 14 CJK characters, 40 Latin, in between for mixed text ("Fuse, don't tune", not "Strategy") |
| `steps[].topic` | optional: the label for the most zoomed-out plaque, ≤ 6 CJK / 14 Latin characters; derived from the title when missing |
| `steps[].takeaway` | one line, the conclusion of the step; it is the plaque shown when zoomed out |
| `steps[].body` | markdown, a few sentences: what the agent did or saw, the numbers, why it mattered |
| `steps[].analyst` | optional: your own remark that the trajectory does not state (a missed check, an untested claim). Shown apart from the body, labelled as the analyst's note |
| `steps[].t0`, `t1` | minutes from the start, from the timeline. Omit `t1` for a step that happens at one moment; omit both when the timeline has no timestamps |
| `steps[].events` | the timeline events it rests on: `"E12"` or ranges `"E12-E30"`. They are attached raw to the card, so cite what a doubting reader would want to check |
| `steps[].after` | the step it continues from: its structural parent. Omitted or `null` hangs it under the root |
| `steps[].branch` | `true` when this step starts an alternative line off `after` (see below) |
| `steps[].informs` | observations only: the steps this observation led to. It becomes a note wired to them |
| `steps[].refs` | optional: earlier steps this one explicitly reuses or returns to (dashed reference wire) |

## Kinds

| kind | use it for | on the canvas |
|---|---|---|
| `observation` | something the agent *saw*: a measurement, an error, a profile, a file's content, test output | a note beside the step it led to, dashed wire into it |
| `decision` | a choice between options, made because of what was seen | card with a decision plaque |
| `pivot` | a decision that abandons the current direction for a different one | card with a pivot plaque |
| `action` | carrying out a decision: writing code, running a sweep | plain card |
| `result` | the outcome of an action when it is worth its own card (a score, a pass/fail) | plain card |
| `dead_end` | a line that was tried and given up, or that made things worse | card with a ruled-out plaque; nothing continues from it |
| `open` | a question left unresolved at the end | card with an open plaque |

Observations need no `after`: they are not on the line, they feed into it. Each is drawn beside the
step it informs when that step is in the same phase, and otherwise at the end of its own phase
with a wire down into the later step, so every phase frame keeps its own observations. An
observation with an empty `informs` is drawn as an ordinary card on the line.

**Observation or result?** A score or a test outcome is an `observation` when it is what the agent
reacted to (it changed the next step), and a `result` when it only marks where a line got to.
When it is both, make it the observation and put the number in the preceding card's takeaway too.

## Branches: turning a linear log into a tree

A trajectory is written in time order, but the work inside it forks. Rebuild the forks:

- When the agent tries A, gives it up and then does B, both A and B continue from the point where
  the choice was made. Give A `"after": "<decision>", "branch": true` (it ends as a `dead_end`
  or with an abandoned action) and give B `"after": "<decision>"`. The main line goes down the
  column; the abandoned alternative hangs to the right and visibly stops.
- **Sweeps and A/B rounds.** When the agent tries several variants one after the other and keeps
  at most one, draw each variant that was measured as its own short `dead_end` branch off the
  step that started the sweep, with its number in the takeaway, and let the kept variant (or the
  unchanged line) continue down. Give the whole sweep one observation note, the result that
  closed it, rather than one note per variant. Variants that taught nothing distinct can share a
  card ("BLOCK_N 32/128: both slower").
- Put `branch: true` only where a real alternative was taken. A step that simply follows the
  previous one continues the line.
- A later step that goes back to an earlier idea keeps its real parent and adds that idea to
  `refs`.
- **A failed attempt that shaped the next choice.** Nothing continues from a `dead_end`, but its
  result often drives what comes next. Record that result as an observation that `informs` the
  next decision (its note sits beside the decision), and give the decision `refs` to the dead end
  so the wire back is visible.
- **Kept but no better.** A change the agent kept whose effect stayed inside noise is a `result`
  with that in its takeaway ("kept, +0.3%, inside noise"). Use `dead_end` for what was reverted,
  abandoned or made things worse.
- **Open questions** hang off the step they arose from (`after`), with `branch: true` when that
  step already continues. Do not chain unrelated open questions one after another.
- An observation that `informs` several steps is drawn once, beside the earliest of them, with a
  wire into each.

## Granularity

- One step is one intention: several tool calls that serve the same purpose are one step.
  Around 12-40 steps is typical for an hour of agent work; 60 is a lot.
- Every decision or pivot should have the observation behind it. When the agent decided without
  looking, say so in the body ("decided without measuring").
- Keep notes short: the title, the takeaway and one or two sentences; the raw evidence is attached.
  When several observations lead to one step they share one note, so keep that to three or fewer.

## Actor identity and full-record layer

Optional `steps[].actor` is `main` (default), `reviewer`, or `system`.
Optional `steps[].category` is `agent`, `tool`, `review`, `thinking`, `input`, or `status`.
The default category is `review` for reviewer steps and `agent` otherwise. These drive
colored borders and actor labels independently of `kind` / the epistemic plaque.
Use `actor=reviewer, category=tool` for a reviewer's tool use. Use `category=tool` for
observations derived from command output. Keep different actors in separate steps
when attribution would otherwise be ambiguous. Unchanged older analyses remain valid.

Every step needs nonempty `events`; all referenced IDs must exist. Session manifests
namespace IDs: `main:E12`, `review1:E2`, ranges `main:E12-E15` or
`main:E12-main:E15`. A range cannot span sessions. Single-log IDs remain `E12`.
Missing IDs, bad ranges and references to future structural parents fail validation.

For multi-session analyses, elapsed minutes are relative to each individual session.
Do not sort different sessions by these relative times. Omit `t0`/`t1` on combined
steps unless a common time origin was independently established; order steps by
recorded request/return dependencies. Put original session times in the body if useful.

The overview is analysis. Each substantive statement should identify its supporting
steps/events in its text; code validation checks step event references, not factual
correctness or causal interpretations.

`--with-event-graph` adds complete main/reviewer timelines in separate columns next to
the analysis frames. Raw calls and results have their own nodes and recorded call IDs.
Cross-session request/return wires come only from manifest `links`, never model names,
file modification times or similar wording. No link means unknown placement, not an
inferred dependency. The root's complete-timeline attachment includes every source log,
even transport metadata not projected into event nodes.
