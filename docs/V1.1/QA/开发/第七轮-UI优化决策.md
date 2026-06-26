# 第七轮 · UI 优化（diff 内联 + 全屏 + 对话框性能/跳转）—— 用户决策记录

> 2026-06-21。来源：用户「新一轮迭代计划」三条 UI 优化需求（A1 file panel 全屏化 + gsap 动画 + 悬浮二级菜单；A2 全屏后 diff 在原文就地展示；A3 对话框 diff 性能 + 左键点击跳转到原文）。
> 流程：ultracode 8-agent 调研（4 并行精读现状 + 3 设计 + 1 lead 整合）→ lead 对三条承重事实独立复验（A3 根因 `useAgentSession.ts` refresh 零命中 / A2 内核 buildSegments+InlineHighlightView 真存在且 data-block-id 未建 / A3 跳转可复用 diffFocusNonce 先例）→ 用户 AskUserQuestion 拍板。
> 详细设计：`../../第七轮-UI优化-diff内联与全屏/详细设计.md`｜lead ADR：`../../设计决策记录.md` D-R7-01~07。

---

## D-UI-01 · 全屏(A1)与内联确认(A2)的入口关系

**背景**：A2 原话「全屏化后 diff 在原文就地展示」。全屏是否是进入内联的唯一入口？非全屏侧栏态是否也支持内联就地确认？

**可选项**：
1. 仅全屏(A1)态默认/强制 inline 并启用内联就地 ✓/✗；非全屏侧栏态保持现状（可手动切 行内/Diff、确认走对话框卡片）。`data-block-id` 锚点两态都加（A3 跳转两态都可用），仅就地 ✓/✗ 限全屏。
2. 全屏与非全屏侧栏态都启用内联就地确认。
3. A2 内联与 A1 全屏完全独立、互不联动。

**推荐 + 理由**：选项 1。紧扣原话「全屏化后」；非全屏侧栏宽度仅 42%（globals.css:322），内联段再塞 ✓/✗ 易拥挤；A3 跳转锚点两态都加成本极低、不绑死全屏。这也定调 **A1 是 A2 的产品前置而非技术前置**——A2 承重墙不依赖 A1，只读 A1 的 `rightPanelFullscreen` 标志决定默认视图。

**谁拍 / 最终选择**：用户（AskUserQuestion）→ **选项 1（仅全屏启用就地确认）**。

---

## D-UI-02 · A2「原文内联 diff」用哪种形态（工作量总开关）

**背景**：「在原文就地展示 diff」是升格现有 `InlineHighlightView`（段级高亮）还是做全新 git 风格逐行 +/- diff？

**可选项**：
1. 升格现有 `InlineHighlightView` 段级高亮（复用 anchor.ts + HlSegment，工作量小、与 markdown 正文阅读一致）。
2. 全新逐行 +/- git 风格（每行带 +/- 前缀，需重做行级渲染）。

**推荐 + 理由**：选项 1。承重墙 anchor.ts:43 + HlSegment(ArtifactPanel.tsx:456) 已建好且经 D3 真浏览器验过，复用最省、风险最低；git 风格逐行会把 markdown 正文降为等宽纯文本、丢标题/列表/代码块渲染，违背用户「保留上下文参考价值」本意。此项是 A2 工作量的总开关。

**谁拍 / 最终选择**：用户（AskUserQuestion）→ **选项 1（升格现有内联高亮）**。

---

## D-UI-03 · A1「悬浮二级菜单」的具体形态

**背景**：A1 原话「悬浮于主界面的二级菜单样式」。全屏浮层是留边居中、占满除左栏、还是全屏覆盖？

**可选项**：
1. 留边居中浮层 + 半透遮罩（复刻 AgentManager：position:fixed inset 留边、rgba(0,0,0,0.35) backdrop、borderRadius:12、boxShadow '0 12px 40px rgba(0,0,0,0.25)'、点 backdrop 关闭）。
2. 占满除左侧栏外工作区（无 backdrop，更像最大化）。
3. 全屏覆盖含左栏（width:100vw，最沉浸但脱离「二级菜单」语义）。

**推荐 + 理由**：选项 1。原话「悬浮于主界面的二级菜单」强指向带 backdrop 的模态式悬浮；项目已有 AgentManager/ModelsConfig 同款视觉规格（AgentManager.tsx:271-293）可直接复刻，视觉一致、成本低；gsap Flip 从右侧栏位升起放大到居中浮层观感最佳。zIndex 取浮层 640 / backdrop 630（高于顶栏下拉 500、转交气泡 600，低于真模态 1000）。

**谁拍 / 最终选择**：用户（AskUserQuestion）→ **选项 1（留边居中浮层 + 遮罩）**。

---

## D-UI-04 · 对话框底部 diff 确认卡片（PendingChangeCard）去留

**背景**：A2 原话「不要孤立列 diff 块」主要指 file panel 的 DiffBlocksView，但对话框 PendingChangeCard 也是孤立列块形态、同读 pendingChanges。内联化后它怎么办？

