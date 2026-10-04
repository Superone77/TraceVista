# TraceVista · coding agent 状态与轨迹查看器

受 ThoughtDAG 启发的 React Flow 画布，独立入口为 `trajectory.html`。
支持不同任务、agent 和 reviewer；不依赖某个优化实验。浏览与导入无需模型 key；可选 Chat 使用用户配置的模型。

## 打开

直接打开[云端 TraceVista](https://tracevista.pages.dev/)，点击“Import trajectory”选择完整的 `.agent-state.json`。
原始日志先用 `tracevista-skill` 转换，安装与使用见 [README](../README.md#5-用-tracevista-skill-生成和修改轨迹)。首页“View examples”展开案例列表，点击名称后打开案例。

本地开发时，在仓库根目录运行 `pnpm install --frozen-lockfile --ignore-scripts`，再运行 `pnpm dev`，访问 `http://127.0.0.1:8875/`。完整复现与部署说明见 [README](../README.md)。

打开轨迹后仅显示顶部工具栏，品牌、任务标题和副标题不占用画布空间（标签页仍保留任务名称）。顶部保留四层快捷按钮、Details 和 Chat；导入、导出、返回首页及其他设置位于左上角 ☰ Viewer menu。界面使用深浅灰色，轨迹内部的行为、状态和连线保留语义色；详情里的卡片与标签沿用语义色，追问区的警告与错误用红色提示。画布不再显示状态统计与手势提示条。

内置示例：`?example=pi-agent-lora`；由 `viewer/public/examples/index.json` 登记。
普通私有输入使用导入按钮，或忽略的 `viewer/public/local-data/<name>.json`（`?data=<name>`）。
生产构建只打包内置示例，排除 local-data。当前案例由公开案例目录统一登记。

## 四层缩放

### 状态关系和右侧详情

- “Version tree”按有证据的代码来源排成树。恢复旧版本成为旧版本的另一个子节点；被放弃的尝试仍保留。原始提交时间顺序可以切换到“Execution order”查看。
- 卡片绿色/红色分别表示相对时间上前一次测量的数值改善/退化，文字显示百分比。它不是统计显著性结论。紫色虚线表示恢复代码，紫色最终选择卡片引用历史测量，不伪装成新 benchmark。
- 初始显示可读的状态卡片；“Fit view”可查看整个版本结构。缩放仍逐层显示分支、行为和原始轨迹。
- 单击卡片或其标题自动打开右侧详情。这里包含完整描述、比较对象、版本来源、各类行为计数、可展开的内部行为、时间前后关系、变化证据和原始记录。双击或“View trace ↗”进入下一层。
- 状态可以附带 `lineage: {parent, relation, reason, events}`，relation 为 derived/restored/retained。没有证据时沿用已有状态转移，不能仅凭分数下降猜测发生了回退。
- 可选 `assessment` 提供 metric、unit、value、previous、previousState、higherIsBetter、tolerance、correctness、measurement、note；measurement=historical 禁止把历史评分计算为新的性能变化。

| 层级 | 默认范围 | 画布内容 |
| --- | --- | --- |
| 系统状态 | 小于 50% | 等高的紧凑状态卡片与实际变化 |
| 探索分支 | 50%–85% | 状态内部的探索方向、未尝试方案、分支间联系 |
| 具体行为 | 85%–115% | Explore / Plan / Edit / Execute / Verify / Diagnose，以及执行者、结果 |
| 原始轨迹 | 115% 以上 | 发言、思考、工具调用、工具结果、review 的原文卡片 |

边界使用小幅滞后，避免滚轮在临界点反复闪烁。工具栏是缩放到该层的快捷入口，
日常可用触控板捏合缩放、双指平移、拖动或双击深入。只有视图改变，原始数据不被折叠操作修改。

- 各层只为当前可见内容分配空间；隐藏的日志不再把总览拉成长条。切换层级时，保持鼠标下的卡片或其父状态在原位置。
- 行为层直接显示完整分析说明，卡片高度随文本在 340–640 之间调整；超长说明在卡片内滚动。原文卡片高度为 420、宽度为 360。
- 默认“Trackpad”：双指平移、捏合或 ⌘/Ctrl + 滚轮缩放。切换到“Mouse”后，滚轮直接缩放。
- 拖动空白处、卡片边框或标题可平移；按住空格也可以从正文区域拖动画布。正文保留文字选择和独立滚动。
- 缩放只更新画布变换和一处缩放样式，避免每一帧重新生成全部节点及原始记录。
- 原始记录显示实际事件 ID、模型、工具、源行和 call ID；缺失信息不猜测。
- 具体行为与原始轨迹节点显示 `Skill · 名称`。支持输入中的 `skill` 字段，以及原日志 `Skill` 工具调用的 JSON `skill` 参数；工具结果按同一会话的 call ID 继承。普通发言中的名称提及不当成调用。
- `tokens_in` 若存在，按范围显示“Input”、“Cumulative input”或“Session input”，单位为 tok，不是正文长度，也不重新估算。
- 一条原始事件可被多项分析引用；重复显示的是同一事件的引用，不是新执行。
- 主线、顺序为实线；审查与跨分支依据为虚线。缩小时聚合到分支，放大后恢复具体行为端点。
- 点击节点可查看状态差异、分类依据和证据。未归入行为的日志仍在原始记录库。
- 详情栏默认收起，通过工具栏“Details”打开；窄窗口中浮在画布右侧，不再占据底部空间。状态总览随窗口尺寸适应；放大后不会自动拉回总览。

## 通用输入约定 v1

支持三种 JSON：

1. `format: "coding-agent-state-trajectory"` 的独立 JSON（推荐）；
2. 旧版 `format: "thoughtdag-state-trajectory"`；
3. 旧画布节点 `data.stateTrajectory` 中的同一结构。

点击“Export complete trace”会生成中立格式 `agent-state-trajectory.json`，保留完整来源与扩展字段。

| 字段 | 含义 |
| --- | --- |
| `version`, `title`, `scope` | 版本 1、任务名、明确跟踪范围 |
| `states[]` | `id/title/events/snapshot`；snapshot 是任意组件名到文本或 null 的映射 |
| `branches[]` | `id/title/state/status/events`；status 为 attempted / retained / proposed / rejected |
| `actions[]` | `id/title/state/branch/behavior/actor/outcome/events`；actor 可为任意标识 |
| `transitions[]` | `source/target/action/label/changes`；changes 包含组件 before/after 和证据 |
| `links[]` | 行为间的 `source/target/kind/evidence/events`，包括 review_request / review_return / informs / sequence |
| `timeline.timeline[]` | 原始事件 `id/kind/text`，可附 actor/model/tool/source_line/call_id/tokens_in |
| `timeline.sources[]` | 完整源文件记录；保留但不会自动执行 |

摘要、次要行为标签、统计等缺省值由查看器补齐。导入时检查 ID、引用、快照差异及无环状态顺序；
不合法的文件显示错误，保留已打开的图。内容按文本渲染，不执行日志中的 HTML 或命令。

原始 JSONL 需要先经来源适配器和状态标注转换；当前不声称能从任意日志自动推断完整系统状态。
现有 `skills/tracevista-skill/scripts/build_state_graph.py` 导出可以直接使用。
同一代码哈希可能回滚后再次出现，这时应使用新的观察状态 ID，不能把时间历史画成状态循环。

只有成功的 Edit / Execute 且快照中确有差异，才能生成状态转换。
Verify 通过、review 通过、提出方案本身不等于代码变化。分支也不表示并行执行。

## 阅读层：每一步新增了什么、在哪里转向（可选）

借鉴 ThoughtDAG 的缩放摘要（ladder）、推理标记（move）、condense 折叠和连线避让。文件里没有阅读层时照常显示。

- **逐层展开的信息**：全图状态卡片保留 takeaway 和测量结果，不退化为提交编号。状态主题概括具体变化；工作阶段显示方向、结论和原因；行为层直接展示完整分析说明，原始记录在第四层展开。文件仍保留 topic ⊂ takeaway ⊂ brief 及证据摘句，详情区可查看引用。
- **没有写 ladder 的节点**：用标题和自身摘要生成，并删掉与父节点摘要重复的部分。
- **推理标记**：✕ 排除、◆ 决定、↪ 转向、? 未决、● 发现。总览中每个状态下方列出它的转向地标，点击即可跳转。没有标记的分支按常规工作显示为灰色。
- **依据边（informs）**：观察指向它改变的决定，用蓝色虚线表示，详情栏列出“Supporting observations”和“Decisions informed”。分支层只画同一状态内的依据边。
- **Decisions only**：默认开启。连续 3 步以上、既不是转向、也不是依据端点、也不产生新状态的行为，折叠成“N routine steps”，点击即可展开。这个模式下隐藏分支之间的时间顺序线，取消勾选“Decisions only”可显示全部行为。
- **历程**：总览左侧的一段话，说明从哪里开始、排除了什么、在哪里转向、落在哪里、还有什么没解决，引用的节点可以点击。
- **连线避让**：跨分支连线遇到卡片时会侧向弯曲绕开。
- **工具指纹**：⌨️ 运行、📖 读取、✏️ 编辑、🔍 搜索各自的调用次数，可以看出某个方向"读得多还是跑得多"。

字段说明和写作规范见 `skills/tracevista-skill/references/reading-layer.md`。阅读层属于分析者标注，不会替代原始证据。

## 追问这条轨迹（可选，浏览器直连模型）

工具栏“Chat”打开对话框，在“API settings”中选择供应商、填写 API Key，再获取或手填模型 ID。请求直接从浏览器发往所选模型接口，不经过查看器后端。

### 供应商与模型列表

| 类别 | 预设 |
| --- | --- |
| 云端 | Anthropic、OpenAI、OpenRouter、DeepSeek、Google AI Studio（Gemini）、Kimi、智谱/Z.ai、阿里百炼（Qwen）、MiniMax、Groq、Mistral |
| 地域 | Kimi 和 MiniMax 提供中国区/国际区；百炼提供北京/新加坡。Key 需与地域一致 |
| 本地 | Ollama、LM Studio |
| 自定义 | OpenAI Chat Completions 兼容接口、Anthropic Messages 兼容接口 |

大多数预设填好 key 后自动获取实时模型列表；模型输入框支持搜索选择，也始终允许手填。OpenRouter 的公开模型列表可不填 key，但聊天仍需 key。本地服务未启用认证时可留空。MiniMax 预设采用手填模型 ID，不把内置静态列表当成账号可用模型。自定义接口填好地址后，点击 ↻ 才请求模型列表。

“Test connection”只发送一条测试短句，使用与聊天相同的调用路径，不附带轨迹。模型列表成功并不代表模型请求成功。服务可能需要额度或 CORS 配置；网页会显示认证、限额、超时和空回复错误。推理模型在输出正文前显示“The model is thinking…”，不会把思考内容冒充最终回答。测试最多等待 60 秒，聊天最多 3 分钟，可随时停止。

配置读取兼容此前的 Anthropic/OpenAI 设置。切换供应商或修改地址时清空 key 和模型，避免跨服务复用凭据。Key 默认只留在当前对话框的内存中；勾选“Remember the key in this browser”后写入 localStorage，不写 cookie、不进入轨迹或聊天导出。关闭后重新打开时，未保存的 key 需重新填写。

本查看器采用浏览器直连，未接入 ThoughtDAG 的代理或订阅登录桥接。供应商须允许当前网页来源跨域访问；本地服务需先启动并配置 CORS。预设代表已适配请求格式，不代表各地区网络、账号权限与所有模型均已实测。Gemini 走其官方 OpenAI 兼容接口。

参考：ThoughtDAG `src/lib/runtime-providers.ts`、`src/lib/direct-llm.ts`；[Gemini 兼容接口](https://ai.google.dev/gemini-api/docs/openai)、[百炼地域地址](https://www.alibabacloud.com/help/en/model-studio/base-url)、[Ollama](https://docs.ollama.com/api/openai-compatibility)、[LM Studio](https://lmstudio.ai/docs/developer/openai-compat)。

- 不选卡片时问整条轨迹；在地图上点一张卡片，对话框就聚焦到这一步。
- 默认使用 Smart context（见下节）。手动选择“Up to this node (all contained records)”时：纳入节点内部的全部行为，以及同一会话中直到这些记录结束的完整历史。失败尝试、其他探索分支和被回退的版本仍保留；不按代码祖先关系筛选。状态和分支卡片按内部最后一条记录截止，原文包括 thinking 记录。
- 会话内使用原始记录顺序；各 agent 的相对分钟数不能用来推断跨会话先后。当前节点明确引用的会话各自取前缀；其他会话仅通过已纳入行为的证据或入向 `informs` 关联纳入具体记录。未关联的会话不自动视作历史。预览显示各会话边界；这属于分析者视角，不是原 agent 上下文的精确重放。
- “Up to this node (all contained records)”仅发送原始证据与节点归属映射，不发送可能包含后续结论的事后标题、ladder、assessment、notes、全局历程、独立来源附件或全局检索。不选卡片，或手动选择“Full run (including later outcomes)”，才纳入整条轨迹和事后大纲。
- 非智能模式默认使用“Full original text”，选定范围内的原文无单条截断和总长度截断。“Request context”展示会话范围、节点、逐条记录、带入的讨论轮数和 token 粗估，可下载完整请求（不含连接设置和 key）。Token 估算不是供应商 tokenizer 的精确结果。自动额度优先读取模型列表的 `context_window` / `context_length`，扣除本次请求的回复预留；官方 DeepSeek Flash / V4 Pro 在列表不可用时使用已核实的 1,048,576 窗口。其他未知模型暂用 96,000，并明确标记为本地默认值。手动额度按接口和模型保存，可恢复自动值；超额提示区分本地拦截与 API 返回错误，不会静默丢弃记录。
- 长轨迹可以手动选择“Historical excerpts · Current node in full”：较早记录超过 800 字时保留首尾、逐条标出省略；当前卡片的全部会话内跨度、原始用户指令仍完整。这是可审计的摘录，不是模型生成的语义总结；仍超额时可改用下述精简范围。
- “Current node only”：仅发送当前卡片及内部原文，不带历史原文、其他 review 或旧追问。
- “Current + previous + state summaries”：加上同一会话、同一层级里开始位置最近、且记录未越过当前截止点的前一节点原文（共享转换证据去重），以及当前跨度之前已确认的状态摘要。找不到明确前一节点时不猜测；不沿 Git 祖先边选择。状态摘要最多保留 1,200 字，标明省略，属于分析者事后整理，不能等同于 agent 当时知道的信息。不会递归展开历史状态内部记录。
- 两种精简范围都不重放旧追问；当前节点原文仍完整。状态或分支本身过大时应进入具体行为再问。预览显示前一节点、逐份状态摘要、实际记录和 token 粗估；切换卡片保留精简选项。
- 只带入同一节点、同一证据范围与内容的成功问答对；其他节点、全程复盘、失败或中断请求、旧版无范围标识的问答仍可阅读，但不会混入本次请求。
- 回答用 [[节点ID]]、[[事件ID]] 引用，点击即可定位卡片或打开原文；被引用的卡片在地图上高亮；记录里不存在的编号标红。
- 每一轮都记下发送了哪些节点和事件（system / chain / material / reference，对应 ThoughtDAG Context Bundle 的分层），“Export”得到 `trajectory-chat.json`，以后可以交给 ThoughtDAG 继续。
- 对话记录按轨迹标题保存在本机浏览器，“Clear”即可删除。

轨迹若是私有数据，使用前请确认数据方同意把内容发送给所选的模型服务。

## 智能上下文

追问区默认选择“Smart context”，可在“Context scope”下拉中切换；智能模式隐藏“Historical text handling”下拉框。同一个问题最多调用当前模型两次：

1. **阅读节点摘要**：发送系统状态、工作阶段、行为摘要，以及每条原始记录的编号、所属节点和 token 粗估。首轮不发送原始正文、引用摘录、附件或旧问答。模型返回需要阅读的事件 ID。
2. **阅读原始轨迹并回答**：校验事件 ID 和输入预算后，只发送所选记录的完整原文。界面先显示“The model is reading the selected records…”，收到接口的思考状态时显示“The model is thinking…”。

点击某个节点追问时，可选原文遵守该节点的会话内历史截止；整条轨迹提问可选择全程记录。摘要属于分析者的事后说明；含范围外证据的节点仅发送结构。每个问题独立选材，连续追问需写清指代对象。

两轮分别检查输入额度。无效编号、超额选择或取消会停止流程，不会自动退回发送全量，也不会截断选中的原文。若摘要与目录本身仍超额，可选择更早的节点或调整额度。

回复下方的“View evidence selection”展示选取理由、事件编号、实际发起的请求和各轮 token 粗估；编号可以打开原文。“Download first-round summaries and index”保存发送前的目录，聊天导出保留每次选材记录。

## 验证

仓库根目录：`pnpm test`，`pnpm build`。
覆盖四层投影、跨层位置保持、跨分支连接、原文完整性与顺序、旧格式兼容、无效输入、
示例路径以及 Pi Agent 完整导出文件的原文完整性。浏览器内仍需检查真实缩放、滚动与卡片导航。

## Generic structure and evidence (optional v1 observations)

The viewer and conversion skill communicate using a neutral, optional `observations` layer.
The six behaviors still describe actions. Seven observation kinds describe exploration
hierarchy, skill loads, review stages, knowledge, task lifecycle, measurements, and independent
conclusions. `observationLinks` preserves typed, evidence-backed relationships; chronology and
code ancestry remain separate in transitions/lineage. The viewer contains no LoRA/runner rules.

Use **Structure & evidence** for task-wide filtering/search. Click a state/action for its scoped records.
Exploration has a work-step/hypothesis/trial outline. Follow relation buttons to inspect
alternatives, reviews or knowledge reuse; evidence IDs open literal raw text, and **Locate** returns
to the action at raw zoom. Skill badges distinguish native call, guide output and source read.
Unknown versions remain unknown. Exact-subject status badges distinguish review, correctness,
performance and submission; descendant observations are counted but not promoted to a blanket
state PASS. Measurements preserve scope, protocol, baseline and historical/fresh distinction.
State color still uses an explicitly authored `assessment`; it never picks the largest metric
or mixes measurement scopes automatically.

The compiler contract and analyst guidance live in `skills/tracevista-skill/` and its
`references/observations.md`. Validators check references, types, hierarchy cycles, task/resource
identity, review-stage relationships, matching code identities for unchanged-code claims, and
outcome categories. They cannot prove that an analyst's semantic interpretation is true.
Source evidence remains the authority. Guide/source recognition is authored by the converter,
not guessed from keyword mentions by the renderer. Existing v1 files without this layer work.

Only the approved complete exports listed in the example catalog are bundled. Synthetic data under `viewer/scripts/fixtures/` is
used only by tests. Ordinary real imports stay in ignored local-data. The viewer contains no
agent/task-specific interpretation rules.

## 新轨迹的阅读层检查

仓库 skill 默认导出 `.agent-state.json`，并用 `--require-reading-layer` 检查状态、分支和关键行为的摘要以及历程说明。`--quality-report` 另外列出缺少原因、原文摘句和决定依据连线的位置；它检查结构覆盖，不能判断解释是否正确。缺少证据时保留缺口。

部分标注的图默认显示全部行为，Viewer menu 提示阅读层尚不完整。用户仍能主动选择“Decisions only”；完整标注的图才默认折叠常规行为。旧文件仍可导入。

模型选择使用真正的下拉框，不会按当前 ID 过滤列表。`name` / `display_name` 用于显示，请求始终使用 `id`。回复预留为 Anthropic 4,096 / OpenAI 兼容接口 16,384 tokens，并受接口报告的输出上限约束；请求同步携带相同的输出限制。窗口与输出额度共用，最终计数和限制由模型服务执行。

## 打开 tracevista-skill 生成的轨迹

默认流程是生成并验证完整 `.agent-state.json`，然后在用户浏览器的 [TraceVista](https://tracevista.pages.dev/) 中点击“Import trajectory”，选择本次生成的文件。有文件选择能力的浏览器工具可以由 agent 完成这一步，再检查状态总览、关键转向和原始记录。

无法操作浏览器时，agent 交付完整 JSON 和手动导入步骤，并说明尚未检查实际渲染。首页地址不会保存某条轨迹；重新打开时选择保存的 JSON。Pi Agent 示例用于了解界面，当前文件的检查需要实际导入该文件。

`create_view.py` 保留为显式选择的本地预览工具：它启动本机服务，在页面中加载所选查看器并传入完整文件。返回的 localhost URL 仅在同一台机器、服务运行期间有效。用法及导入协议见 [打开方式](../skills/tracevista-skill/references/opening.md)。

## Interface and trajectory language

The viewer uses English for navigation, controls, status labels, settings, and errors. Imported titles, summaries, reading layers, raw records, review comments, and attachments retain their original language. Chat replies follow the language of the question; quoted evidence stays in its source language.

## Interface type scale

`viewer/src/trajectory/interface.css` defines screen-space UI sizes in `rem`: controls and panel text use `.875rem`, captions use `.75rem`. Narrow layouts wrap controls and reposition panels instead of shrinking text. Browser zoom and the user's base font size remain effective. The landing page keeps its larger serif text; only the decorative TraceVista title uses a bounded fluid size.

Canvas card typography remains separate in `trajectory.css`: semantic zoom continues to reveal states, phases, actions and raw records without scaling the surrounding interface.

## Example library

The landing page has one **View examples** button. Hover, focus or click opens a named list; Escape or clicking outside closes it. Entries show their title and optional agent, task and date. The small catalog is bundled with the interface; full trajectory JSON is fetched only after an entry is selected.

`viewer/public/examples/index.json` lists the approved public examples. Update the catalog and its complete JSON files together, then rebuild and deploy. Tests reject unlisted files in the public example directory. The library contains **Pi Agent · Kernel Optimization**, **PostTrainBench**, **InferenceBench**, and **SWE-rebench**, with English analyst annotations and unchanged source evidence. The homepage lists the name, agent and task without dates. Each run overview introduces its task and recorded configuration.
