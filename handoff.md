# agy-cache-radar 项目交接文档 (handoff.md)

> **文档定位**：本文档记录 `agy-cache-radar`（Cache Radar）开发过程中的**当前项目状态与变更记录**（阶段进展、技术决策、踩坑教训、常用运行命令及后续待办）。  
> 静态架构与编码规范见 [`AGENTS.md`](./AGENTS.md)，底层数据与去重设计见 [`docs/architecture.md`](./docs/architecture.md)。

---

## 一、 项目定位与约束条件

- **核心目标**：为 Antigravity（`agy`）提供一个零运行时依赖的侧边栏 GUI 插件与 CLI 报告工具，从本地 `transcript.jsonl` 和只读元数据精确计算「当前会话」「近 24 小时」「近 30 天」的提示词缓存命中率，并定位丢缓存原因。
- **技术栈总览**：Node.js `>=22.5.0`（ESM、`node:sqlite`、`node:http`、`node:test`）+ Antigravity `sidecar_sdk`（`AUX_PANE`）+ 原生 HTML/CSS/SVG 与经典 IIFE 脚本（无构建工具、无第三方依赖）。
- **核心边界**：
  - 对本地所有 Antigravity 数据目录仅作只读访问，不发起任何外部网络请求或额外模型调用。
  - 前端文件遵循 [`AGENTS.md`](./AGENTS.md) 中的经典脚本规范（禁止 `<script type="module">` 与内联 `<script>`）和行数阈值（前端单文件 ≤ 300 行，后端单文件 ≤ 500 行）。
  - 测试与临时脚本仅使用 `os.tmpdir()`，不得向仓库写入临时数据或个人对话信息。

---

## 二、 当前版本核心进展 (Current Milestones)

### 1. v0.1.0 首个公开版本整理（含多天时间轴筛选与文档截图）
- **目标**：支持持续多天的跨天会话按时段查看与缩放筛选，补齐文档、截图、规范文件与公开仓库发布准备。
- **主要改动**：
  - 后端 [`src/session_metrics.mjs`](./src/session_metrics.mjs)、[`src/aggregator.mjs`](./src/aggregator.mjs)、[`src/index.mjs`](./src/index.mjs) 支持 `sessionFrom`/`sessionTo` 时间切片并输出全量紧凑时间刻度 `timeline.ticksSelf` / `timeline.ticksTree`，同时将其纳入 ETag 指纹。
  - 前端新增 [`sidecars/cache_radar/web/timeline.js`](./sidecars/cache_radar/web/timeline.js) 与 [`sidecars/cache_radar/web/timeline_drag.js`](./sidecars/cache_radar/web/timeline_drag.js)，实现 72 槽活跃块时间轴、拖拽框选、拖边调节、窗口平移、滚轮与 `+`/`−`/`↺` 缩放、双击重置以及 `全部/1h/24h/7d/30d` 快捷预设。
  - 命令行 [`scripts/cache-stats.mjs`](./scripts/cache-stats.mjs) 增加 `--last 1h|24h|7d|30d` 与 `--from`/`--to` 参数。
  - 独立预览支持 `?theme=light|dark` 查询参数（[`sidecars/cache_radar/web/format.js`](./sidecars/cache_radar/web/format.js)），使用纯合成样本生成 3 张界面截图并写入 [`docs/screenshots/`](./docs/screenshots/)。
  - 补齐 [`README.md`](./README.md)、[`CHANGELOG.md`](./CHANGELOG.md)、[`AGENTS.md`](./AGENTS.md)、[`.gitignore`](./.gitignore) 与本文档。
- **质量验证**：`node --test tests/*.test.mjs`（7/7 通过）、`agy plugin validate .`（0 错误，仅预期内的根目录 `AGENTS.md` 非运行时规则提示）与安装目录 `--strict` 校验通过，已完成隐私与本地路径清理检查和文本用词审查。

