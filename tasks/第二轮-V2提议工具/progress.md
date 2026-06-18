# V2 进度（第二轮·提议工具模型）

> vibe-coding 第 3 步·任务跟踪。规格真相源：`../../docs/第二轮-V2提议工具/概要设计.md` + `../../docs/第二轮-V2提议工具/详细设计.md`。
> 每完成一模块：勾选 → 按详细设计验收要点自检 → 过质量门禁 → 更新所在区 README → 回写本页。

## 批次进度（串行）
- [ ] 批次 0 · V2-0 工具机制 spike（**GO 才展开**）
- [ ] 批次 1 · V2-1 文档物化层
- [ ] 批次 2 · V2-2 提议工具
- [ ] 批次 3 · V2-3 会话装配 → V2-4 接线
- [ ] 批次 4 · V2-5 删 guard
- [ ] 批次 5 · V2-6 端到端验证

## 模块 checklist
- [ ] V2-0 spike：defineTool 签名 + 受限工具集组合（含负对照）→ GO/NO-GO
- [ ] V2-1 物化层：真实 crd.md + filePath 字段
- [ ] V2-2 提议工具：create_artifact / propose_edit / list_artifacts（faux 验证）
- [ ] V2-3 会话装配：受限工具集（无 write/edit/bash）
- [ ] V2-4 接线：wiring 换 docSession（仅 profile 会话）
- [ ] V2-5 删 guard：artifact-guard / intercept 清理无残留
- [ ] V2-6 验证：端到端 + 真浏览器 + D3-D5 无回归

## 本期不做（登记）
PDF/Word 解析 + 转化 skill；外部改动自动版本；block_id 方案 C；文档型 vs coding 型 profile 区分。
