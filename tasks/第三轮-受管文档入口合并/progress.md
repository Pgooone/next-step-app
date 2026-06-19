# 第三轮进度（受管文档入口并入 file panel）

> vibe-coding 任务跟踪。规格真相源：`../../docs/第三轮-受管文档入口合并/详细设计.md` + QA `../../docs/QA/开发/受管文档入口并入filepanel决策.md`。
> 每完成一卡：勾选 → 按详细设计 §七验收自检 → 过门禁 → 更新区 README → 回写本页 → 单独 commit。
> **详细设计已过 ultracode 8-agent 设计 + 对抗（2026-06-19）**：1 blocker（去重 key 裸名→绝对路径 D-V3-04）+ 2 major（projectId 透传 D-V3-08 / cwd 语义 §四）已修订并入。直接按修订后任务卡做。

## 批次进度（串行）
- [x] T1 · .pi 侧车隐藏（IGNORED_NAMES 加 `.pi`）—— commit `5dd8664`
- [x] T2 · 受管分组渲染 + 绝对路径去重（**承重墙**）—— 含 D-V3-09 加固
- [ ] T3 · 接线 + 删 Artifacts 按钮/ArtifactPicker
- [ ] T4 · 端到端真浏览器验收 + 机制层零回归

## 关键约束（实现必看）
- 去重 key = **绝对路径** `join(projectRoot, filePath)` vs `node.fullPath`，**非裸名**（cwd≠projectRoot 真实可能）。
- `projectId`/`projectRoot` 由 SessionSidebar **自取**透传，AppShell 只传 `onOpenArtifact`。
- 受管机制层（侧车 / artifact-service 三写方法 / 提议工具）**一行不动**。
- SSE 残留缺口走**方案 A**（写时 409 toast），方案 B 漂移黄条移出本轮。

## 本期不做（登记）
派发产物纳入文档清单；普通 .md 手动转受管；SSE 方案 B 漂移黄条；外部改 .md 自动进版本；右栏写操作后左栏分组版本号即时刷新（minor gap）。
