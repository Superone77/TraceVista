# Clear technical explanations

## Contents

- Write the explanation before the card label
- Before and after
- Review the meaning
- Primary references

Use this guide for authored titles, summaries, ladders, journey text and relation explanations.
It adapts the clarity principles of ASD-STE100 to trajectory reading. It is not a controlled
dictionary or a claim of formal STE conformance. Keep established technical terms, code,
numbers, file names and identifiers exact. Preserve raw records and quoted excerpts verbatim.
Use the trajectory's language unless the user requests another; the same clarity goals apply
to Chinese and other languages.

## Write the explanation before the card label

For an important state, phase or action, build `summary` from the available evidence:

1. **Operation:** What did the agent try, change, inspect or request? Name the actor when
   it matters, especially across main and reviewer sessions.
2. **Observation:** What did the result show? Give the relevant value, comparison, input
   condition and evaluation scope. An agent's interpretation is not a measured result.
3. **Decision:** What did the agent choose next, and what recorded reason connects it to
   the observation? If no reason was recorded, describe the order without asserting a cause.

These are questions to answer, not mandatory labels or three compulsory sentences. An
inspection can have no decision; a failed call can have no usable result. State only what
is supported. Cite the events through the entity's `events`, quoted `abstract`, and evidenced
links. Use `informs` only for an observed connection to a later decision.

Write one idea per sentence. Use concrete verbs such as “changed”, “measured”, “rejected”
and “restored”. Give each paragraph one subject and put its main finding first. If a sentence
contains several results or conditions, split it without removing those conditions. Explain
an unfamiliar abbreviation on first use. Use the same term for the same thing throughout the
run; do not rotate “candidate”, “version” and “submission” when they mean different objects.

Then derive the ladder from that explanation. A short takeaway must remain true on its own.
For example, keep “on reused inputs” if that condition is essential to a speedup. Use `reason`
for the key evidence or limit, and `summary` for the detail that does not fit. Do not shorten
the full explanation merely to meet the ladder budget. Do not add sentence-length gates or
replace precise domain terms with vague short words.

## Before and after

The following numbers and events are illustrative, not evidence for an actual run. Use the
rewrite only when the input contains the stated observations and actions.

### A result with a condition

Before: “The agent optimized the cache and validated a substantial improvement.”

After: “The agent added a cache keyed by object identity. With reused objects, local latency
fell from 12 ms to 8 ms. With fresh objects, latency was 13 ms. The agent removed the cache
after the fresh-object test. The log does not state why it removed the cache.”

| Field | Authored text |
|---|---|
| `ladder.topic` | Object cache |
| `ladder.takeaway` | Object cache helps only with reused inputs |
| `ladder.reason` | Fresh inputs took 13 ms versus the 12 ms baseline. The cache was removed; the reason is unrecorded. |
| `summary` | The full “After” paragraph above |

The numbers describe local latency. They do not establish an end-to-end gain. The recorded
order does not establish why the agent removed the cache, so it does not justify an `informs`
link by itself.

### Review and code change

Before: “Review passed after further optimization, confirming success.”

After: “The reviewer requested a missing test report. The main agent attached that report
without changing the code. The reviewer accepted the revised submission. These records
contain no independent correctness check or performance measurement.”

Use the report request and return as the review chain. Keep the same implementation state
when code is the tracked scope. An accepted review is not a speedup or an independent test.

### Recovery and attribution in Chinese

Before: “实验失败后回滚，成功解决问题。”

After: “候选版本 3 在输入 B 上失败。Agent 随后恢复了版本 2。恢复后的输入 B 测试通过。
日志没有记录恢复操作的原因，也没有再次测量性能。”

This explains what changed and which test passed. It does not infer a general fix or claim
that the restored version improved performance. Keep the failed candidate in the trajectory.

### Research without a code artifact

Before: “The agent researched the affiliation and found the answer.”

After: “The agent compared a 2022 article with a 2024 staff page. The pages listed different
affiliations. The final answer used the 2024 affiliation and cited the staff page. The trace
does not show whether the older page was wrong or the affiliation changed.”

Here the observed result is a source disagreement and a cited answer. No code state or
correctness gate should be invented to fit a coding example.

## Review the meaning

Before compiling or saving a reading revision, read the overview and one important path as
someone who has not seen the logs. Check:

- Can they identify the agent, task, starting point, relevant configuration and final outcome?
- Can they tell what each step adds, and why a direction was kept, rejected or left unresolved?
- Does each number retain its unit, baseline, conditions and measurement scope?
- Are source observations, the agent's stated interpretation and the analyst's inference
  distinguishable? Use “the agent attributed…” or “the records suggest…” when appropriate.
- Can the reader follow each claim to the cited entity and its raw events? Are quotes unchanged?

Revise unclear prose, not the evidence. The existing validator checks structure, citations
and quote preservation; it cannot prove an explanation is accurate or clear.

## Primary references

- [ASD's explanation of STE](https://www.asd-ste100.org/about_STE.html): controlled word
  meanings and the use of subject-specific technical terms.
- [ASD-STE100 Issue 9, Part 1](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf):
  writing rules for sentence structure and descriptive writing, including one topic per
  paragraph. The examples above are original TraceVista examples.
- [ASD's guidance on writing tools](https://asd-ste100.org/STEsoftware.html): automated
  checks can assist an author, but cannot establish whether a paragraph explains its topic.