**可选项**：
1. 保留为全局总览 / 全部一键 ✓✗ / YNRD 快捷键入口，内联段只做就地单块 ✓/✗（二者同源同步）。
2. 弱化为一行「N 处待确认，去全屏内联确认」入口。
3. 完全移除，确认仅在内联段。

**推荐 + 理由**：选项 1。内联就地适合「就着上下文逐块决策」，但「全部一键确认/拒绝」「键盘流 YNRD」在内联里反而不顺手；两入口同读 store.pendingChanges、同走 resolve API + 同一 refresh()，抽 `useResolveBlock` 共用逻辑后数据零分叉、互补不冲突；且非全屏侧栏态（D-UI-01 选项 1）仍需对话框卡片兜底。这是「避免改了 panel 漏了对话框」的关键拍板。

**谁拍 / 最终选择**：用户（AskUserQuestion）→ **选项 1（保留为总览 + 快捷键入口）**。

---

## D-UI-05 · 全屏内联是否放宽降级阈值 INLINE_HL_LIMIT=25

**背景**：现状块数 > 25 强制回退孤立列块 DiffBlocksView（degrade.ts:8），与 A2「保留上下文」相悖；但块极多时段级 markdown 重解析有性能代价。

**可选项**：1. 全屏态放宽阈值（如 80）再降级　2. 全屏态取消阈值（永远内联）　3. 保持 25 不变。

**推荐 + 理由**：选项 1（放宽到 ~80）。兼顾 A2 上下文意图与性能：InlineHighlightView 每个 Segment 各起独立 ReactMarkdown 实例（ArtifactPanel.tsx:446/502），块极多时重解析卡顿真实存在，放宽比彻底取消稳。注意 data-block-id 须同时加到 DiffBlocksView，使 A3 跳转在降级态仍落到并排 diff 块。

**谁拍 / 最终选择**：用户（默认采纳推荐）→ **选项 1（放宽到 ~80）**。

---

## D-UI-06 · doc 会话改未打开的 artifact 时是否自动打开

**背景**：T1 的 agent_end refresh 仅在 `selectedArtifactId` 非空时生效。若 doc 会话改了一个没被 open() 的 artifact，对话框仍不出 diff。

**可选项**：
1. 维持现状(a)：用户点文件树受管行才打开，refresh 仅在已打开态生效（最小、不扩交互面）。
2. 自动打开(b)：从 tool_execution_end/消息流取 propose_edit 结果里的 artifactId 自动 open() 并展开面板。

**推荐 + 理由**：选项 (a)，(b) 列为后续可选增强。代码核验：propose_edit 工具结果（doc-tools.ts:187）只返回 `{changeId, diffBlockCount}`，artifactId 是输入参数不在返回里；SSE 的 tool_execution_end 只带 toolCallId/toolName。实现 (b) 需另解析消息流的 toolResult 取 artifactId，引入额外复杂度且改变「用户主动打开」既有交互语义。(a) 已解决用户主诉（打开态下提议完即时出 diff）。

**谁拍 / 最终选择**：用户（默认采纳推荐）→ **选项 (a)（维持现状，(b) 后续增强）**。

---

## D-UI-07 · 点击对话框 diff 跳转是否强制进全屏

**背景**：A3 点击跳转时，是进入 A1 全屏态还是仅展开/保持右面板？

**可选项**：1. 仅展开右面板（`setRightPanelOpen(true)`，复用 diffFocusNonce 行为），不强制全屏　2. 点击即进入 A1 全屏态。

**推荐 + 理由**：选项 1。A1 全屏是用户独立开关，点击 diff 强制全屏会打断用户当前布局选择；「滚动到原文对应块」在侧栏态同样成立（锚点两态都加）。若 A1 落地后用户明确要「点击即全屏」，把 focusBlockNonce 也驱动 rightPanelFullscreen 即可低成本后加。

**谁拍 / 最终选择**：用户（默认采纳推荐）→ **选项 1（仅展开右面板）**。

---

## D-UI-08 · A1 退出全屏的交互入口

**背景**：用户原话未明确退出方式。现有悬浮层 AgentManager 用「点 backdrop 关闭」，项目有 BUG-04 Esc gap 教训。

**可选项**：1. 三路冗余（浮层头部「退出全屏」按钮 + 点 backdrop + Esc 键，仅全屏态挂监听、卸载移除）　2. 仅点 backdrop　3. 仅再点右上角切换钮。

**推荐 + 理由**：选项 1。现右上角 fixed 切换钮（AppShell.tsx:958 zIndex300）会被全屏浮层（zIndex640）盖住、单靠它不可达；项目 BUG-04 教训要求补 Esc；三路冗余最稳。Esc 监听须仅全屏态挂、卸载移除（避免重蹈 Esc gap）。

**谁拍 / 最终选择**：用户（默认采纳推荐）→ **选项 1（三路冗余）**。

---

## D-UI-09 · A1 gsap FLIP 取态范式 + reduced-motion 降级

**背景**：lead 实现级、但影响动画能否正确出现，列出供确认。

