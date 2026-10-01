# trajactory_visualizer

**把 coding agent 的日志变成可以逐层放大的状态与执行地图。**

缩小时看系统状态和版本分叉；放大后依次看到探索方向、具体行为、原始 trajectory。
点击卡片，右侧展示描述、内部行为、代码来源、时间关系、测量和原始证据。

本仓库包含基于 ThoughtDAG 改造的独立可视化引擎、`trajectory-to-thoughtdag` 转换 skill，
以及一份完整导出的 **Pi Infra Harness / LoRA / 20261001-r1** 真实轨迹。
这是通用 coding agent 工具：引擎没有 LoRA 或 Pi 的业务逻辑，任务描述及证据保存在导出数据中。

> **私有研究仓库。** Pi 示例及其原始记录会随静态构建打包。查看器不上传日志、无需登录或模型 API；
> 如果将 `dist/` 部署到其他服务器，需要由部署者保持私有访问。普通新导入的本地文件不会被打包。

## 1. 克隆并打开示例

需要 **Node.js 24.x、pnpm 11.19.0**。查看预先生成的示例不需要 Python；转换新的日志或跑 skill 测试需要 **Python ≥ 3.10**。
不需要 GPU、MPI-IS、Pi Harness、Claude/Codex 安装或任何 API key。

```bash
git clone https://github.com/Superone77/trajactory_visualizer.git
cd trajactory_visualizer

# 如果尚未安装 pnpm（Node 安装包一般附带 npm）
npm install -g pnpm@11.19.0

pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

打开：

- **Pi 真实轨迹：** http://127.0.0.1:8875/?example=pi-infra-r1
- 首页 / 本地 JSON 导入：http://127.0.0.1:8875/
- 七类观察记录的合成示例：http://127.0.0.1:8875/?example=parser

首页也有示例入口。首次加载先显示状态卡片；点击“全图”查看完整版本树。
`trajectory.html` 保留为兼容入口。若 8875 被占用，先停止占用它的开发服务器，或手动用
`pnpm exec vite --config viewer/vite.config.ts --host 127.0.0.1 --port 8876 --strictPort` 更换端口。
私有仓库克隆需要该 GitHub 账号的访问权限；网页本身不读取 GitHub 登录信息。

## 2. 怎么读图

| 层级 / 操作 | 看到什么 |
|---|---|
| 系统状态 | 代码或产物状态；绿色 / 红色表示同口径测量值改善 / 退化，紫色表示引用历史结果的最终选择 |
| 探索分支 | 一个状态下提出或尝试的方向；**分支不表示并行执行** |
| 具体行为 | Explore、Plan、Edit、Execute、Verify、Diagnose；执行者身份独立于行为类型 |
| 原始轨迹 | 原始思考、发言、工具输入和返回；长正文可在卡片内滚动 |
| 点击卡片 | 右侧详情、版本来源、内部行为、原始证据及跳转 |
| “版本分支 / 执行顺序” | 分别查看代码来自哪个版本，以及实际先后顺序 |
| “结构与证据” | 全任务搜索与筛选：探索、Skill、review、经验读写、TODO、测量和独立结论 |

触控板默认双指平移、捏合缩放；鼠标模式用滚轮缩放。空白处拖动或按空格拖动画布。
工具栏的四个层级按钮可以直接跳转。读日志时可选中复制文本。

**状态是有范围的记录，不是完整机器快照。** Pi 示例跟踪已提交候选的 Git tree、提交编号和最终选中状态。
未提交编辑、测试和回退仍在行为层。只有成功 Edit / Execute 且有范围内实际变化的证据，才建立状态转移。

## 3. Pi 示例展示了什么

这轮已有实验由 DeepSeek Flash / high 在 A100 40GB 上执行 LoRA 优化。本仓库只转换与展示结果，
**打开示例不会重新运行 agent 或性能实验**。549 条原始会话事件、150 次工具调用，整理为
6 个状态、20 个探索分组、152 个行为；另保留 7 条提交账本 / 独立评分记录。

| 提交 | 主要变化 | 正确性 | 开发评分 |
|---|---|---|---:|
| 1 | 分组 Triton shrink / expand | 通过 | 18.671309× |
| 2 | 直接启动 CompiledKernel + raw stream | 通过 | 33.369200× |
| 3 | identity 启动缓存 | 通过 | 30.834023× |
| 4 | 回到第 2 版，再精简特化键 | 通过 | 35.444980× |

第 3 次提交虽然在复用对象的局部测试中更快，开发评分却降低了约 7.6%。后续 fresh / rotating 对照后，
agent 回到第 2 版继续修改，得到第 4 版。因此版本树中 3 和 4 是从 2 分出的两个后继，时间顺序仍是 2 → 3 → 4。
最终选中第 4 版；独立 Oracle **ABBA 为 2.113798×**，独立官方 baseline 为 **34.588125×**。
这些数字和开发评分、局部计时分开保存，不能混用或自动当作统计显著性结论。

本轮**没有实际 Skill 加载或独立 reviewer 轨迹**，因此对应记录为空；已安装 Skill 不等于调用过。
没有明确 Wiki / TODO 生命周期时也不补造记录。另一个合成示例展示这些可选结构的格式与交互。

![Pi 版本树](docs/pi-overview.png)

完整文件：[pi-infra-r1.agent-state.json](viewer/public/examples/pi-infra-r1.agent-state.json)。
Pi 示例只收录这一个完整导出文件，不另附原始 JSONL、单独账本或实验目录。导出文件自身保留原文和证据附件，支持放大查看与离线分析。

## 4. 验证和部署

```bash
# Python 标准库即可，无 pip 依赖；含 skill、查看器、原文完整性和完整示例校验
pnpm test

