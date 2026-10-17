<div align="center">

# TraceVista

**Understand Your Agents.**

Turn agent logs into interactive maps and stories.<br/>
Explore decisions, replay the work, and get answers linked to the original evidence.

For coding, research, and creative workflows.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Verify](https://github.com/Superone77/TraceVista/actions/workflows/verify.yml/badge.svg)](https://github.com/Superone77/TraceVista/actions/workflows/verify.yml)
[![Live demo](https://img.shields.io/badge/demo-tracevista.pages.dev-black.svg)](https://tracevista.pages.dev/)

[**Open TraceVista**](https://tracevista.pages.dev/) · [**Explore examples**](#explore-real-agent-runs) · [**Convert your trajectory**](#bring-your-own-trajectory) · [Docs](docs/VIEWER.md)

**English** · [简体中文](README.zh-CN.md)

[![Switching from system states to work phases, actions, and raw records](docs/images/semantic-zoom.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

</div>

**You let an agent run overnight. It says “Done” and leaves thousands of lines of logs. How did it get there?**

TraceVista helps you follow the work behind the result. See what changed, which attempts failed, and where the agent changed direction. Explore the map, read the story, or press Play to walk through the run. When something needs a closer look, ask a question and jump from the answer to the original messages, tool calls, and results.

## Explore real agent runs

Open an example and follow its decisions from the overview down to the original records. No sign-up or model key needed.

| Example | Inside the run |
|---|---|
| [**Pi Agent · Kernel Optimization**](https://tracevista.pages.dev/?example=pi-agent-lora) | DeepSeek Flash optimizes vLLM's multi-LoRA kernels on an A100. Follow grouped Triton kernels, direct launch, an identity-cache regression, and a return to an earlier candidate. |
| [**Claude Code · Post Training**](https://tracevista.pages.dev/?example=posttrainbench-fable5-aime) | Fable 5 Max trains Qwen3-4B for AIME 2025 on an H100. Explore fine-tuning, checkpoint averaging, evaluation, and the choice of the final model. |
| [**Codex · Model Serving**](https://tracevista.pages.dev/?example=inferencebench-serving-recovery) | GPT-5.5 High tunes a Mistral-7B server on an H100. Follow scheduler experiments, startup recovery, and a rejected sampling change. |
| [**OpenHands · Bug Fixing**](https://tracevista.pages.dev/?example=swe-rebench-kafka-retry) | Qwen3-Coder investigates a Kafka connection retry loop. Trace source edits, revised tests, and the gap between local checks and the benchmark outcome. |
| [**Tongyi DeepResearch · Literature Research**](https://tracevista.pages.dev/?example=literesearcher-affiliations) | A teacher trajectory from LiteResearcher SFT data compares two journal articles to identify the authors’ shared institution. Follow an empty PDF, a switch to journal author blocks, and a broader search after zero results. |
| [**Codex · Garden Animation**](https://tracevista.pages.dev/?example=codex-garden-animation) | GPT-6 Astra turns a ruined hall into a Three.js garden of flowers that sway in the breeze. Follow screenshot checks, a recording timeout and a different save path, and the check of a ten-second MP4. A short excerpt of a longer session. |

## Bring your own trajectory

**Two prompts. A complete map.** Copy these into your coding agent.

### 1. Install the skill

```text
Install skills/tracevista-skill from https://github.com/Superone77/TraceVista
```

### 2. Convert and open

```text
Use tracevista-skill to convert [trajectory file or folder] into a complete .agent-state.json,
then open https://tracevista.pages.dev/ in my browser and import it.
```

Use `$tracevista-skill` in Codex or `/tracevista-skill` in Claude Code. The skill reads the logs, builds the state map and summaries, validates the export, and opens it in the viewer. You can ask the agent to refine the same map as you explore.

Its [writing guide](skills/tracevista-skill/references/clear-writing.md) borrows from ASD-STE100: concrete verbs, consistent terms, and one idea per sentence. Explanations connect what the agent did, what the evidence showed, and what it chose next, with the technical conditions intact.

Works with **Claude Code, Codex, and Pi** session logs, **InferenceBench** traces, and **SWE-rebench OpenHands** trajectories. Combine main-agent and reviewer sessions in a single export.

The map, annotations, original records, and source attachments travel together in one `.agent-state.json`. Reopen it with **Import trajectory**, send it to a collaborator, or keep refining it with your agent. The conversion scripts use Python 3.10+ and its standard library.

[Skill guide](skills/tracevista-skill/SKILL.md) · [Conversion workflow](skills/tracevista-skill/references/conversion.md) · [Multiple agents](skills/tracevista-skill/references/multi-agent.md)

## One run. Four levels of detail.

Explore the same run at four connected levels:

**System states → Work phases → Actions → Raw records**

| Level | What you see |
|---|---|
| **System states** | How code and artifacts evolved, where results improved or regressed, and which version was selected. |
| **Work phases** | The approaches an agent explored, the alternatives it tried, and where it changed direction. |
| **Actions** | Explore, Plan, Edit, Execute, Verify, and Diagnose—with descriptions, outcomes, and who did the work. |
| **Raw records** | Original messages, recorded reasoning, tool inputs and outputs, and reviewer feedback. |

Pan and zoom through the same canvas, or jump between levels with the toolbar. Select any card to open its path in **Story** and follow its evidence.

## Follow the decisions

See what the agent tried, what it learned, and what happened next. Decision markers highlight discoveries, rejected ideas, pivots, and open questions. **Decisions only** folds routine steps so the important turns stand out.

Switch between **Version tree** and **Execution order** to follow both code ancestry and the sequence of work. Restored versions, abandoned candidates, and final selections stay visible. Measurements sit alongside the states they describe.

Press **Play** for a guided walkthrough. Story opens the current step while Map moves to the same place. Pause, move backward or forward, change the pace, or open the original evidence. Exit returns to your previous view.

[![Comparing the version tree with execution order and inspecting a regressed candidate](docs/images/version-history.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

## Go straight to the evidence

Expand a card's sentence in **Story**, then read the original messages, code, tool calls, and results behind it. Full explanations appear beneath the short labels as you expand. Follow the agent's explanation all the way to the recorded work.

[![Opening action details, reading the original tool call, and checking its result](docs/images/raw-evidence.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

Bring the main agent and its reviewers into one map. Follow a review request through feedback, revisions, and another round of checks. Inspect skill use, knowledge reuse, TODOs, and measurements in **Structure & evidence**.

## Chat with your trajectory

Select a node, open **Chat**, and ask about that step or the run around it:

> Why did the agent abandon this approach? What evidence led to the next version?

**Smart context** first reads node summaries and an index of the raw records, then selects the records to read in full. Answers include clickable citations that take you back to the relevant nodes and events.

Ask how a decision happened to get a linked flow diagram, or compare attempts in a table. Click a claim or its evidence to locate it in Story and Map. The answer distinguishes recorded observations, interpretations, and open questions.

[![A real model answer with Smart context: inspect the selected records, click a cited action to jump to it, and open an original measurement from the answer](docs/images/node-chat.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

Connect Claude, OpenAI, Gemini, DeepSeek, Kimi, GLM, Qwen, MiniMax, OpenRouter, or your own compatible endpoint. Local models work through Ollama and LM Studio.

## Designed for informed decisions

<details>
<summary>TraceVista lets you decide whether to trust an agent run, and which steps to check, <strong>without reading the whole log</strong>.</summary>

A single agent run can leave more text than anyone will read. The [Pi Agent example](https://tracevista.pages.dev/?example=pi-agent-lora) ran for about 45 minutes and left 556 events and a session log of 2.26 million characters.

![Left: one screen of the raw session log, 363 lines and 2.26 million characters in all. Right: the same run in Story, the outcome first and then one sentence per step.](docs/images/log-vs-story.png)

</details>

<details>
<summary>TraceVista turns the session log into a Story that <strong>starts with what the run delivered</strong>.</summary>

Then it gives one sentence per step. Segel and Heer (2010) call this a **martini-glass structure**. The author leads at first, through the narrow stem; then the reader explores the wide bowl, which here is the map, the raw records and Chat. ▶ Play steps through the story and moves the map with it.

[![Play highlights one Story sentence at a time while the map moves to the matching state and work phase](docs/images/story-play.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

</details>

<details>
<summary>TraceVista lets you <strong>unfold any sentence in place</strong>.</summary>

Click it and its work phases open underneath; click a phase for its actions, and an action for its raw records. Ted Nelson called this **StretchText** (1967). The rest of the story stays where it was, and the map switches to the same level.

[![One Story sentence unfolds into work phases, then actions, then raw records, while the map switches to the same level](docs/images/story-unfold.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

</details>

<details>
<summary>TraceVista keeps <strong>the agent's own records word for word</strong>, and every sentence about them opens down to those records.</summary>

The records are never translated. Summaries written by a model tend to sound more certain than their sources. In our checks of [TextFold](https://github.com/chenxiachan/textfold)'s paper summaries, one had turned *potentially harmful* into *harmful*. Because the records are always there to check, readers can match their trust to the evidence (Lee & See, 2004).

[![The action sentence "Launch large-scale tile search" above the tool call and tool result it summarizes, with the source line and call ID](docs/images/story-evidence.png)](https://tracevista.pages.dev/?example=pi-agent-lora)

</details>

## Run locally

Requires **Node.js 24.x** and **pnpm 11.19.0**.

```bash
git clone --depth 1 --branch main https://github.com/Superone77/TraceVista.git
cd TraceVista
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open [localhost:8875](http://127.0.0.1:8875/) and import a `.agent-state.json`. The default viewer, build, and tests work without the example library.

The shallow clone downloads the latest `main` snapshot. Both the standalone viewer and the website use the same viewer and UI source in this repository; the website build adds the separately versioned example data.

| Command | Result |
|---|---|
| `pnpm dev` | Start the standalone viewer. |
| `pnpm test` | Check the viewer and conversion skill with small test fixtures. |
| `pnpm build` | Build the standalone viewer in `dist/`. |
| `pnpm dev:site` | Start the showcase with the pinned external example library. |
| `pnpm test:examples` | Check the full example exports and their source evidence. |
| `pnpm build:site` | Build the showcase in `dist-site/`. |

Browse the six examples on the [website](https://tracevista.pages.dev/). To run the showcase locally, place the separate `TraceVista-examples` repository beside this checkout or set `TRACEVISTA_EXAMPLES_DIR`. The viewer pins its data revision and asset hashes in `examples.lock.json`. See [Example library setup and updates](docs/EXAMPLES.md) for checkout, validation, and release details. Both build outputs can be served by a static host.

## Build on TraceVista

TraceVista pairs a **React Flow viewer** with a **trajectory conversion skill**. A shared JSON format connects them, so new agents and tasks can bring their own adapters, annotations, and examples.

- [Viewer guide](docs/VIEWER.md) — navigation, details, chat, and model connections.
- [State graph format](skills/tracevista-skill/references/state-graph.md) — states, actions, transitions, and evidence.
- [Reading layer](skills/tracevista-skill/references/reading-layer.md) — summaries, turning points, and decision links.
- [Contributing](CONTRIBUTING.md) — set up, run the checks, add an adapter or example, and send a pull request.

Have an interesting trajectory or an idea for the viewer? [Open an issue](https://github.com/Superone77/TraceVista/issues).

## License

TraceVista's code is released under the [MIT License](LICENSE). The external example library keeps its source licenses, such as Apache-2.0 and CC-BY-4.0, and its own notices. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for code attribution and the example notices location.

## Acknowledgements

TraceVista builds on ideas and code from [ThoughtDAG](https://github.com/chenxiachan/thoughtdag), including its semantic zoom, reading layer, and model connections. The viewer uses [React Flow](https://reactflow.dev/).

Thanks to the teams behind PostTrainBench, InferenceBench, SWE-rebench, and LiteResearcher for publishing agent trajectories. [Sources and attribution](THIRD_PARTY_NOTICES.md).
