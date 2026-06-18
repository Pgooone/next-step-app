# V2 进度（第二轮·提议工具模型）

> vibe-coding 第 3 步·任务跟踪。规格真相源：`../../docs/第二轮-V2提议工具/概要设计.md` + `../../docs/第二轮-V2提议工具/详细设计.md`。
> 每完成一模块：勾选 → 按详细设计验收要点自检 → 过质量门禁 → 更新所在区 README → 回写本页。
> **2026-06-18 ultracode review 后已据结论修订三件套+ADR+本任务卡**（blocker：白名单须含工具名 D-V2-04 / major：并发拒绝 D-V2-05 + 外部编辑防护 D-V2-06 + spread 顺序 / coreIssue：局部改对账）；完整发现与修订映射见 `../../docs/QA/开发/V2/review与修订记录.md`。

## 批次进度（串行）
- [x] 批次 0 · V2-0 工具机制 spike —— **GO**（lead 独立复跑 10/10 PASS、EXIT 0；范式+typebox 决策见 D-V2-07）
- [x] 批次 1 · V2-1 文档物化层（`70af56b`，外部编辑保护 fail-clean + file-name.ts 抽离 D-V2-08）
- [x] 批次 2 · V2-2 提议工具（`60e4d58`，含 5-agent 对抗 review 收口 D-V2-09）
- [x] 批次 3 · V2-3 会话装配（`fd5930c`）→ V2-4 接线（`39892e7`，spread 顺序 + 泄漏对照测）
- [x] 批次 4 · V2-5 删 guard（本次提交，删 543 行、grep 无活引用、spike stale 保留登记）
- [ ] 批次 5 · V2-6 端到端验证

## 模块 checklist
- [x] V2-0 spike：defineTool 签名 + 受限工具集组合（双向负对照 10/10）→ **GO**（`spike/v2-tools/`，D-V2-07）
- [x] V2-1 物化层：真实 .md + filePath 字段 + EXTERNAL_MODIFIED 保护（`70af56b`）
- [x] V2-2 提议工具：create_artifact / propose_edit / list_artifacts（`60e4d58`，10 单测 + promptGuidelines 加固）
- [x] V2-3 会话装配：受限工具集（无 write/edit/bash）（`fd5930c`，DOC_SESSION_TOOLS 7 项）
- [x] V2-4 接线：wiring 换 docSession（仅 profile 会话）（`39892e7`，泄漏对照测守 spread 顺序）
- [x] V2-5 删 guard：artifact-guard / intercept 清理无残留（本次提交，spike stale 保留作历史留痕）
- [ ] V2-6 验证：端到端 + 真浏览器 + D3-D5 无回归

## 本期不做（登记）
PDF/Word 解析 + 转化 skill；外部改动**自动**进版本（但本轮已加 EXTERNAL_MODIFIED 防覆盖）；block_id 方案 C；文档型 vs coding 型 profile 区分；delete/清理工具（孤儿文件）。
