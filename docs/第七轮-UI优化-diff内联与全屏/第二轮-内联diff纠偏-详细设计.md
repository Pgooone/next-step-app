# 第七轮·第二轮 · 内联 diff 纠偏（让 diff 真正在原文行内呈现 + 对话框点击跳转落地）—— 详细设计

> 2026-06-22。来源：用户复盘第七轮 A2/A3「你是否理解错了」+ 重新澄清需求（见下）。
> 流程：ultracode 5-agent 工作流（对抗式核实「行内 diff 实际未渲染」R1 论证 + R2 专门反驳，二者均 high-confidence `confirmed`、无确凿反例 + R3 映射参照视觉/A3 接线 + R4 数据约束 → D1 综合）→ lead 复核 → 用户 AskUserQuestion 拍板行内形态。
> 决策 QA：`../QA/开发/第七轮-UI优化决策.md`（第二轮段 · D-UI-10）｜lead ADR：`../设计决策记录.md` D-R7B-01~06。
> **本轮取代第七轮 D-UI-02（升格段级高亮）及其锚定方案 D-R7-02。**

---

## 〇、缘起：用户重新澄清的真实需求（逐字）

> **1.** 展开 file panel 之后可以在行内看到 diff 的差异，和查看 diff 界面内的一样修改删除新增，但是需要带上颜色和边框等等直接在原文中呈现，就是在行内呈现。
>
> **2.** 聊天框内的 diff 可以点击每一条直接跳转到行内相应修改位置（与第 1 点呼应）。

第七轮把 A2 理解成「升格现有段级高亮 `InlineHighlightView`」、A3 理解成「点击跳转到 `data-block-id`」并都标了"验收通过"。**但实测：对最常见的 add/mod 改动，原文里根本看不到任何内联 diff，A3 点击也静默无反应。** 本轮纠偏。

---

## 一、诊断（已对抗式核实 · confirmed · high confidence）

**一句话**：第七轮 A2 的行内高亮锚定模型与「未确认不写盘」红线天然互斥——最常见的 add/mod 改动 100% 锚不到、落 `unaligned`、原文零内联呈现，用户只看到顶部一条「N 处变更无法在正文定位」黄条；A3 跳转因同一块在 inline 模式下没有 `data-block-id` 元素而 `querySelector` 落空、静默 no-op。

### 1.1 根因链（每条带 file:line）

1. **正文恒为旧内容**：`propose_edit` 只 `readCurrentContent`(旧) + `pendingStore.save`，绝不 `submitVersion`/物化（`lib/pi/doc-tools.ts:172-185`）→ `currentVersion` 不变 → `getArtifact` 返回当前版=旧内容（`lib/domain/artifact-service.ts:230-234`）→ `ArtifactPanel.tsx:407` 把 `artifact.content`（旧）喂给 `InlineHighlightView`。`doc-pipeline.test.ts:102` 显式断言 propose 后真实文件仍是旧内容。
2. **锚定拿新行找旧正文**：`buildSegments` 对 add/mod 用「块的新行 `b.lines`」作 anchor，在旧正文里 `findSubsequence` 找完全相等连续子序列（`lib/artifact-view/anchor.ts:69/74`）。「新行」按 LCS 定义就是**不在旧正文里**的行 → `findSubsequence` 必返回 -1（`anchor.ts:75`）→ 块进 `unaligned`、不生成任何 Segment。
3. **del 是唯一例外、但位置不可靠**：del 不锚定、直接堆 `delAt[cursor]`（`anchor.ts:64-66`），而 `cursor` 只在 add/mod 命中时前移（`anchor.ts:80`）；前置 add/mod 全锚不到时 `cursor` 停 0 → del 渲染到文档顶部而非真实位置。且相邻 del+add 常被 LCS 贪心并成 mod（`pending-change-service.ts:165-166`），连删除线都没了。
4. **A3 连带失效**：四环机制（`PendingChangeCard` 行 onClick→`requestBlockFocus`→`ArtifactPanel` effect `querySelector([data-block-id])` 滚动+脉冲→`AppShell` 展面板）都接通且 id 链一致；但 `requestBlockFocus` 硬切 `viewMode='inline'`（`useArtifactStore.ts:207`），unaligned 块在 inline 下无 `data-block-id` 元素 → `querySelector` 落空 → `ArtifactPanel.tsx:172` guard 直接 return（点了像没点）。

