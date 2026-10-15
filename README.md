<div align="center">

# TraceVista

**Understand Your Agents.**

Turn agent logs into interactive maps and stories.<br/>
Explore decisions, replay the work, and get answers linked to the original evidence.

For coding, research, and creative workflows.

[**Open TraceVista**](https://tracevista.pages.dev/) · [**Explore examples**](#explore-real-agent-runs) · [**Convert your trajectory**](#bring-your-own-trajectory) · [Docs](docs/VIEWER.md)

</div>

**You let an agent run overnight. It says “Done” and leaves thousands of lines of logs. How did it get there?**

TraceVista helps you follow the work behind the result. See what changed, which attempts failed, and where the agent changed direction. Explore the map, read the story, or press **Play** to walk through the run. When something needs a closer look, ask a question and jump from the answer to the original messages, tool calls, and results.

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

[![Switching from system states to work phases, actions, and raw records](docs/images/semantic-zoom.gif)](https://tracevista.pages.dev/?example=pi-agent-lora)

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

## Explore real agent runs

Open an example and follow its decisions from the overview down to the original records.

| Example | Inside the run |
|---|---|
| [**Pi Agent · Kernel Optimization**](https://tracevista.pages.dev/?example=pi-agent-lora) | DeepSeek Flash optimizes vLLM's multi-LoRA kernels on an A100. Follow grouped Triton kernels, direct launch, an identity-cache regression, and a return to an earlier candidate. |
| [**Claude Code · Post Training**](https://tracevista.pages.dev/?example=posttrainbench-fable5-aime) | Fable 5 Max trains Qwen3-4B for AIME 2025 on an H100. Explore fine-tuning, checkpoint averaging, evaluation, and the choice of the final model. |
| [**Codex · Model Serving**](https://tracevista.pages.dev/?example=inferencebench-serving-recovery) | GPT-5.5 High tunes a Mistral-7B server on an H100. Follow scheduler experiments, startup recovery, and a rejected sampling change. |
| [**OpenHands · Bug Fixing**](https://tracevista.pages.dev/?example=swe-rebench-kafka-retry) | Qwen3-Coder investigates a Kafka connection retry loop. Trace source edits, revised tests, and the gap between local checks and the benchmark outcome. |
| [**Tongyi DeepResearch · Literature Research**](https://tracevista.pages.dev/?example=literesearcher-affiliations) | A teacher trajectory from LiteResearcher SFT data compares two journal articles to identify the authors’ shared institution. Follow an empty PDF, a switch to journal author blocks, and a broader search after zero results. |

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

## Run locally

Requires **Node.js 24.x** and **pnpm 11.19.0**.

```bash
git clone https://github.com/Superone77/TraceVista.git
cd TraceVista
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open [localhost:8875](http://127.0.0.1:8875/). Run `pnpm build` to produce a static site in `dist/`, ready for Cloudflare Pages or another static host. Run `pnpm test` to check the viewer, skill, and bundled examples.

## Build on TraceVista

TraceVista pairs a **React Flow viewer** with a **trajectory conversion skill**. A shared JSON format connects them, so new agents and tasks can bring their own adapters, annotations, and examples.

- [Viewer guide](docs/VIEWER.md) — navigation, details, chat, and model connections.
- [State graph format](skills/tracevista-skill/references/state-graph.md) — states, actions, transitions, and evidence.
- [Reading layer](skills/tracevista-skill/references/reading-layer.md) — summaries, turning points, and decision links.
- [Contributing](docs/BRANCHES.md) — work on a branch and send a pull request.

Have an interesting trajectory or an idea for the viewer? [Open an issue](https://github.com/Superone77/TraceVista/issues).

## Acknowledgements

TraceVista builds on ideas and code from [ThoughtDAG](https://github.com/chenxiachan/thoughtdag), including its semantic zoom, reading layer, and model connections. The viewer uses [React Flow](https://reactflow.dev/).

Thanks to the teams behind PostTrainBench, InferenceBench, SWE-rebench, and LiteResearcher for publishing agent trajectories. [Sources and attribution](THIRD_PARTY_NOTICES.md).
