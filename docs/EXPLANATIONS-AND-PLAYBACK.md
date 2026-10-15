# Reading, linked explanations, and playback

## Conversion

`tracevista-skill` uses [clear-writing.md](../skills/tracevista-skill/references/clear-writing.md)
for authored explanations. Write the full `summary` before deriving the shorter ladder.
Keep comparisons, conditions, uncertainty, and evidence IDs with the claims they support.
`ladder.py` can revise a summary in an existing export without extracting the source again.
Expanded Story sentences show that full explanation; the compact map keeps the short ladder.

## Chat

The answering prompt prefers a flow for decisions and branching attempts, and a table for
comparisons. Simple questions can receive a short text answer. Smart context still selects
raw records first; the selection round receives no diagram instructions.

The model returns one or two `tracevista` fenced JSON blocks. `explanations.ts` defines and
validates the format. Each node, edge, or row has a `basis` (`observed`, `inferred`, or
`unknown`) and `refs` containing source IDs. Flow edges describe explicit relationships;
adjacent cards do not imply a causal link. The React renderer supports branching flows and
scrollable tables. Titles and evidence buttons use the same Story/Map navigation as text
citations. Unresolved IDs are shown without navigation. Invalid or interrupted blocks keep
their original text, and complete answer text remains in exported Chat history.
Markdown headings (`#` through `######`) render at chat-sized heading levels. References
inside headings remain clickable. Heading syntax inside code fences stays literal.

Flow limits: 2–8 nodes, at most 12 edges, no cycles. Table limits: 2–6 columns, 1–12 rows.
These limits keep explanations readable inside Chat. A graph with a rollback can describe
the restoration as a later step that references the earlier version.

## Play

**Play** starts at the system-state level. The **Playback depth** selector can include work
phases, all actions, or raw records. Raw depth stops once per action and opens its complete
original records together, including tool calls and their results. Phase order matches the numbering in Story and Map.
Rejected branches and proposed ideas stay visible; a proposal remains labelled as such.
The sequence is a reading walkthrough of the export, not a replay of program execution
or a reconstruction of concurrent session timing.

The player offers pause/resume, previous/next, a position slider, and 4/8/15 seconds per step
(4 seconds by default). Changing depth pauses at the current node, or its closest visible
ancestor when that node is outside the new depth.
Source buttons open original records. Manual navigation and switching away from the tab
pause playback. Exit (or Escape outside Chat) restores the camera, selected node, Story
expansion and scroll position, Story visibility, state relationship mode, and folds from before playback. Playback
uses the current export locally and makes no model calls.

## Verification

`pnpm test` includes summary/source preservation, explanation parsing and React rendering,
Smart context selection/answer contracts, and playback order and control boundaries.
Run `pnpm build` after UI changes. Browser checks cover source-link navigation, narrow
layouts, automatic advance, evidence inspection, and exit restoration. Model-response tests
use fixed replies; they do not evaluate a provider's response quality.