### 1.2 验收为何漏过

`scripts/d3-e2e-fixture.mts:95-99` 与 `lib/artifact-view/anchor.test.ts:50/61` 都**人为把"新内容"预置进正文**（`content: A_NEW` 而非旧内容）才让锚定命中。fixture 注释（`:91-94`）甚至自证「若正文用 A_OLD，add/mod 新行锚不到→全进 unaligned」——等于把"真实流程必坏"的 case 反向造成了"通过"。**这是本轮根因之一，T4 必须纠偏。**

---

## 二、决策（用户拍板 + lead 实现级）

| # | 决策 | 选择 | 出处 |
|---|---|---|---|
| **D-UI-10** | 行内 diff 形态（用户拍板） | **C 混合**：未改动正文保留 markdown 富渲染，改动处嵌入**带颜色边框的 git 风格 +/- 块**（复用「查看 Diff」同款卡片） | AskUserQuestion（带三方案 preview） |
| D-R7B-01 | 数据驱动 | **改用 PendingChange 自带的 LCS ops（`oldContent→newContent` 的 equal/del/add 有序序列）按真实顺序渲染整篇**，取代 `buildSegments` 子序列重锚；消除 `unaligned` 概念 | lead ADR（取代 D-R7-02） |
| D-R7B-02 | 渲染 base + 作用范围 | base 用**单条 PendingChange 的 `diff.oldContent`**（保证 LCS 自洽）；正常路径 propose 去重闸保证同文档 ≤1 条 pending；**多条 / `op=patch` 退回现有并排 `DiffBlocksView`** | lead ADR |
| D-R7B-03 | 显示范围 | 行内 diff **侧栏态 + 全屏态都渲染**（用户原话「展开 file panel 之后就能看到」）；就地 ✓/✗ **仍仅全屏**（沿用 D-UI-01） | lead ADR |
| D-R7B-04 | LCS 实现来源 | 把 `pending-change-service.ts` 的私有 `lcsDiff/splitLines/groupOpsToBlocks` **export**，渲染端与写盘端 `applyResolvedBlocks` **共用同一实现**，保证 `block.id` 对齐绝不漂移 | lead ADR |
| D-R7B-05 | markdown 边界保真 | 改动 run 走 mono git（不解析 markdown）**天然安全**；equal 段仍段级 markdown；结构（列表/表格/代码块）内部改动的边界糙度**文档化 + 保留「切并排 Diff」逃生口** | lead ADR（延续 D-R7-07） |
| D-R7B-06 | 验收造数据 | fixture/单测**必须**正文=旧内容 + 真实 `propose` 新内容；**禁止**预置新行的反向造法 | lead ADR |

> **取代关系**：D-UI-10 + D-R7B-01 取代第七轮 **D-UI-02**（升格段级高亮）与 **D-R7-02**（buildSegments 子序列锚定）。D-UI-01/03/04/05/06/07/08/09 与 D-R7-01/03/04/05/06/07 不受影响（A1 全屏壳层、A3 信号机制、对话框卡片、agent_end refresh 等全部保留）。

---

## 三、详细设计（按任务卡 T1~T4）

### 3.1 T1 · 数据层：暴露 LCS + 新建 `buildLineDiffSegments`

