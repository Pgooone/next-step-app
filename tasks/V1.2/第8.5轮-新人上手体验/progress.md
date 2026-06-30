# 第 8.5 轮 · 新人上手体验 — 进度

> ✅ **范围圈定 + spec 定稿 + ultracode 审计订正**（裁决 `GO_WITH_FIXES`；2 blocker 均 T1、4 major、数 minor 逐条订正、剔 9 over-claim；决策 D-V1.2-64~66、ADR D-R8.5-02~06）。
> ✅ **批次 1 主体 T2/T3/T4 全收官**（agent team 串行实现 + lead 每卡亲读 diff/复跑门禁/独立逻辑复核/真浏览器亲看截图双层验收；T2 `47a46ac` / T4 `4ad9764` / T3 `2dc4b71`，含回写共 8 commit bca110f→f22e60a；ADR D-R8.5-09/10/11）。
> ✅ **T1（首用引导 Tour·批次2）收官**（Phase A `b16b430` §0承重改造+mini-spike〔承重门 lead 亲跑 GO〕 + Phase B `acb5e54` 全引擎 11 步；双层验收全 PASS；ADR D-R8.5-12）。
> ⏸ **T5（深色 shader 首页·试点）仍暂停待续**（用户拍板 D-V1.2-70）。
> 🚀 **批次 1 即将 push**（v1.2 + ff master）。

## 设计阶段（已完成）

- 走 brainstorm + 可视化伴侣（58888），4+1 块逐屏迭代定稿；设计稿留痕 `Next-Step/.superpowers/brainstorm/9395-*/`（不入 git）。
- 用户拍板 D-V1.2-51~63（台账 §2 / §2.2）。

## 任务卡（待拆 · 来自 前端设计.md §8）

| 卡 | 内容 | 量级 | 状态 |
|---|---|---|---|
| **T1** | 首用引导 Tour（方案 B 分层 · overlay 引擎 + 总览5/深度6 + **两模态加 `initial*` 承重改造〔blocker1〕** + **深度轨空环境降级〔blocker2〕** + seen 持久化 + 新手引导按钮 + mini-spike + ADR） | medium→偏大 · tentpole · **批次2** | ✅ **收官**（Phase A `b16b430` §0承重改造+mini-spike〔承重门 lead 亲跑 GO〕 + Phase B `acb5e54` 全引擎11步；双层验收全 PASS〔verifier 全轨11步 JSON + lead 亲看4截图 + 亲跑承重门〕；🧭=sidebar headerSlot+折叠兜底；门禁 tsc0/lint0/test517；ADR D-R8.5-12） |
| **T2** | 流水线 UI N1/N2/**N3**/N4（N2 hover 闪烁修〔**真根因订正**〕+ 两浮层边界感知/内部滚；**N3 board 终态自动刷会话·补回**） | small→偏中 · 批次1 | ✅ **收官 `47a46ac`**（双层验收过：computeFixedPopover 单测 6/6 + 真浏览器 N1/N2/N4+above-flip 修正 pageErrors=0；ADR D-R8.5-09） |
| **T3** | 入口 C3（`devIndicators:false` 移除 N + 提权〔**图标已在=提权非新增、删当前项 accent**〕）+ 建项目 C1（前端勾选 + 后端 opt-in mkdir〔**+try/catch→422 边界**〕） | small（C1 带后端） · 批次1 | ✅ **收官 `2dc4b71`**（双层验收过：lead 独立 7 断言复核承重〔含不勾不触盘红线/ENOTDIR·EACCES→422〕+ 真浏览器 C3 N移除/提权 + C1 disk 实证、uncaught=0；ADR D-R8.5-11） |
| **T4** | 文案中文化（C2/C12 短语+打字机 90ms·Array.from / C7 / C11 / C14 集中扫〔**EXPLORER 确实存在·纳入译表**〕） | small · 批次1 | ✅ **收官 `4ad9764`**（双层验收过：code-point-slice 5 测 + 真浏览器 C14/C2/C11/C7 pageErrors=0；范围=主线四区、OUT 三件留后续；ADR D-R8.5-10） |
| **T5** | 炫酷深色首页（shader 组件 + 深色玻璃首页 + 字体自托管 woff2〔**+迁 layout 旧 google mono**〕 + 性能/降级护栏 + 试点开关 + **真浏览器作 build oracle**） | medium · 试点 | ⏸ **暂停待续（用户拍板 D-V1.2-70）**。prep 已 recon 就绪：shader=移植设计稿原生 WebGL〔88 行、零依赖〕；字体取舍 D-V1.2-69〔自托管 Instrument Serif+Noto Serif SC 13字子集+Space Grotesk+迁 Noto Sans Mono、正文 CJK 系统回退〕；fontTools 已装、gstatic --noproxy 实测可下 woff2。续做读本行 + 前端设计 §6 + 设计稿 `.superpowers/brainstorm/9395-*/shader-homepage-fonts.html` |

## 本轮不做 / 外移

- C4 技能泄漏 → ❌ 决策 C 不改（本机开发环境特有、非缺陷）
- C5 Agent 模板库 → ⏸ 归第九轮 D1

## 下一步（本次到此 · 余下待续）

1. ✅ spec 定稿 + ultracode 审计订正 + 用户复审批准。
2. ✅ **批次 1 主体 T2/T3/T4 收官**（双层验收全过，commit bca110f→f22e60a）。
3. 🚀 **push 批次 1**（v1.2 + ff master，用户拍板 D-V1.2-70）。
4. ⏸ **续做（下次）**：
   - **T5 深色 shader 首页·试点**——prep 已 recon 就绪（见 T5 行）；字体取舍 D-V1.2-69；shader 移植设计稿原生 WebGL；真浏览器作 build oracle（WebGL/中文 webfont 须真机验）。
   - ✅ **T1 首用引导 Tour·批次2 已收官**（2026-06-30：Phase A `b16b430` + Phase B `acb5e54`，承重门 lead 亲跑 GO + 双层验收全 PASS、ADR D-R8.5-12；唯余 T5 待续）。
5. 两卡续做收官后再回写台账「实际处置」+ 更新 `docs/V1.2/README.md`（本次未动该顶层 README，避免与第九轮未提交 WIP 纠缠）+ push。
