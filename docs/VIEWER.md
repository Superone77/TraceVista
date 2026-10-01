# Agent State Atlas · 本地 coding agent 状态与轨迹查看器

基于 ThoughtDAG 的本地 React Flow 画布，独立入口为 `trajectory.html`。
支持不同任务、agent 和 reviewer；不依赖某个优化实验。无需模型 key，不调用模型，不上传日志。

## 启动

在仓库根目录运行 `pnpm install --frozen-lockfile --ignore-scripts`，再运行 `pnpm dev`。
端口 8875，首页可选择 Pi 实例、合成例子或导入本地 JSON。完整复现与部署说明见 [README](../README.md)。

内置示例：`?example=pi-infra-r1` / `?example=parser`；由 `viewer/public/examples/index.json` 登记。
普通私有输入使用导入按钮，或忽略的 `viewer/public/local-data/<name>.json`（`?data=<name>`）。
生产构建只打包内置示例，排除 local-data。已获准收录的 Pi 是私有示例，部署时需保持访问范围。

## 四层缩放

### 状态关系和右侧详情

- “版本分支”按有证据的代码来源排成树。恢复旧版本成为旧版本的另一个子节点；被放弃的尝试仍保留。原始提交时间顺序可以切换到“执行顺序”查看。
- 卡片绿色/红色分别表示相对时间上前一次测量的数值改善/退化，文字显示百分比。它不是统计显著性结论。紫色虚线表示恢复代码，紫色最终选择卡片引用历史测量，不伪装成新 benchmark。
- 初始显示可读的状态卡片；“全图”可查看整个版本结构。缩放仍逐层显示分支、行为和原始轨迹。
- 单击卡片或其标题自动打开右侧详情。这里包含完整描述、比较对象、版本来源、各类行为计数、可展开的内部行为、时间前后关系、变化证据和原始记录。双击或“查看轨迹”进入下一层。
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
- 行为摘要卡片高度为 300，原文卡片高度为 420、宽度为 360；长正文在卡片内滚动。
- 默认“触控板”：双指平移、捏合或 ⌘/Ctrl + 滚轮缩放。切换到“鼠标”后，滚轮直接缩放。
- 拖动空白处、卡片边框或标题可平移；按住空格也可以从正文区域拖动画布。正文保留文字选择和独立滚动。
- 缩放只更新画布变换和一处缩放样式，避免每一帧重新生成全部节点及原始记录。
- 原始记录显示实际事件 ID、模型、工具、源行和 call ID；缺失信息不猜测。
- 具体行为与原始轨迹节点显示 `Skill · 名称`。支持输入中的 `skill` 字段，以及原日志 `Skill` 工具调用的 JSON `skill` 参数；工具结果按同一会话的 call ID 继承。普通发言中的名称提及不当成调用。
- `tokens_in` 若存在，明确显示“输入 tok”，不是正文长度，也不重新估算。
- 一条原始事件可被多项分析引用；重复显示的是同一事件的引用，不是新执行。
- 主线、顺序为实线；审查与跨分支依据为虚线。缩小时聚合到分支，放大后恢复具体行为端点。
- 点击节点可查看状态差异、分类依据和证据。未归入行为的日志仍在原始记录库。
- 详情栏默认收起，通过工具栏“详情”打开；窄窗口中浮在画布右侧，不再占据底部空间。状态总览随窗口尺寸适应；放大后不会自动拉回总览。

## 通用输入约定 v1

支持三种 JSON：

1. `format: "coding-agent-state-trajectory"` 的独立 JSON（推荐）；
2. 旧版 `format: "thoughtdag-state-trajectory"`；
3. 旧画布节点 `data.stateTrajectory` 中的同一结构。

点击“导出完整记录”会生成中立格式 `agent-state-trajectory.json`，保留完整来源与扩展字段。

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
现有 `skills/trajectory-to-thoughtdag/scripts/build_state_graph.py` 导出可以直接使用。
同一代码哈希可能回滚后再次出现，这时应使用新的观察状态 ID，不能把时间历史画成状态循环。

只有成功的 Edit / Execute 且快照中确有差异，才能生成状态转换。
Verify 通过、review 通过、提出方案本身不等于代码变化。分支也不表示并行执行。

## 验证

仓库根目录：`pnpm test`，`pnpm build`。
覆盖四层投影、跨层位置保持、跨分支连接、原文完整性与顺序、旧格式兼容、无效输入、
示例路径以及 Pi 完整导出文件的原文完整性。浏览器内仍需检查真实缩放、滚动与卡片导航。

## Generic structure and evidence (optional v1 observations)

The viewer and conversion skill communicate using a neutral, optional `observations` layer.
The six behaviors still describe actions. Seven observation kinds describe exploration
hierarchy, skill loads, review stages, knowledge, task lifecycle, measurements, and independent
conclusions. `observationLinks` preserves typed, evidence-backed relationships; chronology and
code ancestry remain separate in transitions/lineage. The viewer contains no LoRA/runner rules.

Use **结构与证据** for task-wide filtering/search. Click a state/action for its scoped records.
Exploration has a work-step/hypothesis/trial outline. Follow relation buttons to inspect
alternatives, reviews or knowledge reuse; evidence IDs open literal raw text, and 定位 returns
to the action at raw zoom. Skill badges distinguish native call, guide output and source read.
Unknown versions remain unknown. Exact-subject status badges distinguish review, correctness,
performance and submission; descendant observations are counted but not promoted to a blanket
state PASS. Measurements preserve scope, protocol, baseline and historical/fresh distinction.
State color still uses an explicitly authored `assessment`; it never picks the largest metric
or mixes measurement scopes automatically.

The compiler contract and analyst guidance live in `skills/trajectory-to-thoughtdag/` and its
`references/observations.md`. Validators check references, types, hierarchy cycles, task/resource
identity, review-stage relationships, matching code identities for unchanged-code claims, and
outcome categories. They cannot prove that an analyst's semantic interpretation is true.
Source evidence remains the authority. Guide/source recognition is authored by the converter,
not guessed from keyword mentions by the renderer. Existing v1 files without this layer work.

Synthetic example: `/?example=parser`. It contains all seven observation kinds and invented
numbers for UI testing. The private Pi example is authorized and bundled; ordinary real imports
stay in ignored local-data. The viewer contains no Pi/LoRA-specific interpretation rules.