- `lib/domain/pending-change-service.ts`：把私有 `splitLines`（:76）/`lcsDiff`（:90）/`groupOpsToBlocks`（:145）改为 `export`（**逻辑零改、仅加关键字**）。理由：与写盘端 `applyResolvedBlocks`（:216-249）的「重放同一 LCS、第 k 个编辑组 ↔ `diffBlocks[k]`」共用同一实现，`block.id` 对齐不漂移（D-R7B-04）。
- `lib/artifact-view/anchor.ts`：新增纯函数 `buildLineDiffSegments(oldContent, newContent, diffBlocks)`：
  - `const ops = lcsDiff(splitLines(oldContent), splitLines(newContent))`；
  - 用与 `groupOpsToBlocks` **逐字相同**的聚块循环遍历 ops：连续 `equal` 行 → 产出 `{type:'equal', text}`；一个「连续 del 段 + 紧跟连续 add 段」编辑组 → 产出 `{type:'change', block: diffBlocks[blockIdx++], changeId}`；
  - 返回有序 `LineDiffSegment[] = ({type:'equal'; text} | {type:'change'; block: DiffBlock; changeId?})[]`；编辑组数与 `diffBlocks.length` 失配则抛/退化（与写盘端一致的健壮性）。
  - **关键**：顺序由 LCS 决定，每个改动 run 天然落在它前后的 equal 上下文之间，**不存在「锚不到」**。
- 保留旧 `buildSegments` 暂不删（避免连带破坏），T2 切换后由 lead 确认无引用再清理。
- **verify**：新增单测覆盖诊断里的 5 个真实 case（改一行措辞 / 中间插一段 / 纯删一段 / 删改合并成 mod / 改开头两句），断言每个改动 run 带正确 `block.id`、equal 段保留、顺序=LCS 序、无 `unaligned`。

### 3.2 T2 · 渲染层：抽 `DiffBlockCard` 共用 + `InlineHighlightView` 改混合渲染（C）

- **抽共用卡片**：把 `DiffBlocksView`（`ArtifactPanel.tsx:640-698`）每块的卡片 + `DiffLine` 渲染抽成 `<DiffBlockCard block dataBlockId resolve? fullscreen?>`。`DiffBlocksView` 改为 `blocks.map(b => <DiffBlockCard block={b} dataBlockId>)`。**这样行内改动块与「查看 Diff」用同一个组件 = 字面意义「和查看 diff 界面一样」**（复用 `KIND_STYLE` `:37-44`、四边 1px border + 左 3px、圆角 6、半透 kind 底、mono、`+/-` 前缀 `userSelect:none`、del/mod 删除线、白字 tag——R3 已给完整规格）。
- **`InlineHighlightView` 重写为混合渲染**：
  - 数据源改 `buildLineDiffSegments(base.oldContent, base.newContent, base.diffBlocks)`，`base` = 单条 PendingChange（见下分流）。
  - `segments.map`：`equal` 段 → `<Markdown>{text}</Markdown>`（空白跳过，保留现状）；`change` 段 → `<DiffBlockCard block changeId dataBlockId={block.id} fullscreen={isFullscreen} resolve={resolveBlock}>`。
  - 全屏态 + 块 pending + 有 changeId 时 `DiffBlockCard` 显示就地 ✓/✗（搬现 `HlSegment` 的 `canResolveHere` + `doResolve` 逻辑，仍走 `useResolveBlock`→resolve API，红线不绕过）。
  - **移除 `unaligned` 顶部黄条分支**（`:494-513`，新方案无 unaligned）。
- **分流（D-R7B-02）**：`pendingChanges.length === 1 && diff.kind === 'replace'` → 走上面的整篇混合内联；否则（多条 / `op=patch`）→ 退回 `DiffBlocksView`（摊平所有块的并排卡片，功能不丢）。降级阈值（`degrade.ts`，块数 >25/全屏 >80）逻辑保留：超阈值仍退 `DiffBlocksView`。
- 历史版（`viewingHistory`）分支保持只读（D-D5-4），不变。
- **verify（真浏览器，真实流程造数据）**：跑真实 `propose`（fixture 正文=旧内容、propose 新内容），改一行 / 插一段 / 纯删，都能在原文行内看到带颜色边框的增删改、equal 上下文在、无「无法定位」黄条、未改动的标题/列表仍正常渲染。

