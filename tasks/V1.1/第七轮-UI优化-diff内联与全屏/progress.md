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

---

## 真浏览器集中验收（lead 亲跑 Playwright，2026-06-22）

dev :30141（next/font 离线优雅降级 fallback、不阻塞）；fixture = tsx 脚本直调领域服务在允许根造 项目+artifact(add/mod/del 三块)+非空会话（非 DeepSeek）。

**⚠️ 关键教训**：改 CSS 后 Turbopack `.next` 缓存会**服旧样式**——首轮「全屏没生效」是缓存假象（served CSS `fsRuleCount:0`）；**清 `.next` 重启后** lead 计算样式实测全屏面板正确 `position:fixed/width:1100px/x:316` + backdrop，**T5 CSS/FLIP 代码本身无误**。（验 UI 改 CSS 必先重启/清缓存。）

**B-R7-1（真 bug，已修 + 真鼠标复验）**：全屏「进入」钮 `.panel-fullscreen-btn` 侧栏态被右上角固定「Hide file panel」toggle（position:fixed top0 right0 zIndex300 36×36）完全遮挡，`elementFromPoint(钮心)`=toggle、真鼠标 click 超时 → 真用户打不开全屏。修：`marginRight 6→42` 左移让开该角（AppShell.tsx）。lead 真鼠标复验 `enterRealClick:OK` + 进全屏 `position:fixed/width:1100`。

**逐项真机 PASS**（lead 亲验，r7e2e 旁证）：
- P0 无崩 / 无 D-D3-10 无限重渲染（pageErrors []）
- A1 全屏 FLIP 浮层（清缓存后 1100px/x316 + backdrop）+ 退出三路（按钮/backdrop/Esc 真键鼠）
- A2 内联三色（绿 4ade80 / 黄 eab308 / 红 f87171）+ 就地 ✓ **真物化**（POST `/resolve` 200 → 块 confirmed，红线守住）
- A3 点对话框 diff 块 → 面板重开 + 滚动高亮（focusVisible）
- **仅逻辑/未真机**：T1 propose 后自动刷新（未跑 DeepSeek 真 propose_edit；agent_end gate refresh 逻辑已验、refresh 机制已由就地 ✓ 旁证）

---

## 第二轮 · 内联 diff 纠偏（2026-06-22，**实现 + 双层验收完成、已提交**）

> 第七轮 A2/A3 实测：**对最常见 add/mod 改动原文零内联呈现、A3 点击静默 no-op**（详见 `../../docs/第七轮-UI优化-diff内联与全屏/第二轮-内联diff纠偏-详细设计.md`）。上面「A2 内联三色 + 就地 ✓ 真物化」的真机 PASS 是 fixture 预置新行进正文（A_NEW）的反向造法掩盖了真实流程必坏——真实 propose 下正文=旧内容，新行锚不到。
> 根因：propose 阶段 `artifact.content`=旧内容（红线未确认不写盘），`buildSegments` 用「新行」锚「旧正文」必落空 → unaligned。用户拍板形态 **C 混合**（D-UI-10）。

| 卡 | 范围 | 状态 |
|---|---|---|
| T1 | 数据层：export lcsDiff/splitLines/groupOpsToBlocks + 新建 `buildLineDiffSegments`（LCS ops 驱动、无 unaligned）+ 真实 case 单测 | ✅ `c53a0e0`（7 真实流程单测） |
| T2 | 渲染层：抽 `DiffBlockCard` 共用；`InlineHighlightView`→`InlineDiffView` 混合渲染（equal=Markdown / change=DiffBlockCard）+ 单条/多条/patch 分流 + 删 unaligned + 删旧 buildSegments/HlSegment | ✅ `6dc3044` |
| **B（真崩 bugfix）** | **node:fs 进客户端 bundle 致全站 500**：anchor 值导入 pending-change-service（含 node:fs）→ `"use client"` 链拖进客户端、Turbopack 崩。修=抽纯算法到 `lib/domain/lcs.ts`，domain 与 anchor 共用。**独立 verifier 真浏览器揪出、lint/test/tsc 全漏** | ✅ `708a69e`（GET / 200 实测） |
| T3 | A3 跳转回归（机制零改） | ✅ 真浏览器确认（探针 pulsed=true + 落点存在） |
| T4 | 验收造数据纠偏 fixture（正文=旧内容） | ✅ `d3a64aa`（r7b-e2e-fixture/drive） |

排序：T1 → T2 → (bugfix B) → T3 → T4。A3 机制不动。lead ADR：`../../docs/设计决策记录.md` **D-R7B-01~07**（07=node:fs bugfix）。

### 双层验收（2026-06-22，HEAD `d3a64aa`）
**逻辑层**：lint 0 errors；anchor(7)+pending-change-service(42) 全绿；全量 test 唯一失败=doctor-checks 冷启动 flake（单跑 9/9 必过、与本轮无关）。
**真浏览器层**（独立 verifier 自写 fixture content=A_OLD + lead 亲 Read 截图核对，双独立）：
- **① 混合内联渲染 PASS**：equal 段真实 markdown 标题（slugCount=5）+ 3 个改动块 add/del/mod 带颜色边框 git 卡片（mono/+-前缀/del删除线）按文档顺序内联 + 新文本在原文可见 + **无 unaligned 黄条**（截图 `verify-r7b-02-inline-mixed.png`）。
- **② 点对话框 diff 条→跳转 PASS**：原文对应 `[data-block-id]` 块 pulsed=true（boxShadow rgba(234,179,8,0.6)）+ inViewport（截图 `verify-r7b-03-a3-jump.png`）。
- **回归「查看 Diff」真切并排 PASS**：点后 slugCount 5→0、equal 正文消失、3 卡片仍在（截图 `verify-r7b-04b-diffview.png`）。
- **pageErrors=0。**
**关键过程教训**：①lint/test/tsc 全过 ≠ app 能跑——node:fs 进客户端只有 dev(Turbopack)+真浏览器暴露；**UI 卡提交前必须真浏览器冒烟 GET / 200**。②lead 自己那次"卡在 dev 冷启动"的 shell 跑其实是 500 编译失败、被误读成"慢"；独立 verifier 用第二双眼定性为真崩。③`count=3` 这类判据在多视图下都成立、分不清——回归须用**确定性区分判据**（混合内联 slugCount>0 vs 并排 slugCount=0）。
