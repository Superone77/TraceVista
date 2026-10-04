# TraceVista

**把 coding agent 的日志变成可以逐层放大的状态与执行地图。**

缩小时看系统状态和版本分叉；放大后依次看到探索方向、具体行为、原始 trajectory。
点击卡片，右侧展示描述、内部行为、代码来源、时间关系、测量和原始证据。

本仓库包含受 ThoughtDAG 启发、基于 React Flow 开发的独立可视化引擎、`tracevista-skill` 转换 skill，
以及完整导出的 **Kernel Design Agent (KDA) / W8A16** 和 **PostTrainBench / Fable 5 / AIME 2025** 真实轨迹。
工具面向不同 coding agent 和任务，任务描述及证据保存在导出数据中。

## 1. 打开 TraceVista

打开[云端查看器](https://tracevista.pages.dev/)，点击“Import trajectory”选择完整的 `.agent-state.json`。
如果手上是 Claude Code、Codex 或 Pi 的原始日志，先按[第 5 节](#5-用-tracevista-skill-生成和修改轨迹)安装 skill 并转换。

### 本地开发与示例

本地运行引擎需要 **Node.js 24.x、pnpm 11.19.0**。转换日志或跑 skill 测试需要 **Python ≥ 3.10**。

```bash
git clone https://github.com/Superone77/trajactory_visualizer.git
cd trajactory_visualizer

# 如果尚未安装 pnpm（Node 安装包一般附带 npm）
npm install -g pnpm@11.19.0

pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

打开：

- **KDA 真实轨迹：** http://127.0.0.1:8875/?example=kda-w8a16-r1
- **PostTrainBench 真实轨迹：** http://127.0.0.1:8875/?example=posttrainbench-fable5-aime
- 首页 / 本地 JSON 导入：http://127.0.0.1:8875/

首页的 **View examples ▾** 在悬停、键盘聚焦或点击时展示案例列表；选中后才加载完整 JSON。首次加载先显示状态卡片；在 Viewer menu 中点击“Fit view”查看完整版本树。
`trajectory.html` 保留为兼容入口。若 8875 被占用，先停止占用它的开发服务器，或手动用
`pnpm exec vite --config viewer/vite.config.ts --host 127.0.0.1 --port 8876 --strictPort` 更换端口。

## 2. 怎么读图

| 层级 / 操作 | 看到什么 |
|---|---|
| 系统状态 | 代码或产物状态；绿色 / 红色表示同口径测量值改善 / 退化，紫色表示引用历史结果的最终选择 |
| 工作阶段 | 一个状态下提出或尝试的方向，执行先后可在时间线中查看 |
| 具体行为 | Explore、Plan、Edit、Execute、Verify、Diagnose；执行者身份独立于行为类型 |
| 原始轨迹 | 原始思考、发言、工具输入和返回；长正文可在卡片内滚动 |
| 点击卡片 | 右侧详情、版本来源、内部行为、原始证据及跳转 |
| “Version tree / Execution order” | 分别查看代码来自哪个版本，以及实际先后顺序 |
| “Structure & evidence” | 全任务搜索与筛选：探索、Skill、review、经验读写、TODO、测量和独立结论 |

触控板默认双指平移、捏合缩放；鼠标模式用滚轮缩放。空白处拖动或按空格拖动画布。
工具栏的四个层级按钮可以直接跳转。读日志时可选中复制文本。

KDA 示例的状态卡片跟踪已提交候选的 Git tree、提交编号和最终选中状态。
编辑、测试和回退过程在行为层展开，状态连线对应实际发生的变化。

### 阅读层（借鉴 ThoughtDAG）

KDA 示例带有完整的阅读层：每个状态、分支以及大多数行为都写了随缩放生长的摘要，转向地标标注了排除、决定、转向或未决，31 条依据边从观察指向它改变的决定，总览左侧还有一段历程。“Decisions only”模式下，常规步骤会折叠起来。说明见 [查看器文档](docs/VIEWER.md)，写作规范见 [reading-layer.md](skills/tracevista-skill/references/reading-layer.md)。

工具栏“Chat”可以用自己的 key 直接从浏览器问这条轨迹，回答会引用节点和原始事件，并在地图上高亮被引用的卡片。默认关闭，私有轨迹使用前请先确认数据方同意。 支持 Anthropic、OpenAI、Gemini、DeepSeek、Kimi、GLM、Qwen、MiniMax 等供应商与本地模型，可获取模型列表或手填 ID，并用“Test connection”检查连接。详见 [模型接口设置](docs/VIEWER.md#供应商与模型列表)。

## 3. Kernel Design Agent (KDA) example

This W8A16 run uses Claude Opus 5.5 / high as the main agent and GPT-6-sol / high for two Codex reviews on an A100 40GB. The English reading layer covers 8 system states, 25 work phases and 99 actions. The complete export retains 1,919 main-session records, 63 reviewer records, and 20 explicitly identified controller artifact records.

| Submission | Candidate | Development correctness | Development speedup |
|---|---|---|---:|
| 1 | v9: fused dequantization and direct launch | Passed | 13.122027× |
| 2 | v13: bitwise conversion and configuration changes | Passed | 15.784736× |
| 3 | v14: host dispatch changes | Passed | 15.765494× |
| 4 | v15: split rules across shapes | Passed | 16.178644× |
| 5 | v18: precision-path and grid changes | Passed | 20.556049× |
| 6 | The same v18 code, submitted again | Passed | 15.920750× |

Submissions 5 and 6 have identical code trees. The lower repeated score is a measurement change, not a code rollback. Finalization selects submission 5's historical best record. The independent correctness suite passes; independent Oracle ABBA speedup is **2.215205×**. The separate runner baseline speedup is **15.938802×** and uses a different comparison protocol. Static reviews still leave a large-shape precision risk, and no third review after the fixes was observed.

Titles, summaries and analyst notes are English; raw messages, commands, results and evidence attachments are preserved verbatim. This updates the visualization of an existing run; it does not rerun the benchmark.

Complete export: [kda-w8a16-r1.agent-state.json](viewer/public/examples/kda-w8a16-r1.agent-state.json).

### PostTrainBench example

Selected on **2026-10-04** from the public [PostTrainBench trajectories](https://huggingface.co/datasets/aisa-group/PostTrainBench-Trajectories), this run uses **Fable 5 Max / Claude Code / 1M context** to post-train **Qwen3-4B-Base on AIME 2025**, with one H100 and a ten-hour budget: run 1, job `17337591`. The final model averages three checkpoints (`checkpoint-980`, `checkpoint-1120`, and `final`) from supervised fine-tuning on decontaminated AceReason data into `soup_last3`.

| Result | Score | Scope |
|---|---:|---|
| Selected checkpoint soup | 23.3% | Pooled development evaluations recorded in the trace |
| Archived final result | 30.0% | Published single-run `metrics.json` |
| Fable 5 / Qwen3-4B / AIME 2025 | 21.0% | Current v1.2 aggregate |
| Qwen3-4B-Base reference | 3.33% | Official published base-model baseline |

At selection time, Fable 5 ranked **#5 overall (37.27% ± 1.65%)** on the [v1.2 leaderboard](https://posttrainbench.com/) and was the highest-ranked agent with trajectories in this public corpus. The selected run led the corpus's unflagged AIME 2025 / Qwen3-4B entries. Current global leader Fable 5.1 had no published trajectory there. The archived 30% result predates v1.2's multi-seed reevaluation; its contamination, model identity, API-use, and benchmark-lookup judgments report no violation.

The export adds English state, work-phase and action annotations while preserving source messages and evidence. Source revision: `386b3034fa26f0f1b3ae3bfded99b791f0b254a6`; dataset license: Apache 2.0. Attribution and modification details are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Complete export: [posttrainbench-fable5-aime.agent-state.json](viewer/public/examples/posttrainbench-fable5-aime.agent-state.json).

## 4. 验证和部署

```bash
# Python 标准库即可，无 pip 依赖；含 skill、查看器、原文完整性和完整示例校验
pnpm test

# 生成独立静态网站
pnpm build

# 停掉 pnpm dev 后可在相同端口预览生产构建
pnpm preview
```

也可以将 `dist/` 部署到任意静态 HTTP 服务器：

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

然后访问 http://127.0.0.1:8000/?example=kda-w8a16-r1 。
资源使用相对路径，可部署在子目录。字体随构建打包，不依赖在线字体服务。
`viewer/public/local-data/` 是被忽略的本机数据目录，构建时会排除；
只有 `viewer/public/examples/` 中明确收录的示例进入构建。

使用仓库内的引擎和完整导出 JSON，即可复现示例的可视化效果。
`pnpm test` 验证 skill、引用完整性、状态分叉、四层投影和示例中保留的原文。
转换新日志时，`.work/` 可用于存放中间文件，它不会进入提交。

## 5. 用 tracevista-skill 生成和修改轨迹

需要 Git、**Python ≥ 3.10** 和这个 GitHub 仓库的访问权限；私有仓库需先登录获准访问的账号。
在你的项目根目录运行下面的命令，只把 skill 文件夹安装到 Codex 的项目目录：

```bash
(
  set -e
  tracevista_source="$(mktemp -d)"
  trap 'rm -rf "$tracevista_source"' EXIT
  git clone --depth 1 https://github.com/Superone77/trajactory_visualizer.git "$tracevista_source/repo"
  mkdir -p .agents/skills
  python3 -c 'import shutil, sys; shutil.copytree(sys.argv[1], sys.argv[2])' \
    "$tracevista_source/repo/skills/tracevista-skill" .agents/skills/tracevista-skill
)
```

Claude Code 使用相同命令，把两处 `.agents` 换成 `.claude`。已有仓库副本时，也可以直接复制完整的 `skills/tracevista-skill/` 文件夹。
在项目中启动新的 agent 会话，用 Codex 的 `$tracevista-skill` 或 Claude Code 的 `/tracevista-skill`，附上日志路径并说明：

> 将 `/path/to/session.jsonl` 转换为完整的 `.agent-state.json`，保留原文和证据。
> 在浏览器的 `https://tracevista.pages.dev/` 导入这次生成的文件并检查；如果无法操作浏览器，返回 JSON 和手动导入步骤。后续修改沿用这份文件和证据。

**skill 生成和修改标准文件，云端引擎负责打开和交互。** skill 只用 Python 标准库，无需安装查看器的 Node 环境。

处理流程如下；脚本命令以 Codex 的项目安装路径为例，Claude Code 对应 `.claude/skills/tracevista-skill/`。

```text
原始 Claude / Codex / Pi 日志
    → extract_timeline.py：提取事件和完整原文
    → agent 阅读证据并编写 state-analysis.json：状态、分支、行为和关系
    → build_state_graph.py --format state：验证引用和变化，输出状态 JSON
    → 在 https://tracevista.pages.dev/ 导入本次生成的完整 JSON
    → 检查状态、关键转向和原始记录，交付 JSON
```

```bash
python3 .agents/skills/tracevista-skill/scripts/extract_timeline.py /path/to/session.jsonl \
  --out .work/my-run

# 由 agent 阅读 timeline，并编写 state-analysis.json 后执行：
python3 .agents/skills/tracevista-skill/scripts/build_state_graph.py .work/my-run/state-analysis.json \
  --timeline .work/my-run/timeline.json --format state --require-reading-layer \
  --quality-report .work/my-run/reading-quality.json --out .work/my-run/task.agent-state.json
```

对已有导出，无需重新转换：

```bash
python3 .agents/skills/tracevista-skill/scripts/validate_trace.py /path/to/task.agent-state.json \
  --require-reading-layer
```

随后在云端查看器点击“Import trajectory”，选择这份 JSON；有浏览器操作能力的 agent 可以完成导入和检查。
交付时保留完整 JSON，并说明是否实际检查了当前轨迹。网页中的 KDA 示例可用于了解界面。
需要本地预览时，可按[可选本地预览说明](skills/tracevista-skill/references/opening.md#optional-local-preview)使用 `create_view.py`。

让 agent 用 `session_state.py save --graph FILE` 保存当前版本，后续“修改刚才那份轨迹”会从
项目下 `.work/tracevista/state` 恢复；每次保存生成独立修订，保留原始事件与证据 ID。
完整流程见 [skill](skills/tracevista-skill/SKILL.md) 和 [打开方式](skills/tracevista-skill/references/opening.md)。

多个主 agent / reviewer 会话使用相对路径 manifest，见
[多 agent 说明](skills/tracevista-skill/references/multi-agent.md)。
状态、观察层字段分别见 [状态协议](skills/tracevista-skill/references/state-graph.md) 和
[观察记录协议](skills/tracevista-skill/references/observations.md)。
`--format canvas` 可导出兼容 ThoughtDAG 的旧版画布格式。

新增示例：将生成图放到 `viewer/public/examples/<id>.agent-state.json`，在
`viewer/public/examples/index.json` 中登记 `id`、`title`、`file`、`description`，可补充 `agent`、`task`、`date` 作为列表副标题，即可获得 `?example=<id>` 入口，无需修改引擎。
普通个人日志直接从浏览器导入，或放入被忽略的 `viewer/public/local-data/<name>.json` 并用 `?data=<name>` 打开。

## 6. 目录与本次整理

```text
viewer/                           独立 React Flow 查看器
  src/trajectory/                 状态布局、语义缩放、原文、详情和观察层
  public/examples/                随构建发布的示例及目录
skills/tracevista-skill/           自包含的转换 skill、协议、脚本和测试
scripts/                          跨组件验证及示例检查
docs/                             操作说明、预览
pnpm-lock.yaml                    固定前端依赖及完整性
```

本次为可复现交付做了四项改动：抽出独立查看器、增加通用示例目录与相对路径加载、
给编译器增加 `--format state`、纳入完整真实案例并校验各层展示与证据完整性。
保留四层缩放、状态树、原文卡片和证据结构。

来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 7. 协作流程

新改动在独立分支开发，通过 PR 提交给维护者审批后合入 `main`。
运行 `pnpm setup:hooks` 可安装本机防误推钩子，详见 [分支流程](docs/BRANCHES.md)。
