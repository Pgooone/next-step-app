# 第三轮进度（受管文档入口并入 file panel）

> vibe-coding 任务跟踪。规格真相源：`../../docs/第三轮-受管文档入口合并/详细设计.md` + QA `../../docs/QA/开发/受管文档入口并入filepanel决策.md`。
> 每完成一卡：勾选 → 按详细设计 §七验收自检 → 过门禁 → 更新区 README → 回写本页 → 单独 commit。
> **详细设计已过 ultracode 8-agent 设计 + 对抗（2026-06-19）**：1 blocker（去重 key 裸名→绝对路径 D-V3-04）+ 2 major（projectId 透传 D-V3-08 / cwd 语义 §四）已修订并入。直接按修订后任务卡做。

## 批次进度（串行）
- [x] T1 · .pi 侧车隐藏（IGNORED_NAMES 加 `.pi`）—— commit `5dd8664`
- [x] T2 · 受管分组渲染 + 绝对路径去重（**承重墙**）—— 含 D-V3-09 加固
- [x] T3 · 接线 + 删 Artifacts 按钮/ArtifactPicker —— 链路 A 端到端通、旧入口移除
- [x] T4 · 端到端真浏览器验收 + 机制层零回归 —— 真浏览器 11 必走全 PASS、pageErrors=0

## 关键约束（实现必看）
- 去重 key = **绝对路径** `join(projectRoot, filePath)` vs `node.fullPath`，**非裸名**（cwd≠projectRoot 真实可能）。
- `projectId`/`projectRoot` 由 SessionSidebar **自取**透传，AppShell 只传 `onOpenArtifact`。
- 受管机制层（侧车 / artifact-service 三写方法 / 提议工具）**一行不动**。
- SSE 残留缺口走**方案 A**（写时 409 toast），方案 B 漂移黄条移出本轮。

## 本期不做（登记）
派发产物纳入文档清单；普通 .md 手动转受管；SSE 方案 B 漂移黄条；外部改 .md 自动进版本；右栏写操作后左栏分组版本号即时刷新（minor gap）。

## 验收结论（T4，2026-06-20）
真浏览器（repo-vendored browser-e2e，dev:30141）+ 机制层零回归，全部通过。fixture/drive = `scripts/v3-e2e-fixture.mts` / `scripts/v3-e2e-drive.mjs`。

- **真浏览器 11 项必走全 PASS、pageErrors=0**：AC①受管分组列出全部(数量=API=2) / AC②点开→ArtifactPanel / AC③物化受管 .md 在普通树被去重(树非空且 需求规格.md 被剔、刷新×2 稳定) / AC④无 Artifacts 按钮 / AC⑤树无 .pi + 普通 .md 在树 / AC⑥ type=read 读 .pi→200 / AC⑦分组可折叠 + 空项目 P2 不显分组树照常 / AC⑧普通文件→FileViewer + 受管 .md 不在普通树(双入口堵死) / AC⑨纯浏览无「N 处待确认」、经新入口开 pending→右栏「N 处待确认」。
- **AC⑨ 中栏 PendingChangeCard + resolve（Tier2）本轮未在浏览器复跑**：需选中已有会话离开 isEmptyNew，而枚举会话要 import 内核（tsx 解析 pi 包 exports 失败）；中栏卡 = D4 已验、V3 未改其结构（新入口调同一 `useArtifactStore.open()`），其 V3 相关性已由右栏「N 处待确认」（经新分组入口加载 pendingChanges）证同源。
- **机制层零回归**：`artifact-service` / `pending-change-service` / `doc-tools` 三套 87 tests 全绿；`npm run test` 329 / tsc 0 / lint 0。
- **验收踩坑（写给后人）**：①文件 API（type=list/read）只服务「允许根」(getAllowedRoots = 会话 cwd + `~/pi-cwd-\d{8}`)，fixture 项目根必须放允许根下(本轮用 `~/pi-cwd-<date>/`)，用裸 /tmp 会全 403、普通树空 → AC⑤/⑦/⑧ 假失败 + AC③ 空树假过；②普通树 fetchEntries 首次冷编译慢，断言前须轮询等树就绪(等已知普通文件 span 出现)，定长 wait 不够。