### 3.3 T3 · A3 跳转回归（机制不改，确认自动成立）

- A3 四环机制（`requestBlockFocus`/`focusBlockNonce`/`ArtifactPanel` effect/`AppShell` 展面板）**一行不动**——R3 已确认四环接通、id 链一致，现状唯一断点是「inline 模式下 add/mod 块没有 `data-block-id` 元素」，T2 让每个改动 run 都产出 `data-block-id={block.id}` 的 `DiffBlockCard` 后，`querySelector` 必命中、`scrollIntoView`+脉冲必生效。
- **落点层级**：`data-block-id` 挂在 `DiffBlockCard` 的**外层容器 div**（非逐行），保证横跨多行的 mod 块 `querySelector` 命中一个完整元素、`scrollIntoView({block:'center'})` 居中合理（风险登记，见 §五）。
- 多条/patch 退回 `DiffBlocksView` 时，其每块本就有 `data-block-id`（`:651`），但 `requestBlockFocus` 硬切 inline——此时若 effectiveMode 被分流成 diff，仍能命中（`DiffBlocksView` 在 diff 模式渲染）；**单条正常路径下不涉及**。是否放宽「硬切 inline」属可选加固，本轮不做。
- **verify（真浏览器）**：点对话框 diff 卡片每一条 add/mod/del，原文对应位置滚动居中 + 黄色脉冲 + 右面板展开；侧栏窄态与全屏态都能跳。

### 3.4 T4 · 验收造数据纠偏 + 全回归

- 把 `scripts/d3-e2e-fixture.mts` / `lib/artifact-view/anchor.test.ts` 里「正文预置新行（A_NEW）」的反向造法改为真实流程（`createArtifact` 存**旧内容**、再 `propose` newContent），坐实新渲染在真实流程下正确（D-R7B-06）。
- 保留并排 `DiffBlocksView` / 降级 / 历史版只读 / 全屏 A1 壳层 / agent_end refresh 全部零回归。
- **verify**：`npm run lint && npm run test` 全绿；真浏览器 + DeepSeek 真跑一次完整闭环（propose → 原文行内看到 diff → 点对话框跳转 → 就地 ✓/✗ 物化新版）。

---

## 四、改动清单（按 T 卡）

| T | 文件 | 改动 |
|---|---|---|
| T1 | `lib/domain/pending-change-service.ts` | `export` `splitLines`/`lcsDiff`/`groupOpsToBlocks`（逻辑零改） |
| T1 | `lib/artifact-view/anchor.ts` | 新增 `buildLineDiffSegments` + `LineDiffSegment` 类型；保留旧 `buildSegments` 待清 |
| T1 | `lib/artifact-view/anchor.test.ts` | 新增 `buildLineDiffSegments` 真实 case 单测 |
| T2 | `components/ArtifactPanel.tsx` | 抽 `DiffBlockCard`；`DiffBlocksView` 改用之；`InlineHighlightView` 改混合渲染（equal=Markdown / change=DiffBlockCard）+ 单条/多条/patch 分流 + 删 unaligned 分支 |
| T3 | （无代码改动） | A3 机制零改，仅真浏览器回归确认 |
| T4 | `scripts/d3-e2e-fixture.mts`、`lib/artifact-view/anchor.test.ts` | 造数据改真实流程（正文=旧、propose 新）；全回归 |

> **无新依赖**；全部在 `lib/artifact-view/` + `lib/domain/`（仅 export）+ `components/`，不碰 `lib/pi/**` 内核。

---

## 五、红线核验（全程不破）