### 2. 低命中率原因诊断与紧凑可视化布局
- **目标**：不仅显示命中率数字，还要让用户直接看清哪些原因拉低了命中率，避免大段文字和容易误解的并列百分比。
- **主要改动**：
  - [`src/diagnostics.mjs`](./src/diagnostics.mjs) 按轮次前后文将未命中 token 归类为 6 类异常丢缓存（短间隔失效、提前回收、超时过期、切换模型/配置、中断重试、前缀部分失效）与 2 类正常新增（首轮发送、每轮新内容），满足 `hitRate + anomalyShareOfPrompt + structuralShareOfPrompt === 1`。
  - [`sidecars/cache_radar/web/diag_views.js`](./sidecars/cache_radar/web/diag_views.js) 与 [`sidecars/cache_radar/web/views.js`](./sidecars/cache_radar/web/views.js) 统一以总输入 token 为分母，使用三段式进度条、红色 `-X.X%` 命中率影响条和四格下钻标签页（`丢缓存`/`分布`/`模型`/`子代理`）替代文字总结。

### 3. 子代理 / Swarm 完整统计与多客户端自动发现
- **目标**：覆盖 `invoke_subagent` 与 `swarm add` 子对话，做到不漏算、不重复统计，并自动聚合桌面端多 profile 与多个 CLI 目录。
- **主要改动**：
  - [`src/hierarchy.mjs`](./src/hierarchy.mjs) 基于 `conversation_id` 全局去重、合并 SQLite 与 `swarm/members.json` 父子边、做环路/孤儿保护与 fork 前缀步骤去重。
  - [`src/discovery.mjs`](./src/discovery.mjs) 结合当前运行目录、`HOME` 与系统真实 home 自动扫描桌面端与 CLI 数据目录，做 `realpath` 去重并默认跳过备份目录。

---

## 三、 关键技术决策与踩坑教训 (Decisions & Lessons Learned)

1. **Antigravity Sidecar Iframe 必须使用经典 IIFE 脚本**
   - **故障现象**：插件打开后一直停留在「正在加载缓存命中率数据…」。
   - **根本原因**：Antigravity `sidecar_sdk` 返回静态 JS 时不附带 `Access-Control-Allow-Origin`，而 `<script type="module">` 会触发严格 CORS 检查导致脚本静默加载失败；此外内联 `<script>` 也会受限。
   - **防范措施**：所有前端脚本统一改用挂载到 `window.CacheRadar` 的经典 IIFE `<script src="/...?v=N">`，不写内联脚本，并在 [`sidecars/cache_radar/main.mjs`](./sidecars/cache_radar/main.mjs) 返回 `Cache-Control: no-store`。
2. **Antigravity 无插件热重载（驻留进程 + LRU Iframe 缓存）**
   - **机制说明**：宿主会缓存最近关闭的 sidecar iframe，且不会自动重启常驻的 `node main.mjs` 进程。
   - **处理方式**：同步代码到 `~/.gemini/config/plugins/cache-radar` 后，需在 Plugins Manager 中关闭再开启一次插件；前端静态资源通过递增 `?v=N` 版本号绕过浏览器旧缓存。
3. **只读打开 WAL 模式 SQLite 失败（SQLITE_CANTOPEN / error 14）**
   - **故障现象**：在沙箱或只读权限下直接读取活跃 `conversation_summaries.db` 时可能因无法创建 `-shm` 索引而报错。
   - **防范措施**：[`src/metadata.mjs`](./src/metadata.mjs) 优先用 `node:sqlite` 的 `{ readOnly: true }` 打开，失败时自动回退到 `file:${encodeURI(dbPath)}?immutable=1`。
4. **按时间切片时保留前置轮次上下文**
   - **背景与决策**：若先按 `sessionFrom`/`sessionTo` 过滤原始事件再计算间隔与原因，跨天会话中第 2 天的第 1 轮会被误判成首次冷启动（`cold_start`）。
   - **最终方案**：先在完整会话事件流上执行 `annotateConversationTurns`，再在 [`src/session_metrics.mjs`](./src/session_metrics.mjs) 中按时间范围过滤聚合，同时返回完整会话的 `timeline` 刻度数组。
5. **时间轴拖拽期间禁止轮询覆盖 DOM**
   - **原因**：后台每 2.5s 轮询一次 `/api/stats`，若拖拽选区期间触发全量 `innerHTML` 重绘会打断指针捕获。
   - **方案**：在 [`sidecars/cache_radar/web/app.js`](./sidecars/cache_radar/web/app.js) 中用 `state.tl.isDragging` 拦截渲染，拖拽释放后再提交新区间并强制拉取。

