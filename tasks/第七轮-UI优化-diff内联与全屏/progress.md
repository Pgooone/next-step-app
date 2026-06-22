# 第七轮 · UI 优化（diff 内联 + 全屏 + 对话框性能/跳转）—— 进度与任务卡

详细设计 `docs/第七轮-UI优化-diff内联与全屏/详细设计.md` ｜ 决策 QA `docs/QA/开发/第七轮-UI优化决策.md` ｜ ADR `docs/设计决策记录.md` D-R7-01~07
范围：纯前端展示/交互层（components / lib/artifact-view / lib/stores / hooks / globals.css / 新建 gsap-setup / package.json）。不碰 pi 内核、不碰 doc-session 受限白名单、不动写盘 resolveAndMaterialize 路径。
承重墙铁律：只借 `DiffBlock.id` 当 DOM 锚（渲染层只读），绝不给 DiffBlock 加位置字段让写盘依赖。

## 状态总览

- [x] **T1 · A3-性能 propose 后自动刷新**（独立、最先做）—— ✅ 实现+逻辑门禁绿，commit `06e77f8`；真浏览器随 T3/T4 整体验
- [x] **T2 · 承重墙数据层**（anchor 补 changeId 可选第三参 + store 加 focusBlockId/Nonce/requestBlockFocus）—— ✅ 实现+逻辑门禁绿；**未建 selectPendingBlocksWithChange**（避 D-D3-10：新建 {block,changeId} 包装对象 selector 每次引用不同→useShallow 失效无限重渲染；changeId 映射改由 T3 ArtifactPanel useMemo 从稳定 pendingChanges 就地构造）
- [x] **T3 · A2 内联渲染 + 就地确认 + A3 锚点消费**（ArtifactPanel）—— ✅ 实现+lead 独立验收（diff+门禁；resolve 运行时契约核实与服务端/卡片三方一致）；新建 `hooks/useResolveBlock.ts`；就地✓✗ 需 T5 全屏标志、跳转需 T4 源端→真浏览器随 T4/T5 整体验
- [x] **T4 · A3 源端 + AppShell 接线**（PendingChangeCard + AppShell）—— ✅ 实现+lead 验收（BlockRow onClick→onFocus()+onJump()，block.id 在 ChangeCard 行 `onJump={()=>onJumpToBlock(b.id)}` 绑定→requestBlockFocus(b.id)；AppShell focusBlockNonce→setRightPanelOpen，仅展开不全屏 D-UI-07）；去重#3 放弃（PendingChangeCard.resolve 契约已三方一致、避回归不强改，D-R7-05 订正）；YNRD/全部/Esc 无回归
- [x] **T5 · A1 全屏 gsap 外壳**（AppShell + globals.css + gsap-setup + package.json）—— ✅ 实现+lead 验收（gsap@3.15+@gsap/react@2.1 装；FLIP 受控取态 getState→setState→useGSAP Flip.from；reduced-motion 直切；Esc 仅全屏挂卸；backdrop 常驻 autoAlpha；isFullscreen 传 ArtifactPanel；globals.css 全屏 class transition:none+>* width/min-width 100%!important 让位 gsap；移动端隐藏全屏钮）；逻辑门禁绿（test 375/375、tsc 零新错）；**真浏览器待集中验**

依赖：T2 → T3 → T4 串行（数据→渲染→源端，A2/A3-跳转同验）；T1 独立先行；T5 可与 T2~T4 并行、建议紧接 T3 收尾。
每张 UI 卡按项目硬规矩走真浏览器验收（browser-e2e skill）。每卡门禁绿即细粒度 commit（记忆 `next-step-commit-per-task`）。

---

## T1 · A3-性能「propose 后 diff 自动刷新」

**文件**：`hooks/useAgentSession.ts`
**做**：
- 新增 `proposedThisTurnRef = useRef(false)`；
- `agent_start`(:249) 清零；
- `tool_execution_end`(:302) 识别 `event.toolName === "propose_edit"` → 置位；
- `agent_end`(:254 末尾) `if (proposedThisTurnRef.current && useArtifactStore.getState().selectedArtifactId) useArtifactStore.getState().refresh();` 后清零。

**AC**：
- ① AI 调 propose_edit 完成后，对话框 diff 卡片**无需手动重开 artifact 即自动出现**（真浏览器跑一次 propose_edit 坐实，对比修复前）。
- ② 本回合未调 propose_edit 时不触发 refresh（不空打 fetch）。
- ③ artifact 未 open（selectedArtifactId 为 null）时 refresh 是 no-op、不报错（维持现状 D-UI-06）。

**verify**：真浏览器 DeepSeek 真实对话跑 propose_edit；dev 日志确认 refresh 仅在 propose 回合发出。

---

## T2 · 承重墙数据层

**文件**：`lib/artifact-view/anchor.ts`、`lib/stores/useArtifactStore.ts`
**做**：
- anchor：`Segment` 的 `hl` 变体加 `changeId`；`buildSegments` 入参从扁平 `DiffBlock[]` 改为带 changeId 上下文（如 `{block, changeId}[]`）。仅渲染/锚定层。
- store：新增 `selectPendingBlocksWithChange`（保留 changeId，**订阅侧必须 useShallow**）；新增 `focusBlockId:string|null`(初 null) + `focusBlockNonce:number`(初 0) + `requestBlockFocus(blockId)`（set 切 viewMode='inline'、写 focusBlockId、nonce+1，复刻 diffFocusNonce）。

