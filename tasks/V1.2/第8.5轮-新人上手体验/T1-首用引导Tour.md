# T1 · 首用引导 Tour（tentpole · medium）

> 设计依据：`前端设计.md` §1 + 台账 D-V1.2-57/58。本轮最大一卡，含一个技术 ADR。

## 目标
首次进工作台自动弹**分层引导**：总览 5 步（默认）+ 深度 6 步（按需「深入引导」），暗遮罩+spotlight 聚光，可上一步/下一步/跳过；顶栏「🧭 新手引导」随时重看；看完/跳过落 seen 标记不再自动弹。

> 🔧 **本卡已经 2026-06-29 审计订正（2 道承重 blocker + 1 minor，详 前端设计.md §1 订正 + ADR D-R8.5-02/03）**。先做 mini-spike，再铺全步。

## 0. 承重前置改造（blocker 1·开工第一步·见 §1 承重订正）
深度轨 `before()` 切模态子视图的能力**当前不存在**（`PipelineModal` tab/view :40-41、`AgentManager` view :93 全是内部私有 `useState`，`AppShell` 只有布尔开关 :60-61）。故**先做组件改造**（附加式加 prop / 提状态，**不改既有交互语义**）：
- [ ] `PipelineModal` 加 `initialTab?`/`initialView?`/`initialBlueprintId?` props（mount 时 set 一次内部 state）。
- [ ] `AgentManager` 加 `initialView?`（`list|create`）。
- [ ] `AppShell` 持一份 tour 编排 state，深度轨 `before()` set 后再 mount 对应模态（或经上述 props 传入）。
- [ ] **mini-spike（prompt §2）**：先打通「外部设初始 view + spotlight 锚到模态内部元素 + 空环境一条最小链路」，绿了再铺全步——别纸面假设直接全做。

## 改动点
- **新增 `components/OnboardingTour.tsx`**：自定义 overlay 引擎
  - spotlight：`box-shadow: 0 0 0 9999px rgba(17,17,20,.5)` 镂空高亮 + 2px 白边；锚目标 `getBoundingClientRect`+6px pad；用 **gsap** 做过渡（项目已装，勿引第三方 tour 库）。
  - tooltip：层级标签 + 第N/M步 + 标题 + 正文 + 步骤点 + 跳过/上一步/下一步；**定位优先右→左→下，最后钳制进视口**（行为基准 `tour-prototype-v2+` 的 place() 逻辑）。
  - 两轨配置 `TRACKS={overview:[5], deep:[6]}`；总览末步显示绿色「深入引导 →」切深度轨。
  - 深度轨每步 `before()`：经 §0 新增的 `initial*` props / tour 编排 state 驱动两模态初始 tab/view（开 Agents 表单 / Pipeline 两 tab / 空草稿蓝图编辑器）再高亮其中元素。**步 4/5/6 空环境降级**（见下）。
- **深度轨空环境降级（blocker 2·用户拍板 D-V1.2-64 = 锚恒在元素 + 降级文案）**：Tour 面向**零数据新用户**（无蓝图/run），运行条（`PipelineModal:159` 须 `blueprints>0`）/ 看板卡（`PipelineBoard:51` `isEmpty`）/ 阶段菜单（须有 run）**空环境不渲染**。故步 4 锚 Pipeline 空态区/「新建流水线」按钮 + 文案「建好蓝图后这里出现运行控制条…」；步 5/6 合并，锚 board 空态区 + 文案「跑起来后这里实时显示进度，点阶段卡可进会话/看产物」。**绝不对空态/不存在元素做 spotlight**。
- **`AppShell.tsx`**：首启触发（无 `tour-seen` 标记自动开，标记存 localStorage 或 `~/.pi`）；给目标元素加稳定 `data-tour-id`（底栏入口 `:529-603`、onboarding `:975-987` 等），勿依赖易变 class。
- **「🧭 新手引导」按钮落点（minor·审计 A5-3）**：AppShell **无跨工作台顶部条**（唯一 header 是 `:505` 传给 `SessionSidebar` 的 `headerSlot`）→ 复用 sidebar `headerSlot`（紧邻「回到项目墙」）或主区右上角悬浮按钮，本卡拍定并记 ADR。
- 深度轨触点组件：`AgentManager` / `PipelineModal` / `PipelineBoard` / 蓝图编辑器（经 §0 props 驱动初始 view；`StageSessionMenu` 空环境不锚）。

## AC（真浏览器 · :30141 真应用）
1. 首次进工作台自动弹总览第 1 步；走完 5 步（项目切换器→Agents→Pipeline→单聊→产物面板）。
2. 总览末步有「深入引导 →」，点击进深度轨；深度轨**真的经 `initial*` 打开 Agents/Pipeline 模态并切到目标子视图**（新建表单 / 两 tab / 空草稿编辑器），步 4/5/6 在空环境**锚恒在元素 + 降级文案、无锚点落空**。
3. **⚠️ 空环境深度轨必过**：用**全新零数据环境**（无 agent/蓝图/run）跑深度轨，步 4/5/6 不锚空态/不存在元素、`pageErrors=0`；**禁用预置蓝图/run 的 fixture 假绿**（第七轮教训）。
4. 暗遮罩+聚光风格；每步 tooltip 不溢出/不裁切。
5. 跳过/完成落 seen 标记，刷新不再自动弹；「🧭 新手引导」按钮（落点见改动点）可重看。
6. `pageErrors=0`；lead 亲看截图。

## DoD
lint/test/tsc 绿；**mini-spike 先绿**；AC 真浏览器全 PASS（含空环境深度轨）；ADR 记 `设计决策记录.md`：D-R8.5-01（overlay 自定义+gsap vs 库）、D-R8.5-02（两模态加 `initial*` 承重改造）、D-R8.5-03（空环境降级方案）、新手引导按钮落点；回写 progress。

## 依赖 / 批次
**批次 2**（prompt §3：T1 放最后——总览/深度轨要锚 Agents/Pipeline 入口与模态内部，而 T2〔流水线 UI〕、T3〔入口提权〕正改这些元素 → T1 放最后避免锚到被改元素返工）。§0 的两模态 `initial*` 改造是**附加 prop**、与 T2（只动两子浮层、不碰 PipelineStageCard 交互）不冲突。
