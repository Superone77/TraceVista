# A task with a main agent and reviewers

## 1. Declare the inputs

Use a local manifest, with paths relative to the manifest itself (absolute paths also work):

```json
{
  "sessions": [
    {"id": "main", "actor": "main", "model": "recorded-main-model", "path": "main.jsonl"},
    {"id": "review1", "actor": "reviewer", "model": "recorded-review-model", "path": "review.jsonl"},
    {"id": "review2", "actor": "reviewer", "format": "review-artifacts", "path": "review-trace-directory"}
  ],
  "links": []
}
```

Use actual recorded model IDs. Do not guess them from the CLI name. Multiple runs of
one task can be included with unique session IDs; namespaced event IDs prevent collisions.

`review-artifacts` reads only `request.json`, `command.json`, `invocation.json`,
`provider.stdout`, `provider.stderr`, `response.md`, and `verdict.json` in that directory.
The request is required. Missing verdict produces an explicit `NO_RESULT` status.
These are review artifacts, not a reconstruction of the reviewer's internal thinking.
The files are embedded completely, after redaction. Native CLI traces should be used
when available for a finer record of reviewer actions.

```sh
python3 /absolute/skill/scripts/extract_timeline.py --manifest /absolute/work/task.json --out /absolute/work/extracted
```

Inspect `timeline.md` and the full events. When a review request/return is explicitly
recorded, add links with actual namespaced IDs and an evidence description, then rerun:

```json
{"source":"main:E17", "target":"review1:E1", "kind":"review_request", "evidence":"Main event E17 invokes the exact recorded review trace ID."}
```

For return, source is the review event and target is the main event that actually reads
that review. Allowed kinds: `review_request`, `review_return`. Missing timestamps or
unknown invocation positions remain unknown. A request with no recorded return must
not get an invented return edge. Changing input logs can renumber events; recheck links.

## 2. Default state-view export

Use the merged timeline to write `state-analysis.json` following [state-graph.md](state-graph.md),
[observations.md](observations.md) and [reading-layer.md](reading-layer.md). Preserve namespaced
event IDs, actor labels and evidenced review handoffs. Build with `build_state_graph.py
--format state --require-reading-layer`. The complete source records stay in that one file.

The phase/canvas sections below apply only to explicit legacy ThoughtDAG requests.

## 3. Legacy canvas analysis

Read every timeline part and cite events. See [analysis-schema.md](analysis-schema.md).
Use `actor` and `category` alongside `kind`, for example:

```json
{"id":"S8", "phase":"P3", "kind":"observation", "actor":"reviewer", "category":"review", "title":"Missing correctness check", "body":"The reviewer requests a correctness test.", "events":["review1:E4"], "informs":["S9"]}
```

S9 must be an actual, separately evidenced decision by the main agent. Do not treat a
reviewer's performance claim as a measured result. Distinguish request, returned verdict,
main-agent response and actual validation. Keep analyst interpretation in `analyst`.

## 4. Legacy canvas build

```sh
python3 /absolute/skill/scripts/build_canvas.py /absolute/work/analysis.json --timeline /absolute/work/extracted/timeline.json --with-event-graph --out /absolute/work/task.thoughtdag.json
python3 /absolute/skill/scripts/preview_canvas.py /absolute/work/task.thoughtdag.json --out /absolute/work/preview.html
```

The left region is the phase/decision analysis. The right region contains a column for
each complete session. Colors and title labels distinguish main statements (blue), tools
(orange), reviews (red), visible thinking (purple), inputs (green), and status (gray).
Review cards use the native evaluator marker; reviewer tool calls remain orange and
carry the reviewer actor label. Raw reviewer/source files are embedded in the root
attachment even when they are not ordinary dialogue records. One canvas is sufficient.

Without `--with-event-graph`, the compact analysis still includes the full timeline and
sources in the root attachment. Original logs are never modified.

## Limits

- Chronological wires show recorded order; they are not the model's exact context graph.
- Input-token totals use recorded fields. Missing usage is null, with a separate known
  subtotal in multi-session output. Claude/Pi include recorded cache-input fields;
  Codex uses recorded input_tokens. These totals are not costs or output-token totals.
- Private or absent thinking is not reconstructed. Unparsed transport records remain
  in source attachments. Unknown plain-text console formats require another parser.
- Pattern redaction is incomplete by nature. Use repeatable `--secret-file` for known
  credentials, scan the finished export, and keep real logs out of the skill repository.