---

## 四、 核心代码架构与文件速查 (Architecture Map)

- [`src/discovery.mjs`](./src/discovery.mjs)：多客户端 / 多 CLI 数据目录自动发现、符号链接去重、备份目录过滤。
- [`src/metadata.mjs`](./src/metadata.mjs)：只读读取 `conversation_summaries.db`、`conversation_parents` 与 `swarm/members.json`。
- [`src/transcript.mjs`](./src/transcript.mjs)：基于 `mtimeMs` / `size` / 字节偏移量的增量 JSONL 读取器，提取 `PLANNER_RESPONSE` 及轮间错误/配置变更标记。
- [`src/hierarchy.mjs`](./src/hierarchy.mjs)：构建去重后的对话 DAG、fork 前缀去重与全历史轮次标注。
- [`src/diagnostics.mjs`](./src/diagnostics.mjs)：8 类未命中归因、总输入占比拆分统计（命中 + 异常丢缓存 + 正常新增 = 100%）、间隔/上下文矩阵与丢缓存事件提取。
- [`src/session_metrics.mjs`](./src/session_metrics.mjs)：当前会话及子树聚合、时间范围切片与 72 槽时间轴刻度输出。
- [`src/window_metrics.mjs`](./src/window_metrics.mjs)：近 24 小时与近 30 天按事件时间戳聚合（按全部 / 仅主 / 仅子代理拆分）。
- [`src/index.mjs`](./src/index.mjs)：`CacheRadarEngine` 门面与确定性 ETag 生成。
- [`sidecars/cache_radar/main.mjs`](./sidecars/cache_radar/main.mjs)：`sidecar_sdk` 服务入口与独立 HTTP 预览服务。
- [`sidecars/cache_radar/web/`](./sidecars/cache_radar/web/)：经典 IIFE 前端组件（`format.js`、`charts.js`、`timeline.js`、`timeline_drag.js`、`diag_views.js`、`views.js`、`app.js`、`styles.css`、`index.html`）。
- [`scripts/cache-stats.mjs`](./scripts/cache-stats.mjs)：终端统计脚本（供命令行及 [`skills/cache-radar/SKILL.md`](./skills/cache-radar/SKILL.md) 使用）。

---

## 五、 常用验证、运行与本地同步命令

### 1. 运行自动化测试
```bash
npm test
```

### 2. 校验插件清单与目录规范
```bash
agy plugin validate .
```

### 3. 本地独立浏览器预览与 CLI 抽查
```bash
npm run dev
node scripts/cache-stats.mjs --last 24h
```

### 4. 同步到本机已安装插件目录
```bash
rsync -a --delete --exclude=.git --exclude=.DS_Store --exclude=AGENTS.md ./ ~/.gemini/config/plugins/cache-radar/
agy plugin validate --strict ~/.gemini/config/plugins/cache-radar
```
同步完成后，在 Antigravity 插件管理器中关闭并重新开启 Cache Radar 生效。

---

## 六、 后续待办事项 (Backlog)

- [ ] **P1 - 支持时间轴悬浮气泡提示**：鼠标悬停在 72 槽活跃块上时显示该时间槽的起止时间、轮次数与平均命中率。
- [ ] **P2 - 24h / 30d 趋势柱状图点击下钻**：点击某小时或某天柱子时，筛选并高亮该时段内对应的丢缓存事件与会话列表。
- [ ] **P3 - 导出当前视图统计 JSON / CSV**：在顶部操作区增加一键复制摘要或导出明细，方便跨周对比缓存优化效果。

---

## 七、 会话交接前自检清单 (Pre-Handoff Checklist)

- [x] 代码库 Git 工作区将在提交并打 `v0.1.0` 标签后保持干净。
- [x] 全部单元测试通过（`tests/*.test.mjs`，7/7）。
- [x] 插件校验通过（仓库目录 `agy plugin validate .` 0 错误，已安装目录 `--strict` 0 警告）。
- [x] 所有源文件满足 [`AGENTS.md`](./AGENTS.md) 中的行数阈值。
- [x] 已完成隐私与本地路径清理检查和文本用词审查。
