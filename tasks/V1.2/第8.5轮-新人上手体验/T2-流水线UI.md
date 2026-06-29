# T2 · 流水线 UI 修缮 N1/N2/N3/N4（small→偏中）

> 设计依据：`前端设计.md` §2 + 台账 D-V1.2-59/60。**不改交互（方案 A）**，只修位置/滚动/闪烁/文案 + N3 自动刷新。
> 🔧 **本卡已经 2026-06-29 审计订正**：N2 闪烁真根因订正（D-R8.5-04）+ N3 补回（用户拍板 D-V1.2-65 / ADR D-R8.5-05）。

## 改动点
- **N1 去重**：`PipelineModal.tsx:287` 底部小按钮 label「+ 新建流水线」→ **「✎ 编辑流水线」**（动作 `setView('editor')` 不变）；`PipelineBoard.tsx:96` 空态大按钮保持「+ 新建流水线」。
- **N2 两浮层边界感知 + 内部滚 + 修闪烁**（`PipelineStageCard.tsx:69-71` 的 hover/click 交互**保持不变**）：
  - `StageHoverPreview.tsx`：从锚卡 `top:calc(100%+6px)` 改为**选上下空间更大一侧**展开、`maxHeight=min(330, 该侧可用空间)`+内部 `overflow-y:auto`、横向钳制；**不覆盖卡片**。
  - `StageSessionMenu.tsx`：锚**点击点坐标**（类右键菜单）、靠底向上翻/靠右往左收+钳制；transcript 区滚动、**底部「打开文档/进入对话」钉死不跟滚**（flex：header none + scroll flex:1 + acts none）。
  - **修 hover 闪烁（根因订正·D-R8.5-04）**：⚠️ 旧表述「浮层向上钳制盖住卡片」**与现代码不符**（两浮层现是静态 `top:calc(100%+6px)` 下挂、已带 `maxHeight+overflowY`、无 clamp/getBoundingClientRect）。**真根因** = 6px 间隙 + 浮层是 `.brow` 子元素但**自身不是 hover 目标**（无 `onMouseEnter`）→ 鼠标进浮层时 `.brow onMouseLeave`（`PipelineStageCard.tsx:70`）→ `setHover(false)` → 浮层「够不到」消失；叠加 `PipelineModal:116 overflow:hidden` 裁切。**承重修法（治本，非可选）**：① **140ms 隐藏防抖** + ② **给浮层加 `onMouseEnter` 取消隐藏**（使可达可滚）。**别去修不存在的「向上钳制」/「绝不覆盖卡片」**。
- **N4 空态说明**：`PipelineBoard.tsx:80-97` 空态按钮上方加：「流水线 = 多个 Agent 按固定顺序接力、可保存复用；只想临时派一次 → 用上方『快速派发』。」
- **N3 run 完左栏会话分组自动刷新（补回·见 前端设计.md §2.4）**：① `PipelineModal.tsx:243` 给 `PipelineBoard` 透传 `onSessionsChanged`（现 :268 只喂 `DispatchContent`）；② `PipelineBoard` 加「`currentRun` 进终态」effect、**独立 ref 按 `run.id` 去重**（`:46` 已可得 `currentRun?.id`）触发一次 `onSessionsChanged()`（仿 `DispatchPanel.tsx:117-123`）。⚠️ **已接受限制**：轮询/effect 在 board 内、模态关/切 tab 即卸载停（同 `DispatchPanel:99`）→ **只保证「board 开着时」run 跑完刷新**，关模态后跑完不刷=既有限制、**不扩大修**。

## AC（真浏览器）
1. N1：流水线 tab 不再同屏两个「新建流水线」，语义为 新建 + 编辑。
2. N2：靠下阶段 hover 详情/click 菜单**都不被弹窗底边裁切**、内部可滚；**hover 同一卡持续 ≥2s 不闪、移到浮层上不消失**；交互仍是 hover=详情 / click=菜单。
3. N4：空态有「流水线 vs 快速派发」说明。
4. **N3：board 开着时一条 run 跑到终态 → 左栏会话分组自动刷新一次**（按 run.id 去重，不重复刷）。⚠️ 验收口径=**仅 board 挂载时**；关模态后跑完不刷=已接受限制、**不判 FAIL**（勿用「关模态后必刷」判据）。
5. `pageErrors=0`。

## DoD
lint/test/tsc 绿；AC 真浏览器 PASS（设计稿 `n2-both-popovers-v3.html` 是行为基准）；回写 progress。

## 依赖
独立。注意勿动 `PipelineStageCard` 的 onMouseEnter/onClick 语义（红线：交互不变）。
