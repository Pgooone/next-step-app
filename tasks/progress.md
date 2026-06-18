# Next-Step V1.1 进度看板

> vibe-coding 第 3 步·任务跟踪。规格真相源：`../docs/概要设计.md` + `../docs/详细设计.md`。
> 每完成一个模块：勾选 → 按详细设计验收要点自检 → 过质量门禁 → 更新所在区 README → 回写本页。

## 质量门禁（全绿才算完）

- `vitest`（单测）
- `node_modules/.bin/tsc --noEmit`（类型）
- `eslint`（风格）
- **UI 模块额外**：真浏览器验收（browser-e2e skill；SSR/hydration 与集成 bug 单测抓不到）

## 模块（共 8，按依赖批次）

### 批次 1（无依赖，可并行）

- [x] **M1 · agent-naming-fix** — [M1-naming.md](M1-naming.md)：删界面 UUID 路径泄漏，显真名。trivial；若先做 M4 则被覆盖
- [x] **M2 · chat-file-upload** — [M2-file-upload.md](M2-file-upload.md)：对话框选文本类文件 → 读字 → `<file>` 内联。纯前端
- [x] **M3 · file-panel-hint** — [M3-panel-hint.md](M3-panel-hint.md)：「右看改动 / 左逐块确认」视觉提示，不搬按钮
- [x] **M5 · session-agent-mapping** — [M5-session-map.md](M5-session-map.md)：⭐承重墙——领域层「会话 ↔ agent / 主对话」映射 + store + API
- [x] **M6 · project-homepage** — [M6-project-home.md](M6-project-home.md)：项目卡片墙首页，点进才入工作台

### 批次 2（依赖 M5）

- [x] **M7 · main-chat-and-sidebar** — [M7-main-chat-sidebar.md](M7-main-chat-sidebar.md)：主对话 + 按需起 agent 会话 + 左侧分组标签。依赖 M5（真浏览器 5.2/5.3/5.4/防串显 5 项 PASS）
- [x] **M4 · agent-manager-glass** — [M4-agent-glass.md](M4-agent-glass.md)：AgentManager 玻璃卡片重写 + 二级菜单现场改配置。独立 UI 重活，含 M1

### 批次 3（依赖 M5 + M7）

- [x] **M8 · at-agent-transfer** — [M8-at-agent.md](M8-at-agent.md)：主对话 `@agent` 转交全历史+附件到该 agent 单独会话。依赖 M5 + M7（真浏览器 5 AC 截图全证：@唤起/勾选默认/投递归属/载荷 `<context>`+角色标注/Dispatch 并存）

## 不开发的需求（已剔除）

- 功能#1（前端解析报告）：✅ 已交付 `前端界面深度解析报告.md`，非代码
- 功能#3（项目 + 全局 skills）：✅ 已双层验证具备，零开发
- 功能#5.6（Dispatch 去留）：保留不动，无模块

## lead 机制决策（已拍板 → `../docs/设计决策记录.md`）

1. M5 映射存盘 = `<cwd>/.pi/ns-session-map.json`（D-V1.1-01）
2. M6 项目首页 = 单页内按 `currentProjectId` 二选一渲染（D-V1.1-02）
3. M8 转交载荷 = `<context>` + `<file>` 内联、作目标会话首条消息（D-V1.1-03）

## Bug-Fix 轮次 1（session: v1.1-bug-fix）

> 缺陷台账 + 五段分析 + 「说人话」学习专章：`../BUG修复记录-v1.1.md`。
> 复核：ultracode agent team 对抗式（证伪根因 + 穷举边界/回归）+ lead 亲验关键项。
> 顺序按风险/依赖：03→01→02→04→05（§C 触核心发送链路、最后做）。决策见台账 §一 + `../docs/设计决策记录.md`（D-V1.1-11 起）。

- [x] **BF·BUG-03 · 文案/空状态** — [bf-copy.md](bf-copy.md)：纯文案零风险（序 1）
- [x] **BF·BUG-01 · 进项目 cwd（选 A 补强）** — [bf-cwd.md](bf-cwd.md)：空 / 串项目 / 切项目三缺陷（序 2）
- [x] **BF·BUG-02 · 全局 toast** — [bf-toast.md](bf-toast.md)：基建 + 16 处接线，防刷屏（序 3）
- [x] **BF·BUG-04 · 二次确认** — [bf-confirm.md](bf-confirm.md)：复用 confirmId 范式（序 4）
- [x] **BF·BUG-05 · §C 引用注入** — [bf-quote-inject.md](bf-quote-inject.md)：⚠️ 核心发送链路、最后做（序 5）

搁置登记（不丢）：BUG-00 P0 承重墙（单独立项）、§F/§H、§D/§E（分期）、杂项小 UX——详见台账 §四。

## P0 承重墙·档位1（v2 主线 · ✅ 闭环达成 2026-06-18）

> 产物按块确认运行时接线，**只接 profile 会话路径**。范围/档位/命门：`../docs/QA/开发/v2-P0接线范围与push决策.md`。
> 监工起始指令：[p0-prompt.md](p0-prompt.md)。**实现用 agent team（TeamCreate 队员 ns-p0）非 fire-and-forget subagent**；串行、`addBlockedBy` 锁序。
> 状态：**spike + wire + verify 全完成 → 档位1 闭环达成**（verify 真浏览器层按决策 D 接受 D4 同构先例；残留极小 gap 登记）。

- [x] **P0·spike · 接线命门验证** ✅ **PASS（GO）** — [p0-spike.md](p0-spike.md)：profile.tools + guard noTools/customTools 共存（结论 + wire 约束见 ADR D-V1.1-12）
- [x] **P0·wire · 接线 profile 会话** ✅ **完成** — [p0-wire.md](p0-wire.md)：`profile-session-wiring.ts` 合并 guard options（sourceActor=profile.name）+ 单测；门禁 lead 复跑 301/tsc 0/eslint 0；决策 D-V1.1-13
- [x] **P0·verify · 双层闭环验收** ✅ **达成** — [p0-verify.md](p0-verify.md)：逻辑层四重（真 `startProfileSession`+faux，`spike/p0-wire-verify/` 14/14 lead 亲跑）+ 真浏览器层按**决策 D**（D4 同构 UI 闭环 12/12 先例；无凭证 + faux 该组合 finicky）；gap 登记

登记后续档位（档位1 稳后）：③dispatch worker 接线、idle 重建补 guard、主对话 gap——详见 QA v2-P0「后续待办」。

## 历史

V1 历史任务在 `tasks/v1-history/`（含 `decisions.md` 决策表）。
V1.1 决策可沿其编号风格续记（如 `D-V1.1-01`），便于回溯找 bug。