**AC**：
- ① `anchor.test.ts` 既有锚定用例全绿、不回归（changeId 补强不改锚定结果）。
- ② `requestBlockFocus` 行为 = 切 inline + focusBlockId + nonce+1（单测）。
- ③ focusBlockId/Nonce 是标量、不返回新数组（无 useShallow 风险）；selectPendingBlocksWithChange 派生加 useShallow 防 D-D3-10。

**verify**：vitest 锚定/store 单测；真浏览器订阅不崩（D-D3-10）。

---

## T3 · A2 内联渲染 + 就地确认 + A3 锚点消费

**文件**：`components/ArtifactPanel.tsx`
**做**：
- `HlSegment`(:456) 根 div 加 `data-block-id={seg.block.id}`；`DiffBlocksView` 块(:521) 加 `data-block-id={b.id}` 兜底。
- `HlSegment` 角标加就地 ✓/✗（pending 显示、已决显示状态标）→ 调同一 resolve API + refresh（复用 T4 抽出的 `useResolveBlock`）。
- `effectiveMode`(:151) 全屏态默认/强制 inline（读 A1 `rightPanelFullscreen`，D-UI-01）；全屏态降级阈值放宽到 ~80（D-UI-05）。
- 新增 effect 订阅 `focusBlockNonce`(>0)→`contentRef.querySelector('[data-block-id="'+CSS.escape(id)+'"]')`+`scrollIntoView({block:'center'})`+短暂高亮脉冲（照抄 TocSidebar.jump :366-368）。
- 保留 unaligned 兜底提示(:424)；历史版分支保持只读（D-D5-4）。

**AC**：
- ① 全屏态默认 inline、diff 就地高亮在原文（add 绿/del 红删除线/mod 黄）。
- ② 内联段就地 ✓/✗ 能**真物化出新版**（走 resolveAndMaterialize，不绕过红线）。
- ③ `focusBlockNonce` 触发后滚动到对应 data-block-id 段并脉冲高亮。
- ④ unaligned 块顶部兜底提示在；历史版只读无 ✓/✗。

**verify**：真浏览器全屏内联高亮 + 就地确认真物化 + 跳转滚动；markdown 段级解析限制按§五文档化、承认跨结构块可能降级。

---

## T4 · A3 源端 + AppShell 接线

**文件**：`components/PendingChangeCard.tsx`、`components/AppShell.tsx`
**做**：
- PendingChangeCard：订阅 `requestBlockFocus`，ChangeCard/BlockRow 透传；`BlockRow`(:313) 行容器 onClick → `onFocus(); requestBlockFocus(block.id);`（✓/✗ 已 stopPropagation :380/389）。抽 `useResolveBlock(artifactId)` 供内联段（T3）与卡片共用。卡片**保留**作总览/全部✓✗/YNRD（D-UI-04）。
- AppShell：`focusBlockNonce` 接进现有 `diffFocusNonce` effect(:157-160)——`>0` 时 `setRightPanelOpen(true)`（D-UI-07 仅展开、不强制全屏）。

**AC**：
- ① 左键点对话框 diff 块 → 右面板自动展开 + 滚动高亮到原文对应块。
- ② 点 ✓/✗ 不误触跳转（stopPropagation 生效）。
- ③ 对话框卡片与内联段双入口数据一致（同 store.pendingChanges、同 resolve+refresh，抽 useResolveBlock 不漂移）。

**verify**：真浏览器点击跳转 + 双入口一致性（与 T3 协同验）。

---

## T5 · A1 全屏 gsap 外壳

**文件**：`package.json`、`lib/gsap-setup.ts`(新建)、`components/AppShell.tsx`、`app/globals.css`
**做**：
- package.json 加 `gsap@^3.15.0` + `@gsap/react@^2.1.2`。
- 新建 `lib/gsap-setup.ts`：`gsap.registerPlugin(useGSAP, Flip)` 一次。
- AppShell：`rightPanelFullscreen` state + panelRef/backdropRef + 进全屏前 setRightPanelOpen(true) + useGSAP FLIP（D-UI-09 受控触发：切换前 Flip.getState 存 ref）+ backdrop autoAlpha + 退出三路(头部按钮/backdrop/Esc，仅全屏挂监听卸载移除)+ reduced-motion 直切。
- globals.css 桌面段加 `.right-panel-container.right-panel-fullscreen`（position:fixed 留边 + zIndex:640 + transition:none 让位 gsap + 圆角/投影/border）+ `> * {width:100%!important}`（覆盖 :331 钉宽）+ backdrop(zIndex:630, rgba(0,0,0,.35)，复刻 AgentManager:271-293)。

**AC**：
- ① 侧栏 ↔ 全屏 FLIP 升起/落下顺滑（transform 合成，非 width 重排）。
- ② 全屏 = 留边居中悬浮浮层 + 半透遮罩盖主界面（D-UI-03）。
- ③ 退出三路全可用（头部按钮 / 点 backdrop / Esc）。
- ④ reduced-motion 直切不补间；明暗两套色正常；移动端不套浮层。
- ⑤ 无 Flip 残留 inline style、无切换卡死。

**verify**：真浏览器升起/落下 + 退出三路 + reduced-motion + 明暗 + 移动端断点。

---

> 注：本轮按项目流程先出详细设计 + QA + 任务卡，等用户复审/greenlight 再开 T1。实现用 agent team 串行（lead 验收即 commit + 派下一卡，记忆 `v2-impl-handoff-cadence`）。