**可选项**：
1. FLIP 受控触发（切换前先 `Flip.getState` 存 ref，再 `useGSAP([fullscreen])` 内 `Flip.from`）+ reduced-motion 用手写 `window.matchMedia('(prefers-reduced-motion: reduce)')`（对齐 useTheme.ts:47 现有先例，reduce 时直切 class 不补间）。
2. useGSAP revertOnUpdate + gsap.matchMedia reduceMotion 条件。

**推荐 + 理由**：选项 1。受控触发最直观可靠、与 gsap-plugins skill 的 Flip 标准范式（getState→改 DOM→from）一致、不依赖 effect 执行顺序的隐式假设（useGSAP 在 class 已渲染后才跑，effect 内才 getState 会拿末态导致无位移）；reduced-motion 手写 matchMedia 与项目既有 useTheme.ts:47 先例统一。此项虽偏 lead 实现级（亦记 ADR D-R7-06），但因涉及动画正确性一并列出。

**谁拍 / 最终选择**：用户（默认采纳推荐）→ **选项 1（受控触发 + 手写 matchMedia）**。

---

## 小结

4 条总开关（D-UI-01/02/03/04）经 AskUserQuestion 全部采纳推荐：**仅全屏启用就地确认 / 升格现有内联高亮 / 留边居中浮层+遮罩 / 保留对话框卡片作总览**。5 条默认决策（D-UI-05~09）按推荐先行、用户可随时推翻。轮次：本 UI 轮占**第七轮**，原定「通用多 Agent 配置（软件工厂蓝图）」顺延**第八轮**（CLAUDE.md「做完往前、未做归最后」）。

---

# 第二轮 · 内联 diff 纠偏（2026-06-22）

> 用户复盘第七轮 A2/A3「你是否理解错了」+ 重新澄清需求。ultracode 5-agent 工作流对抗式核实（R1 论证 + R2 专门反驳，均 high-confidence `confirmed`、无确凿反例）坐实：第七轮 A2 对最常见 add/mod 改动**原文零内联呈现**、A3 点击**静默 no-op**。详见 `../../第七轮-UI优化-diff内联与全屏/第二轮-内联diff纠偏-详细设计.md` §一诊断。
> **本段 D-UI-10 取代第七轮 D-UI-02（升格段级高亮）。**

## D-UI-10 · 行内 diff 的视觉形态（重新拍板，取代 D-UI-02）

**背景**：D-UI-02 当时选「升格现有段级高亮、否决 git 逐行」，理由是「git 逐行会把 markdown 正文降为等宽纯文本、丢标题/列表渲染」。但该决策建立在**锚定其实是坏的**前提上（add/mod 用新行锚旧正文必落空）。用户重新澄清要「在原文中呈现 + 带颜色和边框 + 和查看 diff 界面一样修改删除新增」。三种实现观感/代价差异大。

**可选项**（AskUserQuestion 带 preview 示意）：
1. **C 混合**：未改动正文保留 markdown 富渲染（标题/列表/表格正常），改动处嵌入**带颜色边框的 git 风格 +/- 块**（复用「查看 Diff」同款卡片）。最贴合「原文中呈现 + 带边框 + 和查看 diff 界面一样」。代价：改动落在列表/表格/代码块**内部**时边界结构可能渲染略糙（罕见，保留「切并排 Diff」逃生口）。
2. **A 整篇 git 逐行**：整篇都用「查看 Diff」那种等宽 +/- 逐行（含未改动行作上下文）。最忠实「和查看 diff 界面一样」、最稳、零 markdown 解析风险。代价：未改动的标题/列表也变等宽纯文本、丢文档排版观感（= D-UI-02 原顾虑）。
3. **B 散文式富渲染**：整篇保留 markdown 渲染、只给改动行着色（旧行红删除线、新行绿底）。阅读体感最好。代价：须重写整篇单棵 AST + rehype，工作量与风险最大；且改动是「散文着色」而非用户说的 git 风格 +/- 边框。

**推荐 + 理由**：选项 1（C 混合）。同时满足「在原文中呈现」（未改动段保留富渲染）与「和查看 diff 界面一样、带颜色边框」（改动 run = 与查看 Diff 同一个 `DiffBlockCard` 组件）；改动 run 走 mono 不解析 markdown 天然安全；A 丢文档排版（违「在原文中呈现」本意）、B 工作量/风险最大且非 git 形态。

**谁拍 / 最终选择**：用户（AskUserQuestion，三方案 preview 对比）→ **选项 1（C 混合：原文富渲染 + 改动处嵌入带边框 git 块）**。

---

## 小结（第二轮）

用户拍板行内形态 = **C 混合**（取代 D-UI-02）。配套 lead 实现级取舍记 `../../设计决策记录.md` **D-R7B-01~06**（LCS ops 驱动取代 buildSegments 子序列锚定 / base 用 diff.oldContent 单条 replace、多条+patch 退回并排 / 两态都显 ✓/✗ 仍仅全屏 / 暴露 LCS 私有函数共用 / markdown 边界保真文档化+逃生口 / 验收造数据纠偏）。A1 全屏壳层、A3 信号机制、对话框卡片、agent_end refresh 全部保留不动。**待 greenlight 开 T1。**
