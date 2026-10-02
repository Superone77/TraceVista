# Legacy ThoughtDAG canvas export

Use only when the user requests the stock ThoughtDAG format. Extract the timeline using SKILL.md first.

## 3. Read it and write analysis.json

Read `analysis-schema.md` first: it defines the file and the kinds. Then read every
part of `timeline.md` from start to end - the forks and the reasons for decisions are usually in
the agent's own messages between tool calls, and skipping parts is how the analysis ends up as a
flat chain. When a cut-off line matters (a measurement table, a long explanation), print it whole:

```bash
python3 /absolute/path/to/this/skill/scripts/show_events.py <work dir>/timeline.json E37 E64-E66
```

While reading, keep track of:

- **Phases** (3-8): stretches with one purpose - understanding the problem, a first approach, a
  rewrite, tuning, wrapping up. These become the frames a zoomed-out reader navigates by, so name
  them by what was done and give each a takeaway that states what the phase established.
- **Observations → decisions**: every time the agent looked at something (a profile, a test
  result, an error, a score) and changed what it did next. Record the observation as its own step
  with `informs` pointing at the decision. This pairing is the core of the canvas; a decision
  without its observation is the most common thing readers ask about.
- **Forks**: every place the agent tried an alternative - a different approach, a variant it
  benchmarked, a fix it reverted. Reconstruct them as branches off the decision point, as the
  schema describes, so the canvas shows where the paths split and which ones stopped.
- **Dead ends and open questions**: mark them as such; they are as informative as the wins.
- **Numbers**: scores, timings, pass/fail counts, token use. Put them in bodies and takeaways.

Write takeaways as conclusions ("Fused kernel: 17x, correct"), not labels ("Kernel work"). Cite
events for every step. Use the user's language for all text (`language`: `zh` or `en`). Keep the
trajectory's facts and your own judgement apart: what the agent did and said goes in `body`; what
you notice that it did not (an untested claim, an option it never tried) goes in `analyst`.

If the trajectory is very long (thousands of events), work phase by phase: skim the whole
`timeline.md` once to set the phases, then write the steps of each phase.

## 4. Build and check the canvas

```bash
python3 /absolute/path/to/this/skill/scripts/build_canvas.py <work dir>/analysis.json \
    --timeline <work dir>/timeline.json --out <work dir>/<name>.thoughtdag.json
```

Name the file after what it shows, e.g. `<task>-<agent>.thoughtdag.json`; the canvas takes its
title from `analysis.json`.

Every step must cite existing events; unknown references and missing evidence fail the build.
The root includes the complete timeline and source logs as an attachment, excluded from
future model context by default.

If it lists problems, fix `analysis.json` and run it again; act on its warnings too (overlapping
frames usually mean an observation informs a step two phases later). Its summary line reports
phases, lanes (columns used; branches reuse a column once the line that held it has ended, so a
few lanes for many branches is normal), branches, observations, decisions and dead ends: if
`branches` or `observations` is 0, check whether evidence was missed. Keep zero when the
log does not establish alternatives or observations; do not invent them to fit the graph. To cite the whole session for an open question or the
overview, cite its final report event.

To look at the layout before importing (or for someone without ThoughtDAG), render a static preview:

```bash
python3 /absolute/path/to/this/skill/scripts/preview_canvas.py <work dir>/<name>.thoughtdag.json --out <work dir>/preview.html
```

If you can take a screenshot of it (a headless browser), look once: phases should read top to
bottom, abandoned alternatives should hang to the right of the line and stop, and each
observation note should sit beside the step it points into.

## 5. Tell the user how to open it

- In ThoughtDAG (desktop app, the browser app at https://app.thoughtdag.workers.dev, or a local
  `npm run dev`): click the canvas name at the top left to open the canvas switcher, choose
  **Import backup** (导入备份) and pick the `.thoughtdag.json`. It opens as a new canvas.
- How to read it: the root card at the top is the overview; purple wires going down are the main
  line; orange wires to the right are alternatives the agent branched into; dashed wires come
  from observation notes into the steps they drove; coloured frames are phases. Zoom out to see
  phases and plaques, click a card for its text and its raw events.

Mention that the file contains the trajectory's text (secrets are redacted by pattern, not
guaranteed) before they share it.

