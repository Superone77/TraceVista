# The canvas file build_canvas.py writes

For maintainers, or when an import fails. Checked against ThoughtDAG 0.5.x
(`src/lib/export.ts`, `src/types.ts`, `src/lib/example-graph.ts`).

A backup is `{version: 1, name, exportedAt, nodes: [...], edges: [...]}`. The importer
(`importProjectFromFile`) needs `nodes` and `edges` arrays and every node to have a string `id`,
a numeric `position.{x,y}` and a `data` object; it then stores the canvas as a new project.

Nodes are React Flow nodes of `type: "thought"`:

- Q&A card: `data.question`, `data.response`, `responses: [response]`, `responseIndex: 0`, plus the
  flags every node carries (`isCollapsed`, `isEditing`, `isEditingResponse`, `isLoading`,
  `highlights`, `highlightMode`, `attachments`, `excludedAttachmentIds`, `includedAttachmentIds`,
  `roleMode`, `isRoot`, `isBranch`, `tokenCount`).
- Zoomed-out plaque: `data.summaries[0]` (takeaway), `data.summaryTopics[0]` (≤ 6 CJK / 14 Latin
  characters) and `data.summaryTypes[0]` - one of `decision`, `pivot`, `ruleout`, `open`, or null
  for a plain insight.
- Note (canvas material): `data.stepKind: "note"`, text in `data.question`, empty response
  (`responses: []`, `responseIndex: -1`). It only feeds what it is wired to.
- Frame (a labelled region): `data.stepKind: "frame"`, title in `data.question`,
  `data.frameColor` (gray, violet, amber, green, sky, rose), node `width`/`height`, `zIndex: -1`.
  A node belongs to a frame when its centre lies inside it.
- Attachment: `{id, name, type: "text/plain", size, content}` in `data.attachments`.

Edges are `type: "smoothstep"`:

- continue: `sourceHandle: "continue"` → `targetHandle: "top"`, purple `#6B5CE7`
- branch: `sourceHandle: "branch"` → `targetHandle: "left"`, orange `#E08A3C`, animated,
  `data.isBranchFromSelection: true`
- reference (from a note, or to an earlier step): `branch` → `left`, purple dashed
  (`strokeDasharray: "8 4"`), `data.isCrossLink: true`

ThoughtDAG's layout rule is that wires show context flow and one chain stays in one column; the
builder places the main line in lane 0, each branch in a new lane to the right, notes left of the
card they inform, and phases as vertical bands so frames never overlap.

## Trace extensions

- `data.traceExport` stores `actor`, `category`, `layer` (`analysis` or `events`),
  cited event IDs or original event provenance. It does not claim to reconstruct the
  provider's hidden context.
- Node `style.boxShadow` provides category colors; the renderer type remains `thought`.
  Review cards additionally use `stepKind: review`, `isEvaluator: true`, and
  `evaluatorTrigger: manual`. All generated nodes use `autoRerun: false`.
- Observation notes have outgoing evidence wires only. Tool records in the complete
  event layer use ordinary cards so incoming sequence wires remain visible.
- `summaryTypes` retains the epistemic meaning (decision, pivot, ruleout, open),
  independently of main/tool/review categories. The static preview shows category
  borders and epistemic stripes separately.
- The root has an excluded-from-context `complete-timeline.json` attachment, including
  full redacted source logs, normalized events, session statistics and explicit links.
  Large event text is not truncated. This attachment can make the canvas large.
