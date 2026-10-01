# Neutral observations contract (optional v1 extension)

The core contract describes state occurrences, branches, six behavior classes and raw
records. `observations` adds meaning without replacing those records. The viewer renders
this contract generically; runner-, skill-, repository- and benchmark-specific extraction
belongs in analyst adapters. Old v1 files without observations continue to work.

## Record shape

```
{id, kind, title, summary, subjects: [entityId], events: [rawEventId],
 facts: {field: primitiveOrNull}, artifacts?: [artifactName]}
```

IDs share the core entity namespace. `subjects` references states, branches or actions;
`events` uses explicit IDs (expand ranges before authoring this extension). Every statement
needs evidence. `summary` explains interpretation and limits in full. Facts are scalar
strings, finite numbers, booleans or null; additional named fields are retained and shown.
An unknown version is null, not guessed from a repository's current checkout. Artifact
names reference the graph's retained, redacted artifacts, including content and SHA256.

| Kind | Required facts |
|---|---|
| exploration | level: work_step / hypothesis / trial; disposition: proposed / running / retained / rejected / failed / stopped / unknown |
| skill | name; load_method: native_call / guide_output / source_read; version: string or null |
| review | stage: request / feedback / revision / recheck; outcome: requested / pass / revise / blocked / unknown; code_change: changed / unchanged / unknown |
| knowledge | operation: write / read; resource (stable document/entry identity) |
| task | operation: add / reprioritize / complete / fail / stop; task_key (stable identity); reason required for fail/stop; priority optional |
| measurement | metric; numeric value; unit (use `dimensionless` if none); scope: development_score / independent_score / local_timing / end_to_end_timing / other; protocol; baseline; direction: higher / lower / none; measurement: measured / historical |
| status | category: review / correctness / performance / submission; outcome; scope |

Status outcomes: review = pass/fail/blocked/unknown; correctness = pass/fail/unknown;
performance = improved/regressed/unknown; submission = completed/blocked/unknown.
A reviewer PASS does not establish correctness or performance; a successful submit command
is not evidence of accepted performance. Do not copy one status into all categories.
Performance improvement requires comparable measurements, the same protocol/scope and an
explicit reference; preserve uncertainty. Measurements with different scopes are separate
records, never a mixed leaderboard. Historical reuse is not a fresh measurement.

## Relationships

`observationLinks: [{source, target, relation, reason, events}]` connects observation IDs.

- `contains`: parent → child exploration. Work step → hypothesis → parameter trial. Reject
  hierarchy cycles. A tried and abandoned hypothesis has disposition rejected; do not use
  the legacy branch status rejected for executed actions (that status means untried).
- `alternative`: one hypothesis → alternative hypothesis, not concurrency.
- `follows`: earlier → later execution. Kept independently of hierarchy; reject cycles.
- `requests`: material record → review request.
- `responds`: request → feedback.
- `addresses`: feedback → code revision, extra tests or supplemental materials.
- `rechecks`: revision → subsequent review; missing review is not invented.
- `reads_from`: earlier knowledge write → later read of the same resource.
- `updates`: earlier TODO event → later lifecycle event with the same task_key.
- `compares`: reference measurement → compared measurement; explicitly describe scope,
  configuration, baseline and any statistical limitations.

Every edge needs evidence and a reason. Only connect observed handoffs or source references,
not merely neighboring timestamps. `code_change: unchanged` requires equal nonempty
`before_code` and `after_code` identifiers plus cited evidence covering the same code scope.
If only report edits are visible and there is no code identity proof, use unknown and explain
what was observed. Hashes being equal is a structural check; the analyst must verify they
came from real evidence. Version history remains in states.lineage (derived/restored/retained)
and chronological transitions; a restore is a new temporal occurrence, not erased history.

## Skill recognition

Recognize three distinct observable ways of loading instructions:
1. **native_call**: an actual provider-native Skill tool invocation with name and linked
   return. Record failed/missing returns in the summary; invocation is not proof of execution.
2. **guide_output**: a workflow-guide invocation AND returned instruction body, whose name
   is established by the invocation/output. A guide help message alone is not a loaded skill.
3. **source_read**: an actual file/read command and returned skill instruction body. Bind name
   to the path/front matter, not an arbitrary text mention. Reading a README that recommends
   a skill does not count as loading that skill.

Use tool call IDs / session IDs when linking results; do not pair by title. Shell wrappers,
compound commands and guide conventions require adapter/analyst interpretation. Do not
present regex-only guesses as verified calls. The viewer accepts all three annotated forms;
its legacy fallback only detects unambiguous native Skill calls. Loading does not prove all
stages were followed. Version and observed products are separate, evidence-backed fields.

## Extraction checklist

- Inventory observable hypotheses and parameter trials, not every command as a new hypothesis.
- Preserve chronology separately from exploration and code provenance.
- For every review, check request → response → correction/material → next request. Record gaps.
- Find knowledge writes and subsequent reads; do not infer learning from a write alone.
- Keep every TODO lifecycle change and reason, including failed/stopped work.
- Split metrics by scope and protocol; mark statuses independently.
- Mark annotation coverage/limitations in graph.notes. Unknown is preferable to invented links.
- Run the compiler and viewer validators, then inspect the visible result with raw evidence.