# 生成独立静态网站
pnpm build

# 停掉 pnpm dev 后可在相同端口预览生产构建
pnpm preview
```

也可以只把 `dist/` 拷给有权限的同事，用任意静态 HTTP 服务器打开：

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

然后访问 http://127.0.0.1:8000/?example=pi-infra-r1 。不要直接双击 `index.html` 以 `file://` 打开。
资源使用相对路径，可部署在子目录。字体随构建打包，不依赖在线字体服务。
`viewer/public/local-data/` 是被忽略的本机数据目录，构建时会排除；
只有 `viewer/public/examples/` 中明确收录的示例进入构建。

这里的“复现”指使用相同引擎和完整导出 JSON 复现可视化效果，不是重新运行 Pi 实验或重新生成分析标签。
`pnpm test` 验证 skill、引用完整性、状态分叉、四层投影和示例中保留的原文。
转换新日志时，`.work/` 可用于存放中间文件，它不会进入提交。

## 5. 用 skill 转换自己的轨迹

可直接让支持 skill 的 coding agent 使用：

> 使用 `skills/trajectory-to-thoughtdag/SKILL.md`，将我的轨迹转换为本查看器的状态 JSON。
> 声明跟踪范围，保留原始证据，分开版本来源和时间顺序；缺失的信息明确标注。

也可以把整个 `skills/trajectory-to-thoughtdag/` 文件夹复制到你的 agent 的 skill 目录。
它自包含，不依赖本机绝对路径或旧私有 skill 仓库。

处理流程：

```text
原始 Claude / Codex / Pi 日志
    → extract_timeline.py：脱敏提取，不删减原文
    → agent 阅读证据并编写 state-analysis.json：状态、分支、行为和关系
    → build_state_graph.py --format state：验证引用和变化，输出状态 JSON
    → 查看器“导入状态轨迹”
```

```bash
python3 skills/trajectory-to-thoughtdag/scripts/extract_timeline.py /path/to/session.jsonl \
  --out .work/my-run

# 中间需要 agent 阅读 timeline、编写 state-analysis.json；不是自动从日志猜出全部状态。
python3 skills/trajectory-to-thoughtdag/scripts/build_state_graph.py .work/my-run/state-analysis.json \
  --timeline .work/my-run/timeline.json --format state --out .work/my-run/task.agent-state.json
```

多个主 agent / reviewer 会话使用相对路径 manifest，见
[多 agent 说明](skills/trajectory-to-thoughtdag/references/multi-agent.md)。
状态、观察层字段分别见 [状态协议](skills/trajectory-to-thoughtdag/references/state-graph.md) 和
[观察记录协议](skills/trajectory-to-thoughtdag/references/observations.md)。
`--format canvas` 保留旧版 ThoughtDAG 画布导出；原版线上 ThoughtDAG 不提供这里的四层状态缩放。

新增获准分享的示例：将生成图放到 `viewer/public/examples/<id>.agent-state.json`，在
`viewer/public/examples/index.json` 中登记名称和说明，即可获得 `?example=<id>` 入口，无需修改引擎。
普通个人日志直接从浏览器导入，或放入被忽略的 `viewer/public/local-data/<name>.json` 并用 `?data=<name>` 打开。
不要把登录文件作为日志或示例；自动脱敏和模式检查不能替代分享前检查。

## 6. 目录与本次整理

```text
viewer/                           独立 React Flow 查看器
  src/trajectory/                 状态布局、语义缩放、原文、详情和观察层
  public/examples/                随构建发布的示例及目录
skills/trajectory-to-thoughtdag/   自包含的转换 skill、协议、脚本和测试
scripts/                          跨组件验证及示例检查
docs/                             操作说明、预览
pnpm-lock.yaml                    固定前端依赖及完整性
```

本次为可复现交付做了四项改动：抽出独立查看器、增加通用示例目录与相对路径加载、
给编译器增加 `--format state`、将完整 Pi 导出纳入内置示例并校验各层展示与证据完整性。
原有四层缩放、状态树、原文卡片和证据结构保留。查看器不含模型 API 后端。

来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
