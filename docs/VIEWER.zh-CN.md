# TraceVista · coding agent 状态与轨迹查看器

[English](VIEWER.md) · **简体中文**

受 ThoughtDAG 启发的 React Flow 画布，独立入口为 `trajectory.html`。
支持不同任务、agent 和 reviewer；不依赖某个优化实验。浏览与导入无需模型 key；可选 Chat 使用用户配置的模型。

## 打开

直接打开[云端 TraceVista](https://tracevista.pages.dev/)，点击“Import trajectory”选择完整的 `.agent-state.json`。
原始日志先用 `tracevista-skill` 转换，安装与使用见 [README](../README.zh-CN.md#导入你自己的轨迹)。网站首页的“Example Trajectories”展示案例卡片，点击即可打开。

本地开发时，在仓库根目录运行 `pnpm install --frozen-lockfile --ignore-scripts`，再运行 `pnpm dev`，访问 `http://127.0.0.1:8875/`。默认是无需示例库的独立查看器，可直接导入轨迹；首页提供网站示例链接。本地运行带示例的展示站使用 `pnpm dev:site`，数据获取和版本锁定见[示例库说明](EXAMPLES.md)。

打开轨迹后仅显示顶部工具栏，品牌、任务标题和副标题不占用画布空间（标签页仍保留任务名称）。顶部保留四层快捷按钮、Story、Play 和 Chat；导入、导出、返回首页及其他设置位于左上角 ☰ Viewer menu。点卡片或 Chat 引用时，Story 与 Map 同步定位。界面使用深浅灰色，轨迹内部保留语义色，追问区的警告与错误用红色提示。

**Play** 按状态、工作阶段和关键动作带读，支持暂停、前后跳转、调速和打开原文；退出恢复原来的视图。Chat 根据问题优先生成带证据链接的流程图或对比表。转换 skill 的说明文字采用操作、观察、决定的清晰表达，展开 Story 后可读完整解释。用法和格式见 [Explanations and playback](EXPLANATIONS-AND-PLAYBACK.md)。

展示站示例：`?example=pi-agent-lora`；由独立 `TraceVista-examples` 仓库的 `examples/index.json` 登记，通过查看器的 `examples.lock.json` 固定数据提交与文件哈希。
普通私有输入使用导入按钮，或忽略的 `viewer/public/local-data/<name>.json`（`?data=<name>`）。
`pnpm build` 生成 `dist/`，不含案例；`pnpm build:site` 生成带锁定案例的 `dist-site/`。两种生产构建都排除 local-data，并包含 `tracevista-release.json` 版本记录。

## 四层缩放

### 状态关系和同步阅读

- “Version tree”按有证据的代码来源排成树。恢复旧版本成为旧版本的另一个子节点；被放弃的尝试仍保留。原始提交时间顺序可以切换到“Execution order”查看。
- 卡片绿色/红色分别表示相对时间上前一次测量的数值改善/退化，文字显示百分比。它不是统计显著性结论。紫色虚线表示恢复代码，紫色最终选择卡片引用历史测量，不伪装成新 benchmark。没有测量的状态不再显示“No comparable measurement”。
- **交付主线**：时间顺序的终点（没有后续转换的状态）记为交付状态，标“Delivered”并加紫色外圈。从它沿当前状态关系向上追到根，得到交付主线：主线连线加粗，主线外的状态与其内部卡片变淡并标“Side branch”，鼠标指向或选中时恢复。完全线性的运行不画支线。首屏按主线的横向跨度取景，缩放不低于 26%。
- 状态卡右上角写这一步做了多少动作、主要是哪两类行为（如“42 actions · mostly Edit & Diagnose”）。状态编号 S0、S1… 按状态出现的先后，不随版本树的排布顺序变化。
- 初始显示可读的状态卡片；“Fit view”可查看整个版本结构。缩放仍逐层显示分支、行为和原始轨迹。
- 卡片高度按自己的内容估算，不再用固定高度：总览层的状态卡按结论的长度、有无测量和关键决策决定（150 到 380），总览卡上的缩放文字最低停在结论这一档；缩放低于 36% 时改为紧凑卡，按当时的缩放算出能放几行，依次放编号、结论、理由、测量和决策标签，放不下的从后往前省略，行数只在增减一整行时重算；工作阶段层每个状态的一行阶段卡取这一行里最长那张的高度（170 到 350），保持对齐。
- 单击卡片会选中该节点，并在 Story 中展开和定位到对应内容；打开 Chat 时，这个节点也成为追问焦点。Story 逐层展示解释、工作阶段、动作和完整原文。点击证据编号会同步定位 Story 中的原文和地图中的关联动作。双击卡片进入下一层。
- 状态可以附带 `lineage: {parent, relation, reason, events}`，relation 为 derived/restored/retained。没有证据时沿用已有状态转移，不能仅凭分数下降猜测发生了回退。
- 可选 `assessment` 提供 metric、unit、value、previous、previousState、higherIsBetter、tolerance、correctness、measurement、note；measurement=historical 禁止把历史评分计算为新的性能变化。

| 层级 | 默认范围 | 画布内容 |
| --- | --- | --- |
| 系统状态 | 小于 50% | 高度随内容调整的状态卡片与实际变化 |
| 工作阶段 | 50%–85% | 状态内部的探索方向、未尝试方案、分支间联系 |
| 具体行为 | 85%–115% | Explore / Plan / Edit / Execute / Verify / Diagnose，以及执行者、结果 |
| 原始轨迹 | 115% 以上 | 发言、思考、工具调用、工具结果、review 的原文卡片 |

边界使用小幅滞后，避免滚轮在临界点反复闪烁。工具栏是缩放到该层的快捷入口，
日常可用触控板捏合缩放、双指平移、拖动或双击深入。只有视图改变，原始数据不被折叠操作修改。

- 各层只为当前可见内容分配空间；隐藏的日志不再把总览拉成长条。没有记录工作阶段的状态在细节层只保留标题区高度。缩放切换层级时，保持鼠标下的卡片或其父状态在原位置。
- 工具栏层级按钮的落点：工作阶段层把目标状态的标题和阶段行放在顶部；动作层把目标所在列的阶段卡放在顶部，横向从该状态第一列开始尽量多显示几列，目标列始终在屏幕内；原始记录层直接从目标卡片开始。未选中卡片时，取离屏幕中心最近、且有工作阶段的状态。
- 行为层直接显示完整分析说明，卡片高度随文本在 340–640 之间调整；超长说明在卡片内滚动。原文卡片高度为 420、宽度为 360。
- 默认“Trackpad”：双指平移、捏合或 ⌘/Ctrl + 滚轮缩放。切换到“Mouse”后，滚轮直接缩放。
- 拖动空白处、卡片边框或标题可平移；按住空格也可以从正文区域拖动画布。正文保留文字选择和独立滚动。
- 缩放只更新画布变换和一处缩放样式，避免每一帧重新生成全部节点及原始记录。
- 原始记录显示实际事件 ID、模型、工具、源行和 call ID；缺失信息不猜测。
- 具体行为与原始轨迹节点显示 `Skill · 名称`。支持输入中的 `skill` 字段，以及原日志 `Skill` 工具调用的 JSON `skill` 参数；工具结果按同一会话的 call ID 继承。普通发言中的名称提及不当成调用。
- `tokens_in` 若存在，按范围显示“Input”、“Cumulative input”或“Session input”，单位为 tok，不是正文长度，也不重新估算。
- 一条原始事件可被多项分析引用；重复显示的是同一事件的引用，不是新执行。
- **连线按三种关系分工**：总览层按版本树画，深绿实线箭头是代码的继承（主线加粗，支线变淡），紫色虚线加 ↶ 是回退到旧版本。进入状态以后以时间为轴：工作阶段按开始时间从左到右排列并编号（方框数字），先后相接的阶段之间画灰色实线箭头，开始时前一个阶段还没结束的标「同时进行」（灰色点线、不带箭头）；做出改动的那个阶段（动作层是那个动作）用绿色实线连到它产生的下一个版本；同一阶段里的动作自上而下用细箭头相连。版本关系在状态内退为状态框之间的淡色宽带，只有回退处标 ↶。数据里跨阶段的先后记录不再另画一遍。
- **原因按需出现**：蓝色虚线「因为」只在鼠标指向或选中的卡片上画出；平时卡片顶部有一个「因为 N」标记，表示这一步有 N 条依据。
- **聚焦**：在工作阶段层及以下选中一张卡片，它的上一步、下一步、依据、产生的版本和所在状态保持清楚，其余卡片和连线变淡；点空白处取消。
- 节点的解释和原文通过 Story 阅读。未归入动作的记录仍保留在导出文件中，引用这些记录时会在 Story 中单独显示。
- Chat 位于画布右侧，拖动它的左边缘可调整宽度。点击卡片或对话引用会同步定位 Story 和地图。关闭 Chat 会中断尚未完成的请求；已记录的对话保留在浏览器。窄窗口里，Chat 可能覆盖部分画布。
- 侧栏开合使画布变宽或变窄时，视野保持居中，选中的卡片留在屏幕内。整体空间不足以容纳 Story 和地图的最小宽度时，Story 自动收起，变宽后恢复。状态总览随窗口尺寸适应；放大后不会自动拉回总览。

## 通用输入约定 v1

支持三种 JSON：

1. `format: "coding-agent-state-trajectory"` 的独立 JSON（推荐）；
2. 旧版 `format: "thoughtdag-state-trajectory"`；
3. 旧画布节点 `data.stateTrajectory` 中的同一结构。

点击“Export complete trace”会生成中立格式 `agent-state-trajectory.json`，保留完整来源与扩展字段。

点击顶部“导出”（Export）按钮，会下载以轨迹标题命名的单个 `.html` 文件。直接用浏览器打开即可离线查看地图、故事线、播放和原始记录，无需启动服务。文件内嵌查看器、样式、字体、完整轨迹和导出时的界面语言；打开时从总览开始，不保存临时选中项、缩放位置或聊天对话。导出的页面保留故事线、播放、层级切换和语言切换按钮，隐藏左上角菜单及右上角的导出和对话按钮。模型连接配置和 API Key 不会写入文件。

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

- **逐层展开的信息**：全图状态卡片保留 takeaway 和测量结果，不退化为提交编号。状态主题概括具体变化；工作阶段显示方向、结论和原因；行为层直接展示完整分析说明，原始记录在第四层展开。文件仍保留 topic、takeaway、完整说明及证据摘句。
- **没有写 ladder 的节点**：用标题和自身摘要生成，并删掉与父节点摘要重复的部分。
- **推理标记**：✕ 排除、◆ 决定、↪ 转向、? 未决、● 发现。总览中每个状态下方列出它的关键决策，点击即可跳转。关键决策按运行先后统一编号：每个状态取工作阶段层的排除、决定、转向、未决；不足两个时补动作层的，最多四个。同一编号出现在左栏、状态卡、阶段卡和动作卡里。没有标记的分支按常规工作显示为灰色。
- **依据边（informs）**：观察指向它改变的决定，用蓝色虚线表示，可沿连线定位相关节点。分支层只画同一状态内的依据边。
- **Decisions only**：默认开启。连续 3 步以上、既不是转向、也不是依据端点、也不产生新状态的行为，折叠成“N routine steps”，点击即可展开。这个模式下隐藏分支之间的时间顺序线，取消勾选“Decisions only”可显示全部行为。
- **左栏 Story（故事线）**：固定在地图左侧，各层都在。整次运行写成一篇可以伸展的文字（StretchText），排版是阅读页的样式：暖白纸色、正文、页边一条细线串起各步。顺序是：Summary 下的两句概况（“More”在原处展开其余部分和它引用的节点）；Outcome 下的最终结果；每个状态一句，写它得出了什么、为什么。点一句话，下一层在这句话后面长出来，后面的文字往下让：状态展开成工作阶段，阶段展开成动作，动作展开成关联的全部原始记录。原始记录按源日志顺序显示，保留完整文字、记录 ID、消息或工具调用/返回类型、来源行号、call ID，以及日志里已有的模型、token 和 skill 信息；长记录在动作内滚动阅读，原文只读，不截断。点击记录 ID 会定位 Story 中的原文和地图中的关联动作。决策写成动词（Changed course、Ruled out、Decided、Left open、Found）并带全局编号；动作写成 Looked into、Planned、Changed、Ran、Checked、Diagnosed；没有阅读层标注的常规动作折成“…and N routine steps”。实心点是主线，空心点是被放下的尝试（写“A side attempt”），紫点是交付。工具栏的“Story”按钮收起或打开左栏；整体空间不足以容纳 Story 和地图的最小宽度时自动收起，变宽后恢复。
- **统一展开层级**：工具栏的四个按钮同时控制地图层级和 Story 的展开深度。“System states”收起各状态内部内容；“Work phases”展开所有状态；“Actions”继续展开所有工作阶段；“Raw records”展开所有动作的完整原始记录。每一句仍可以单独展开或收起，之后点击层级按钮会重新统一展开到所选深度。
- **左栏宽度**：拖动左栏右边缘调整宽度（最窄 280 像素，没有固定上限，地图至少保留 240 像素；打开右栏或缩小窗口时自动收窄）；聚焦右边缘后可用左右方向键调整（每次 16 像素，按住 Shift 为 64 像素），Home、End 到最窄、最宽；双击右边缘回到默认宽度。宽度记在这个浏览器里，刷新后保留。
- **飞行定位**：在故事线里展开一句时，地图镜头飞到同一处，深度与文字一致：交付句到总览层的终点状态，状态到工作阶段层（一行比屏幕宽时从左边开始），阶段到动作层的那一列，动作到原始记录层的那张卡。同一层内平滑平移缩放；跨层时先在屏幕中心处换上目标层的布局再飞，途中不按缩放切换层级，读者自己拖动或缩放即刻接管。工具栏层级按钮、对话引用和证据跳转用同一种飞行；系统设置减少动态效果时直接跳到目标。反过来，在地图上点卡片，故事线展开到这张卡所在的那一句并滚过去。
- **过渡**：层级切换时新出现的卡片在落点淡入；左栏和对话里的展开都是高度与透明度一起过渡。系统设置减少动态效果时不做动画。
- **图例**：默认收成左下角的“Legend”按钮，点击后展开，× 收起。
- **连线避让**：跨分支连线遇到卡片时会侧向弯曲绕开。状态之间的线（版本带、产生下一个版本）只走框与框之间的空隙：先向下出框进入框下方的空隙，再沿一条不穿过其他框的竖向通道走到目标；目标在下方时从顶部进入，与来源同一行时从朝向来源的一侧进入。动作层从动作右侧出发，先沿泳道之间的空隙下行。
- **工具指纹**：⌨️ 运行、📖 读取、✏️ 编辑、🔍 搜索各自的调用次数，可以看出某个方向"读得多还是跑得多"。

字段说明和写作规范见 `skills/tracevista-skill/references/reading-layer.md`。阅读层属于分析者标注，不会替代原始证据。

## 追问这条轨迹（可选，浏览器直连模型）

工具栏“Chat”打开对话框。未连接模型时，对话区只显示一张“Connect a model”卡片；点击它或标题栏的模型按钮（连接后显示模型名）展开设置，选择供应商、填写 API Key，再获取或手填模型 ID。导出与清空收在标题栏的“⋯”菜单里。上下文范围、额度和请求预览折叠成输入框上方的一行“Context · … · ~N tokens”，点击展开。请求直接从浏览器发往所选模型接口，不经过查看器后端。

### 供应商与模型列表

| 类别 | 预设 |
| --- | --- |
| 云端 | Anthropic、OpenAI、OpenRouter、DeepSeek、Google AI Studio（Gemini）、Kimi、智谱/Z.ai、阿里百炼（Qwen）、MiniMax、Groq、Mistral |
| 地域 | Kimi 和 MiniMax 提供中国区/国际区；百炼提供北京/新加坡。Key 需与地域一致 |
| 本地 | Ollama、LM Studio |
| 自定义 | OpenAI Chat Completions 兼容接口、Anthropic Messages 兼容接口 |

大多数预设填好 key 后自动获取实时模型列表；模型下拉框显示完整列表，也允许手填模型 ID。OpenRouter 的公开模型列表可不填 key，但聊天仍需 key。本地服务未启用认证时可留空。MiniMax 预设采用手填模型 ID，不把内置静态列表当成账号可用模型。自定义接口填好地址后，点击 ↻ 才请求模型列表。

“Test connection”只发送一条测试短句，使用与聊天相同的调用路径，不附带轨迹。模型列表成功并不代表模型请求成功。服务可能需要额度或 CORS 配置；网页会显示认证、限额、超时和空回复错误。推理模型在输出正文前显示“The model is thinking…”，不会把思考内容冒充最终回答。连接测试最多等待 60 秒，直接聊天最多 3 分钟，Smart context 的两轮请求合计最多 6 分钟，可随时停止。

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
- 回答用 [[节点ID]]、[[事件ID]] 引用，点击后 Story 与地图同步定位到节点或原文；不存在的编号标红。智能上下文选中的节点仅在展开“View evidence selection”时高亮，收起后解除。
- 每一轮都记下发送了哪些节点和事件。“Export conversation”导出 `trajectory-chat.json`，保留对话、上下文和证据选择记录，不包含连接设置或 key。
- 对话记录按轨迹标题保存在本机浏览器，“Clear”即可删除。

图片内容会从对话上下文中排除，原图仍保留在导入文件和查看器中。密钥存储和漏洞报告方式见 [SECURITY.md](../SECURITY.md)。

## 智能上下文

追问区默认选择“Smart context”，可在“Context scope”下拉中切换；智能模式隐藏“Historical text handling”下拉框。同一个问题最多调用当前模型两次：

1. **阅读节点摘要**：发送系统状态、工作阶段、行为摘要，以及每条原始记录的编号、所属节点和 token 粗估。首轮不发送原始正文、引用摘录、附件或旧问答。模型返回需要阅读的事件 ID。
2. **阅读原始轨迹并回答**：校验事件 ID 和输入预算后，只发送所选记录的完整原文。界面先显示“The model is reading the selected records…”，收到接口的思考状态时显示“The model is thinking…”。

点击某个节点追问时，可选原文遵守该节点的会话内历史截止；整条轨迹提问可选择全程记录。摘要属于分析者的事后说明；含范围外证据的节点仅发送结构。每个问题独立选材，连续追问需写清指代对象。

两轮分别检查输入额度。无效编号、超额选择或取消会停止流程，不会自动退回发送全量，也不会截断选中的原文。若摘要与目录本身仍超额，可选择更早的节点或调整额度。

回复下方的“View evidence selection”展示选取理由、事件编号、实际发起的请求和各轮 token 粗估；编号可以打开原文。“Download first-round summaries and index”保存发送前的目录，聊天导出保留每次选材记录。

## 验证

仓库根目录：`pnpm test`，`pnpm build`。
默认检查使用小型测试数据，覆盖四层投影、跨层位置保持、跨分支连接、原文完整性与顺序、旧格式兼容、无效输入和示例路径，不依赖外部示例库。
完整案例使用 `pnpm test:examples` 检查，展示站使用 `pnpm build:site` 构建。浏览器内仍需检查真实缩放、滚动与卡片导航。这些检查不重跑原始模型或 benchmark。

## Generic structure and evidence (optional v1 observations)

The viewer and conversion skill communicate using a neutral, optional `observations` layer.
The six behaviors still describe actions. Seven observation kinds describe exploration
hierarchy, skill loads, review stages, knowledge, task lifecycle, measurements, and independent
conclusions. `observationLinks` preserves typed, evidence-backed relationships; chronology and
code ancestry remain separate in transitions/lineage. The viewer contains no LoRA/runner rules.

Exploration can describe work steps, hypotheses and parameter trials. These structured records
and their relations remain in the complete export. Use Story and Map to inspect the annotated
nodes and follow evidence IDs to the original text. Skill badges distinguish native call, guide output and source read.
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

The standalone viewer contains no example exports. Showcase builds include only the approved assets pinned from the separate example library. Synthetic data under `viewer/scripts/fixtures/` is used only by tests. Ordinary real imports stay in ignored local-data. The viewer contains no agent/task-specific interpretation rules.

## 新轨迹的阅读层检查

仓库 skill 默认导出 `.agent-state.json`，并用 `--require-reading-layer` 检查状态、分支和关键行为的摘要以及历程说明。`--quality-report` 另外列出缺少原因、原文摘句和决定依据连线的位置；它检查结构覆盖，不能判断解释是否正确。缺少证据时保留缺口。

部分标注的图默认显示全部行为，Viewer menu 提示阅读层尚不完整。用户仍能主动选择“Decisions only”；完整标注的图才默认折叠常规行为。旧文件仍可导入。

模型选择使用真正的下拉框，不会按当前 ID 过滤列表。`name` / `display_name` 用于显示，请求始终使用 `id`。回复预留为 Anthropic 4,096 / OpenAI 兼容接口 16,384 tokens，并受接口报告的输出上限约束；请求同步携带相同的输出限制。窗口与输出额度共用，最终计数和限制由模型服务执行。

## 打开 tracevista-skill 生成的轨迹

默认流程是生成并验证完整 `.agent-state.json`，然后在用户浏览器的 [TraceVista](https://tracevista.pages.dev/) 中点击“Import trajectory”，选择本次生成的文件。有文件选择能力的浏览器工具可以由 agent 完成这一步，再检查状态总览、关键转向和原始记录。

无法操作浏览器时，agent 交付完整 JSON 和手动导入步骤，并说明尚未检查实际渲染。首页地址不会保存某条轨迹；重新打开时选择保存的 JSON。Pi Agent 示例用于了解界面，当前文件的检查需要实际导入该文件。

`create_view.py` 保留为显式选择的本地预览工具：它启动本机服务，在页面中加载所选查看器并传入完整文件。返回的 localhost URL 仅在同一台机器、服务运行期间有效。用法及导入协议见 [打开方式](../skills/tracevista-skill/references/opening.md)。

## Interface and trajectory language

The EN / 中文 toggle in the toolbar (and on the home page) switches the interface and everything that was written about the run: titles, summaries, ladders, the story rail, the run overview, scope and notes, reasons, classification notes and observation summaries. What the agent itself said or received stays as recorded: raw records and the verbatim quotes taken from them are never translated. English is the default; the choice is remembered in this browser and sets the page language. Chat replies follow the language of the question. The two prompts on the home page stay in English because they are pasted into an agent as commands. Some advanced chat context notes and provider error messages remain in English.

**Interface strings.** English text is the key: components call `t('English text')`, and Chinese lives in `viewer/src/trajectory/i18n.zh.json`, so component sources stay English-only (`test-ui-language.mjs`). `viewer/scripts/i18n-keys.mjs` reads every key from the source with the TypeScript parser; `test-i18n.mjs` requires a Chinese entry with the same placeholders for each key and rejects entries no key uses.

**Generated text.** A trajectory may carry `"i18n": {"zh": {"<text as written>": "<translation>"}}`. The viewer swaps each annotated string for its translation when the interface language differs from the file's own `language`; a ladder topic stays inside its translated takeaway. Export writes the file as imported, translations included; chat reads the original. Translation tables travel with each external example export. The Pi Agent example test checks that every key of its table is an annotation in that file.

## Interface type scale

`viewer/src/trajectory/interface.css` defines screen-space UI sizes in `rem`: controls and panel text use `.875rem`, captions use `.75rem`. Narrow layouts wrap controls and reposition panels instead of shrinking text. Browser zoom and the user's base font size remain effective. The landing page keeps its larger text size; only the decorative TraceVista title uses a bounded fluid size.

Canvas card typography remains separate in `trajectory.css`: semantic zoom continues to reveal states, phases, actions and raw records without scaling the surrounding interface.

One family for everything read or clicked, one for literal text: `--font-sans` (Inter, then PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC) and `--font-mono` (SF Mono, ui-monospace, Menlo, Consolas), both defined on `:root` in `trajectory.css`. Raw records, code and quoted source text use the mono family; every other surface, including the story rail and the home page, uses the sans family. No web fonts are fetched beyond the bundled Inter.

## Example library

The standalone landing page links to examples on the [TraceVista website](https://tracevista.pages.dev/#examples). A showcase build displays thumbnail cards under **Example Trajectories**, with the case name, agent, and task. It includes the small catalog with the interface and fetches a full trajectory JSON only after a case is selected.

The separate `TraceVista-examples` repository holds `examples/index.json`, six complete exports, thumbnails, and their source notices. The cases are **Pi Agent · Kernel Optimization**, **Claude Code · Post Training**, **Codex · Model Serving**, **OpenHands · Bug Fixing**, **Tongyi DeepResearch · Literature Research**, and **Codex · Garden Animation**. Each run overview introduces its task and recorded configuration; annotations stay separate from the unchanged source evidence. Garden Animation covers only events `continued:E853` through `continued:E1098` of its longer session.

Set `TRACEVISTA_EXAMPLES_DIR` to that repository root or use the sibling `../TraceVista-examples`. `examples.lock.json` in the viewer records its data commit and asset hashes. Update and commit the data before refreshing the viewer lock. Full setup, validation, and release steps are in [EXAMPLES.md](EXAMPLES.md).
