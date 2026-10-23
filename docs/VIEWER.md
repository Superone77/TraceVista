# TraceVista viewer guide

**English** · [简体中文](VIEWER.zh-CN.md)

TraceVista is a React Flow viewer for agent states, decisions, actions, and original records. It works with different agents and tasks through a shared trajectory format. You can import and read a trajectory without a model account. Chat is optional and uses the model connection you configure.

## Open a trajectory

Open [TraceVista](https://tracevista.pages.dev/), select **Import Trajectory**, and choose a complete `.agent-state.json` file. To convert agent logs, follow [Bring your own trajectory](../README.md#bring-your-own-trajectory). The website also offers **Example Trajectories** cards.

For local development, run these commands in the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open [localhost:8875](http://127.0.0.1:8875/). This starts the standalone viewer, which accepts local imports without downloading the example library. To run the website with examples, use `pnpm dev:site`; see [Example library](EXAMPLES.md) for setup.

Importing a file reads it in your browser. The home-page URL does not save that file: keep the JSON to reopen it later. **Export → JSON** downloads the complete graph as `agent-state-trajectory.json`, including its source records and translation tables.

Hover over or click **Export** in the toolbar and select **HTML** to download a single interactive `.html` file named after the trajectory. Open it directly in a browser to explore the map, Story, playback, and original records offline. The file embeds the viewer, styles, fonts, complete trajectory, and current interface language. It opens at the overview with Story collapsed; click Story to open it. Temporary selections, zoom, and chat conversations are not saved. Exported pages retain the Story and Play buttons, detail levels, and language switch; the viewer menu, Export, and Chat buttons are omitted. Model connections and API keys are not included.

## Navigate with Map and Story

The toolbar contains **Story**, **Play**, four detail levels, and **Chat**. Open **☰ Viewer menu** for import, export, Home, Fit view, and display settings.

- **Map** shows version relationships, work phases, actions, and evidence. Select a card to locate its text in Story. Double-click to move one level deeper.
- **Story** starts with a Summary and Outcome, then follows the run through its states. Expand a state to read its work phases, a phase to read its actions, and an action to read the complete original records.
- **Chat citations** locate the same node or record in both Story and Map. An event without an annotated action appears separately in Story.
- **Fit view** shows the whole map. **Home** returns to the landing page and clears the example URL.

The four toolbar buttons set the map level and Story's expansion depth together:

| Level | Map content | Story expansion |
| --- | --- | --- |
| System states | State summaries, measurements, and version changes | State contents collapsed |
| Work phases | Directions explored within each state | All states expanded |
| Actions | Explore, Plan, Edit, Execute, Verify, and Diagnose | All phases expanded |
| Raw records | Messages, tool calls, tool results, and reviews | All actions expanded to original records |

You can also expand individual Story entries. A later click on a level button resets all entries to that depth. Long records remain complete and scroll within their reading area.

### Pan, zoom, and resize

**Trackpad** mode is the default: use two fingers to pan and pinch or `⌘/Ctrl` + wheel to zoom. In **Mouse** mode, the wheel zooms directly. Change modes in Viewer menu.

Drag the canvas background, a card border, or its heading to pan. Hold Space to pan from a card's body. Otherwise, body text remains selectable and scrollable.

Zoom reveals progressively more detail: approximately below 50% for states, 50–85% for phases, 85–115% for actions, and above 115% for raw records. Small overlaps around these boundaries prevent flickering. The viewer keeps the target card in view when changing levels; panning or zooming takes control from an in-progress navigation animation.

Drag Story's right edge or Chat's left edge to resize a panel. Focus a resize handle and use the arrow keys for keyboard control; Shift makes larger adjustments. Double-click a handle to restore its default width. Widths are remembered in this browser. Story can collapse automatically when the window is too narrow for both it and the map.

Interface text stays at a screen-space size while the map zooms. Narrow layouts rearrange controls instead of shrinking their text. Browser zoom and reduced-motion preferences remain effective.

## Understand the map

### Versions and measurements

**Version tree** follows recorded code ancestry. A version restored from an earlier state appears as another child of that state, with a purple dashed rollback edge. Abandoned attempts remain visible. Switch to **Execution order** to follow state transitions in time.

State IDs, such as S0 and S1, follow their order in the run rather than their position in the tree. The final state is marked **Delivered**. When the run has side branches, its ancestry forms a stronger main line and other attempts appear dimmed as **Side branch**. Hover or select a side branch to read it clearly.

State colors use an explicitly annotated `assessment`:

- Green: a measured improvement relative to the specified previous result.
- Red: a measured regression.
- Purple: a final selection that refers to a historical result.

A percentage change describes the reported measurement; it does not establish statistical significance. Historical measurements are not counted as new benchmarks. Correctness, review approval, performance, and submission remain separate outcomes.

### Decisions and connections

Reading annotations identify **Found**, **Decided**, **Changed course**, **Ruled out**, and **Left open**. Decision numbers are shared between Story and the map.

Within each state, work phases follow their start order from left to right. Actions within a phase run from top to bottom. A phase or action that creates a new version connects to that state. Overlapping recorded phase ranges use a dotted **In parallel** connection. A branch alone does not imply parallel execution.

Blue dashed evidence links connect an observation to the decision it informed. These links appear when you hover over or select the relevant card. At the phase and action levels, selection keeps the card, its neighbors, its evidence, and its resulting version clear while dimming unrelated material. Click the canvas background to clear the selection.

**Decisions only** folds runs of three or more routine actions while retaining decisions, supporting observations, and state-changing actions. It is enabled by default when the reading layer is complete. For partially annotated files, the viewer initially shows all actions. Expand a routine group or turn the setting off to see every action.

Use **Legend** in the lower-left corner for the current map symbols. Viewer menu also controls cross-branch links and untried ideas.

### Original records and images

Original records display the event ID, text, and available model, tool, source-line, call-ID, skill, and token metadata. Missing metadata stays missing. A record referenced by several actions is still one source event, not several executions.

Skill badges identify explicit skill metadata or a recorded native Skill call. Tool results can inherit a skill from the matching call in the same session. A name mentioned in ordinary prose is not treated as a call.

Input-token metadata keeps its recorded scope: **Input**, **Cumulative input**, or **Session input**. These figures are not estimates of the displayed text length.

When a file includes images, thumbnails can appear at the Action level and with the original records. Image content is excluded from Chat context. See the conversion skill's [input-image guidance](../skills/tracevista-skill/references/conversion.md) for export options.

## Play through a run

Select **Play** for a guided sequence through the run. Choose a playback depth—states, work phases, actions, or raw records—and a time per step. The default is **4 seconds**, with 8- and 15-second options.

Pause, move backward or forward, or drag the position slider. Click a caption or evidence ID to inspect it. Leaving playback restores the previous view. See [Explanations and playback](EXPLANATIONS-AND-PLAYBACK.md) for the annotation format.

## Ask questions in Chat

Open **Chat → Connect a model**. Choose a provider, enter its API key when required, and select or type a model ID. Requests go directly from your browser to that API; TraceVista does not proxy them through a backend.

Select a card to focus the question on that step, or clear the focus to ask about the whole run. Answers can contain Markdown headings, comparison tables, and diagrams with clickable node or event citations. Clicking a citation synchronizes Story and Map. Unknown IDs are marked as invalid.

Chat saves conversations in this browser, keyed by trajectory title. The **⋯** menu lets you export or clear a conversation. Closing Chat stops an active request; completed messages remain saved.

### Providers and models

| Connection | Presets |
| --- | --- |
| Cloud APIs | Anthropic, OpenAI, OpenRouter, DeepSeek, Google AI Studio (Gemini), Kimi, Zhipu/Z.ai, Alibaba Cloud (Qwen), MiniMax, Groq, Mistral |
| Regional endpoints | China and international presets for Kimi and MiniMax; Beijing and Singapore for Qwen |
| Local servers | Ollama, LM Studio |
| Custom endpoints | OpenAI Chat Completions-compatible or Anthropic Messages-compatible APIs |

Most presets fetch a live model list after you enter a key. The dropdown displays the returned list; **Enter a model ID manually…** is always available. Display names are labels; requests use the model ID.

OpenRouter can list models without a key, but chat requires one. MiniMax uses a manually entered model ID. Custom endpoints fetch models when you click **↻**. Local servers can omit a key when authentication is disabled.

**Test connection** sends a short test prompt through the same transport as Chat, without trajectory data. A working model list does not prove that a chat request will work. The timeout is 60 seconds for a connection test, three minutes for direct chat, and six minutes for the two-round Smart context request. You can stop a request at any time.

The selected API must permit requests from the viewer's origin through CORS. Start and configure a local model server before connecting it. Keys must match the selected service and region. Changing the provider or base URL clears the key and model fields.

### API keys and browser storage

By default, the key exists only in the open Chat panel's memory. **Remember the key in this browser** saves it in `localStorage`, not a cookie. It is not included in trajectory, conversation, or request-context exports. Uncheck the option to remove the persisted key; close Chat to discard the unsaved in-memory key.

Connection settings, input allowances, and conversations are also stored locally. The key authenticates requests to the configured API, and the selected trajectory text is sent there when you ask a question. See [Security](../SECURITY.md) for storage details and private vulnerability reporting.

## Choose a context strategy

Expand the **Context · … · ~N tokens** row above the input to inspect the scope, input allowance, and request preview.

### Smart context

**Smart context** is the default. Each question can use two model calls:

1. **Read node summaries.** Send states, phases, and action summaries, plus a directory containing each candidate event's ID, session, type, estimated text tokens, and linked nodes. This request excludes original text, quoted excerpts, image content, separate attachments, and earlier chat turns. The model selects event IDs.
2. **Read selected records and answer.** Validate the IDs and input budget, then send the selected records' complete text. The status progresses from reading summaries to reading records, thinking, and writing the answer as the API reports progress.

For a focused question, eligible records stop at that node's session-local history boundary. A whole-run question can select from the full run. Summaries are later annotations; nodes with evidence outside the allowed scope contribute structure rather than an out-of-scope summary. Each question selects its own evidence, so make follow-up references explicit.

Both requests are checked against the input allowance. Unknown or out-of-scope IDs, oversized selections, and cancellation stop the process. The viewer does not silently send the whole trace or truncate selected records.

**View evidence selection** shows selected IDs, the selection reason, request count, and estimated tokens. Opening it highlights the selected nodes on the map; closing it removes that highlight. Click an event ID to read the original. You can download the first-round summaries and index, and conversation exports retain the evidence-selection record.

### Direct context modes

| Mode | Material included |
| --- | --- |
| Current node only | The selected node and its original records, without historical records or earlier chat |
| Current + previous + state summaries | The current node, the closest eligible preceding node at the same level in the same session, and earlier state summaries |
| Up to this node (all contained records) | All records within the node and its session-local history, including failed attempts and restored versions |
| Full run (including later outcomes) | The whole trajectory and its annotated outline |

The prefix mode follows record order, not Git ancestry. It sends original evidence and node membership without retrospective titles, assessments, notes, or the global narrative. Each referenced session has its own boundary; relative timestamps from different agents do not establish cross-session chronology. Other sessions enter through explicit evidence or incoming `informs` links.

The nearby mode includes only a preceding node that fits within the current boundary. It does not guess one from code ancestry. Earlier state summaries are capped at 1,200 characters each and marked when shortened. These summaries are retrospective annotations, not a reconstruction of what the original agent knew.

Outside Smart context, **Full original text** is the default. **Historical excerpts · Current node in full** keeps the beginning and end of older records over 800 characters, marks the omissions, and retains the current node's span and original user instructions in full. The two compact modes exclude earlier chat. Other direct modes replay only successful question-answer pairs for the same node and evidence scope.

### Token allowances and request inspection

**Request context** lists the included nodes, records, session boundaries, previous turns, and token estimate. Download the request to inspect it without connection settings or API keys.

The automatic input allowance uses `context_window` or `context_length` from the model API, minus reserved output tokens. The code also has a fallback for recognized DeepSeek models on the official endpoint. Unknown models use a clearly labeled local default of 96,000 input tokens. Manual overrides are saved per endpoint and model, and can be reset to automatic.

Output reservation defaults to 4,096 tokens for Anthropic and 16,384 for OpenAI-compatible APIs, limited by reported model capabilities. The request carries the same output limit. Local token estimates are approximate; the provider enforces its own tokenizer and total window. Error messages distinguish a local budget block from an API rejection. No records are silently dropped to make a request fit.

## Trajectory format

The viewer accepts:

1. A standalone JSON with `format: "coding-agent-state-trajectory"` (recommended).
2. The legacy `format: "thoughtdag-state-trajectory"`.
3. The same structure inside a legacy canvas node's `data.stateTrajectory`.

| Field | Purpose |
| --- | --- |
| `version`, `title`, `scope` | Format version 1, run title, and tracked scope |
| `states[]` | State `id`, `title`, `events`, and `snapshot`; snapshots map component names to text or null |
| `branches[]` | Work phases with `id`, `title`, `state`, `status`, and `events` |
| `actions[]` | Actions with `id`, `title`, `state`, `branch`, `behavior`, `actor`, `outcome`, and `events` |
| `transitions[]` | State changes with `source`, `target`, `action`, `label`, and component before/after evidence |
| `links[]` | Action relationships, including `review_request`, `review_return`, `informs`, and `sequence` |
| `timeline.timeline[]` | Original events with `id`, `kind`, and `text`, plus available source metadata |
| `timeline.sources[]` | Source-file records preserved in the export |

Import validation checks IDs, references, snapshot changes, and acyclic state order. An invalid import leaves the previously opened graph intact. Log content is rendered as data; embedded commands and HTML are not executed.

Raw JSONL logs first need a source adapter and state annotations. The conversion skill's `build_state_graph.py` produces a compatible export. Chronology and code ancestry are distinct: restoring an old code hash creates a new observed state ID rather than a cycle in time. A proposed idea, a review approval, or a successful check alone does not establish a code change.

### Reading annotations

The optional reading layer adds a short topic, a takeaway, a reason, source excerpts, and decision markers. Map reveals these progressively; Story expands to the full explanation and evidence. Unannotated files still open, with fallback text derived from their own titles and summaries.

The converter checks reading-layer coverage with `--require-reading-layer`. `--quality-report` lists missing reasons, source excerpts, and decision-evidence links. These checks measure structural coverage, not whether an interpretation is correct. See [Reading layer](../skills/tracevista-skill/references/reading-layer.md) for the field contract and writing guidance.

### Structured observations

Optional `observations` and `observationLinks` describe exploration hierarchy, skill loading, review stages, knowledge reuse, task lifecycle, measurements, and independent conclusions. They preserve evidence-backed relationships in the complete export without adding task-specific rules to the viewer.

A skill load can distinguish a native call, a workflow-guide output, and a direct source read. Review chains can distinguish code changes from added evidence. Measurements retain their scope, protocol, baseline, and historical/fresh status. A descendant's PASS is not promoted to a blanket state-level conclusion.

See [Observations](../skills/tracevista-skill/references/observations.md) for schema and validation rules. Older version-1 files without this layer remain supported.

## Language

The **EN / 中文** control changes the interface language. When the trajectory includes a translation table, it also changes annotated titles, summaries, Story text, reasons, and overview text. Missing translations retain the file's original text.

Original messages, tool outputs, and verbatim evidence quotes stay as recorded. Chat receives the original graph and answers in the question's language. Export preserves the imported file and all its translations. Some advanced context notes and API error messages remain in English.

A trajectory can declare its annotation `language` and provide an `i18n` table keyed by language and original string. Interface translations live in `viewer/src/trajectory/i18n.zh.json`; `test-ui-language.mjs` and `test-i18n.mjs` check keys and placeholders.

## Build and verify

| Command | Result |
| --- | --- |
| `pnpm test` | Core viewer and conversion checks with small synthetic fixtures |
| `pnpm build` | Standalone viewer in `dist/`, without example exports |
| `pnpm test:examples` | Checks against the separate example library |
| `pnpm build:site` | Showcase in `dist-site/`, with pinned examples |

Both production builds exclude `viewer/public/local-data/` and write `tracevista-release.json`. For local development, a file in that ignored directory can be loaded with `?data=<name>`; ordinary imports work in either build.

The example library contains six cases, their thumbnails, catalog, and source notices. Its commit and asset hashes are pinned by `examples.lock.json`. Only the catalog and thumbnails load with the landing page; a full export is fetched when selected. See [EXAMPLES.md](EXAMPLES.md) for setup and release steps.

When checking a converted trajectory, import that exact JSON and inspect its overview, key decisions, language switching, and raw records. Opening a bundled example does not verify a different file. Browser checks complement automated tests; neither reruns the original agent or benchmark.

For an explicit local preview, the skill also provides `create_view.py`. Its localhost link works only while that service is running on the same machine. See [Opening a trajectory](../skills/tracevista-skill/references/opening.md).
