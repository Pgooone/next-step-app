# 第 8.5 轮 · 新人上手体验 — 进度

> ✅ **范围圈定（全做）+ 前端设计 spec 定稿**（`../../docs/V1.2/第8.5轮-新人上手体验/前端设计.md`，经可视化伴侣逐屏迭代、用户逐项拍板，决策见台账 §2/§2.2）。
> ✅ **2026-06-29 ultracode 对抗式审计（5 路 + 核实 + 综合，裁决 `GO_WITH_FIXES`）+ lead file:line 复核 + spec/任务卡订正完成**：2 道承重 blocker（均 T1）+ 4 major + 数 minor，已逐条订正进 spec/卡；剔除 9 条 over-claim。决策 D-V1.2-64~66（台账 §2.3）、ADR D-R8.5-02~06。
> 🔜 **下一步（节奏 = 用户拍板 D-V1.2-66）：用户复审订正后的 spec/卡 → 批准 → 监工按批次派 agent team 串行实现 → :30141 真应用双层验收**。**未开工**。

## 设计阶段（已完成）

- 走 brainstorm + 可视化伴侣（58888），4+1 块逐屏迭代定稿；设计稿留痕 `Next-Step/.superpowers/brainstorm/9395-*/`（不入 git）。
- 用户拍板 D-V1.2-51~63（台账 §2 / §2.2）。

## 任务卡（待拆 · 来自 前端设计.md §8）

| 卡 | 内容 | 量级 | 状态 |
|---|---|---|---|
| **T1** | 首用引导 Tour（方案 B 分层 · overlay 引擎 + 总览5/深度6 + **两模态加 `initial*` 承重改造〔blocker1〕** + **深度轨空环境降级〔blocker2〕** + seen 持久化 + 新手引导按钮 + mini-spike + ADR） | medium→偏大 · tentpole · **批次2** | 🟡 审计订正完·待复审 |
| **T2** | 流水线 UI N1/N2/**N3**/N4（N2 hover 闪烁修〔**真根因订正**〕+ 两浮层边界感知/内部滚；**N3 board 终态自动刷会话·补回**） | small→偏中 · 批次1 | ✅ **收官 `47a46ac`**（双层验收过：computeFixedPopover 单测 6/6 + 真浏览器 N1/N2/N4+above-flip 修正 pageErrors=0；ADR D-R8.5-09） |
| **T3** | 入口 C3（`devIndicators:false` 移除 N + 提权〔**图标已在=提权非新增、删当前项 accent**〕）+ 建项目 C1（前端勾选 + 后端 opt-in mkdir〔**+try/catch→422 边界**〕） | small（C1 带后端） · 批次1 | ✅ **收官 `2dc4b71`**（双层验收过：lead 独立 7 断言复核承重〔含不勾不触盘红线/ENOTDIR·EACCES→422〕+ 真浏览器 C3 N移除/提权 + C1 disk 实证、uncaught=0；ADR D-R8.5-11） |
| **T4** | 文案中文化（C2/C12 短语+打字机 90ms·Array.from / C7 / C11 / C14 集中扫〔**EXPLORER 确实存在·纳入译表**〕） | small · 批次1 | ✅ **收官 `4ad9764`**（双层验收过：code-point-slice 5 测 + 真浏览器 C14/C2/C11/C7 pageErrors=0；范围=主线四区、OUT 三件留后续；ADR D-R8.5-10） |
| **T5** | 炫酷深色首页（shader 组件 + 深色玻璃首页 + 字体自托管 woff2〔**+迁 layout 旧 google mono**〕 + 性能/降级护栏 + 试点开关 + **真浏览器作 build oracle**） | medium（新依赖 three + WebGL） · 批次1 | 🟡 审计订正完·待复审 |

## 本轮不做 / 外移

- C4 技能泄漏 → ❌ 决策 C 不改（本机开发环境特有、非缺陷）
- C5 Agent 模板库 → ⏸ 归第九轮 D1

## 下一步

1. ✅ 字体已定 **B·优雅衬线**（用户真机选定）；spec 可终审。
2. ✅ **任务卡已拆**（走 vibe-coding 流程）：`T1`~`T5` + **`prompt.md`（监工起始指令：批次/承重前提/双层验收/lead 铁律 = 新窗口续做交接）**。
3. ✅ **2026-06-29 ultracode 审计 + spec/任务卡订正完成**（裁决 `GO_WITH_FIXES`；2 blocker 均 T1、4 major、数 minor，逐条订正进 spec/卡；剔除 9 条 over-claim）。
4. ⏳ **当前卡点（节奏 D-V1.2-66）：等用户复审订正后的 spec/卡 → 批准后才开工。**
5. 🔜 批准后：监工按**批次 1（T2/T3/T4/T5 可并行）→ 批次 2（T1 Tour，承重改造 + mini-spike 先行）**派 agent team 串行实现 + lead 每卡亲读 diff/门禁 + **双层验收**（逻辑层 + :30141 真应用真浏览器，pageErrors=0）。
6. 收官回写台账「实际处置」+ 更新 `docs/V1.2/README.md` 状态 + 待授权 push。
