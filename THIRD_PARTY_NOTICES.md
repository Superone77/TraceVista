# Source and attribution

## Viewer

The local state/trajectory viewer was developed from the ThoughtDAG codebase:
https://github.com/chenxiachan/thoughtdag (copyright © 2026 Xia Chen, MIT).
Its license is preserved at [LICENSES/ThoughtDAG-MIT.txt](LICENSES/ThoughtDAG-MIT.txt).
The local source checkout had base commit `5e876d8e1e31881a8da9cf95d103e1adac0fb74a`
plus local state-view modifications; this repository contains the actual modified source,
not a claim that these features exist in that upstream commit.

This package extracts the state viewer only. It preserves the React Flow attribution and
uses React / React Flow / Vite / bundled Inter fonts. The dependency lock records exact
versions and package integrity. No upstream chat backend or model API proxy is included.

The reading layer adapts further ThoughtDAG modules (same copyright and MIT license):
`viewer/src/trajectory/ladder.ts` (from `src/lib/ladder-core.ts`), `ZoomText.tsx` (from
`src/components/ZoomText.tsx`), `RoutedEdge.tsx` (from `src/lib/edge-path.ts`), the tool
fingerprint in `model.ts` (from `src/lib/turn-insight.ts`), the fold rule in `semantic.ts`
(after `src/lib/condense.ts`), and the prompts behind `references/reading-layer.md` (after
`src/lib/ladder.ts` and `src/lib/gedankengang.ts`).

The browser provider catalog and live model discovery in `viewer/src/trajectory/providers.ts`
follow ThoughtDAG's `src/lib/runtime-providers.ts` and streaming behavior in `src/lib/direct-llm.ts`
(same copyright and MIT license). Vendor-specific endpoints are checked against official API
documentation. Its proxy, OAuth and subscription bridges are not included.

## Conversion skill

`skills/tracevista-skill` is copied from the user's local private skill repository
(base commit `e0c1221a4d45c9c006dc7cc6d5f2805e2f3e8cde` plus local state/observation changes).
This repository contains the complete version used by the example, including standalone-export changes. It does not depend on access to the older private repository.

## Research examples

The bundled KDA W8A16 JSON export is a user-authorized public research example, with English
annotations and original model/tool evidence. It includes snippets of the task code. The
upstream viewer license does not cover the research logs. Other imports are not bundled.

### PostTrainBench

The bundled `posttrainbench-fable5-aime.agent-state.json` is derived from the
[PostTrainBench Agent Traces dataset](https://huggingface.co/datasets/aisa-group/PostTrainBench-Trajectories)
published by the AI Safety and Alignment Group, ELLIS Institute Tübingen and MPI-IS,
under Apache License 2.0. A copy is included at
[LICENSES/PostTrainBench-Apache-2.0.txt](LICENSES/PostTrainBench-Apache-2.0.txt).

Source: Fable 5 Max / Claude Code, AIME 2025, Qwen3-4B-Base, run 1, job `17337591`,
at dataset revision `386b3034fa26f0f1b3ae3bfded99b791f0b254a6`:
[original run and evaluation artifacts](https://huggingface.co/datasets/aisa-group/PostTrainBench-Trajectories/tree/386b3034fa26f0f1b3ae3bfded99b791f0b254a6/claude_non_api_max_claude-fable-5_1m__10h_run1/aime2025_Qwen_Qwen3-4B-Base_17337591).
Selected for this library on 2026-10-04.

Modifications: the source trace and evaluation artifacts are repackaged as one TraceVista
JSON export, with English analyst annotations, state/checkpoint relationships, work phases,
actions and evidence references. Original messages, commands, results and attached evidence
retain their source text. The 30% archived final score, 23.3% pooled development score and
current v1.2 aggregate are recorded separately.

Project: [PostTrainBench](https://posttrainbench.com/), by Ben Rank, Hardik Bhatnagar,
Ameya Prabhu, Shira Eisenberg, Karina Nguyen, Matthias Bethge and Maksym Andriushchenko.
Paper: [PostTrainBench: Can LLM Agents Automate LLM Post-Training?](https://arxiv.org/abs/2603.08640), ICML 2026.

### InferenceBench

The bundled `inferencebench-serving-recovery.agent-state.json` is derived from
[InferenceBench-Trajectories](https://huggingface.co/datasets/aisa-group/InferenceBench-Trajectories),
published by the AI Safety and Alignment Group, ELLIS Institute Tübingen and MPI-IS, under
Apache License 2.0. The same license text is preserved at
[LICENSES/PostTrainBench-Apache-2.0.txt](LICENSES/PostTrainBench-Apache-2.0.txt).

Source: `run_0155`, dataset revision `ea68d73df80985099ef58b342e50c465214d6e7b`,
[original trace and recorded results](https://huggingface.co/datasets/aisa-group/InferenceBench-Trajectories/tree/ea68d73df80985099ef58b342e50c465214d6e7b/runs/run_0155).
Project authors: Jehyeok Yeon, Ben Rank and Maksym Andriushchenko.

Modifications: complete published records are packaged as a TraceVista JSON with English
analyst annotations, state changes, work phases, actions, measurement scopes and evidence
references. No benchmark was rerun. Selected on 2026-10-04.

### SWE-rebench OpenHands trajectories

The bundled `swe-rebench-kafka-retry.agent-state.json` is adapted from
[Nebius SWE-rebench OpenHands trajectories](https://huggingface.co/datasets/nebius/SWE-rebench-openhands-trajectories)
by Maria Trofimova, Anton Shevtsov, Badertdinov Ibragim, Konstantin Pyaev, Simon Karasik
and Alexander Golubev, under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Source revision: `35455389ab51bf5e2306bfd436ef72d0f98bf882`; trajectory
`chatcmpl-86805430c534a25711dc2c50c473619c`, task `dpkp__kafka-python-1312`.
The trace contains source-code excerpts from [dpkp/kafka-python](https://github.com/dpkp/kafka-python).

Modifications: complete published messages, tool definitions, patch and outcome metadata
are repackaged with English TraceVista annotations and evidence-linked state/action maps.
Agent self-tests and the published task verdict are distinguished. This visualization was
created on 2026-10-04; it does not imply endorsement by the dataset or software authors.