| 红线 | 核验 |
|---|---|
| ① 不改 pi 内核 | 改动在 `lib/artifact-view/` + `components/` + `lib/domain/pending-change-service.ts`（仅加 export）；不碰 `lib/pi/**`、不动 SSE、不让内核多发事件 |
| ② 修改必经按块确认→才写盘 | 新渲染器是**纯只读渲染层**（只读 `diff.oldContent/newContent/diffBlocks` 画图）；就地 ✓/✗ 仍走 `POST .../resolve`→`resolveAndMaterialize`（唯一写盘点）；不新增写路径、不动 `DiffBlock` 类型、不动 `applyResolvedBlocks` 的 ordinal 重放（只借 `block.id` 当 DOM 锚） |
| ③ 写盘只经 resolveAndMaterialize | 同②，无新写盘点 |
| ④ 无 DB/鉴权/多租户 | 跳转态仍是前端瞬态 nonce（刷新归零）；pending 仍落盘侧车，不引存储 |
| ⑤ 并发会话 ≤ 3 | 本轮不开新会话，无关 |

> 特别说明：base 改用 `diff.oldContent`（而非 `artifact.content`）只影响**渲染端**——写盘端 `applyResolvedBlocks` 本就用 `change.diff.oldContent/newContent`（`:220-221`），渲染端与写盘端用同一 base 反而更一致。

---

## 六、markdown 边界保真：C 方案的已知限制（D-R7B-05）

C 方案下 equal 段各起独立 `<Markdown>`、change run 走 mono git 块。**改动本身永远安全**（不解析 markdown）。唯一糙点：当一个 markdown 结构块（有序列表/围栏代码/表格/引用）**内部**有改动时，该结构的未改动部分会被切成独立 equal 片段单独渲染——可能序号重置/围栏不闭合/表格断裂（与第七轮 D-R7-07 同源、非新问题）。

- **常态无碍**：散文文档的改动通常对齐到段落/标题/整条列表项边界，边界落在结构之间、渲染干净。
- **逃生口**：保留「查看 Diff」切换按钮（`ArtifactPanel.tsx:344-362`）；结构内部改动渲染不佳时用户可一键切到并排 `DiffBlocksView` 看完整逐块。
- **彻底方案**（整篇单棵 markdown AST + rehype 按 `data-block-id` 包裹）= 用户三选里被否的 B，工作量与风险最大，**本轮不做**，留作后续可选增强。

---

## 七、验收要点（每条必走真浏览器 · browser-e2e skill · 真实流程造数据）

- **数据造法**：`createArtifact` 存旧内容 → doc 会话 `propose_edit` 提议新内容（**禁止**预置新行的反向 fixture，否则重蹈验收漏过）。
- **T1**：单测覆盖 5 个真实 case，每个改动 run 带正确 `block.id`、顺序=LCS 序、无 unaligned。
- **T2**：真实 propose 后，原文行内看到带颜色边框的增删改（与「查看 Diff」同款卡片）、equal 上下文在、未改动标题/列表正常渲染、无黄条；全屏态就地 ✓/✗ 能真物化出新版；侧栏态也渲染行内 diff（无 ✓/✗）。
- **T3**：点对话框 diff 每一条 → 原文对应块滚动居中 + 脉冲 + 右面板展开；两态都能跳。
- **T4**：`lint && test` 全绿；并排 Diff/降级/历史版/A1 全屏零回归；DeepSeek 真跑完整闭环。

---

## 八、关联文档

- 用户决策 QA：`../QA/开发/第七轮-UI优化决策.md`（第二轮段 · D-UI-10，本轮取代 D-UI-02）
- lead ADR：`../设计决策记录.md`（D-R7B-01~06）
- 第七轮原设计：`./详细设计.md`（A1 全屏壳层 / A3 信号机制 / 对话框卡片在本轮全部保留）
- 调研全量结论：本轮 5-agent 工作流输出（R1/R2 对抗式核实 confirmed + R3/R4 + D1 综合）
- 进度 + 任务卡：`../../tasks/第七轮-UI优化-diff内联与全屏/progress.md`（第二轮段）
