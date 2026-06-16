# Iter D · 产物 Diff + 版本 + HITL（v2）

模块目标：Artifact 抽象 + 拦截编辑 + 面板渲染 + 按块确认 + 版本管理。
规格：`../../next-step/docs/05-features-功能清单.md` §5.4/5.5/5.6；路线图 `docs/06` Iter D。
状态：🔄 进行中（D1 ✅；D2–D5 ⬜）

> ✅ **D2 的拦截机制已由 spike 预验证可行**，见 `../spike/d2-intercept/README.md`：
> 用 `noTools:"builtin" + customTools:[替身 write/edit]`，替身 execute 不写盘、转 PendingChange。
> **不能用 `excludeTools`**（会把同名替身剔除）。

---

## D1 · Artifact 抽象 + 版本表 — ✅ 已完成
- 依赖：A1
- 涉及：`lib/domain/artifact-service.ts`、`.pi/artifacts/**`
- 完成定义：Artifact/ArtifactVersion 读写 + 乐观锁（`If-Match`）
- 验证：5.6 AC（提交/回退/冲突）
- 未决设计：受管 Artifact 识别用显式注册表 + `realpath→artifactId` 索引；纯文件乐观锁原子性（临时文件 + rename）
- ✅ **交付**：`artifact-service.ts`（`managed/<id>/` 隔离落盘 + currentVersion/version 双计数 + 写盘前 `assertVersionMatch` 乐观锁 + rollback 复制 + 跨项目 `findArtifact`）+ 5 路由 + `lib/api/if-match.ts`（鸭子类型解耦）；17 service 单测，test 135 / lint / build(11 页) 全绿；verifier 独立 PASS。决策 D-D1-1~7。`realpath→artifactId` 索引按 D-D1-4 留到 D2（避免赌 D2 接口）。

## D2 · 拦截编辑工具 → PendingChange — ✅ 已完成
- 依赖：D1
- 涉及：`lib/pi/*` 工具拦截层
- 完成定义：对 artifact 的编辑不写盘、转 diff_blocks、暂存 PendingChange（标 source_actor）
- 验证：5.4/5.5 AC（不写盘）
- 实现：`createAgentSession({ noTools:"builtin", customTools:[替身] })`；details 复刻内置（write→undefined，edit→{diff,patch,firstChangedLine}）
- **▶ 开工锚点（给新窗口 lead，省得到处翻）**：
  - **D1 衔接**：受管 artifact 识别走 `lib/domain/artifact-service.ts`——替身 write/edit 在 execute 里拿到目标写盘路径，判断是否落在某项目 `.pi/artifacts/managed/<id>/`（受管）；是则转 PendingChange 暂存、**不写盘**，否则放行正常写。`realpath→artifactId` 索引 D1 按 **D-D1-4 故意没预埋**，由 D2 按替身实际拿到的路径形态（相对/realpath/含 `..`）现建——这是 D2 头号待拍板点。
  - **数据模型**：`PendingChange` / `DiffBlock`（docs/03 已定义，含 `sourceActor`/`diffBlocks`/`state`）；落盘建议 `managed/<id>/pending/`（D1 目录已留空间），待 D2 拍板。
  - **机制（已验证，照搬别重证）**：`noTools:"builtin"` + 替身；`details` 必填且复刻内置形状；**严禁 `excludeTools`**；`Type` 从 `@earendil-works/pi-ai` import。详见 [[next-step-v2-diff-blocker]] + `../spike/d2-intercept/{README.md,harness.ts}`。
  - **待 D2 lead 拍板点**：① realpath→artifactId 索引形态与落盘；② PendingChange 落盘位置；③ 替身如何取当前 `sourceActor`（哪个 agent 发起）；④ diff_blocks 生成（复用内置 edit 的 diff/patch 还是自切块，参考 sf-mini §5.4 `DiffBlockView`）。
  - **参考**：D1 `artifact-service.ts`（`findArtifact`/`managed/` 布局）、spike、sf-mini；取产物/挂监听等内核命门见 [[next-step-c1-dispatch-runner]]。
- ✅ **交付**（方案甲 D-D2-6：仅拦截层+注入封装+faux 验证，未改业务端点）：装配最终选 **C**（D-D2-1，保留内置工具 + 内核 `createWriteToolDefinition/createEditToolDefinition` 注入 operations 自分流，零工具漂移）；新增 `lib/domain/pending-change-service.ts`（PendingChange/DiffBlock + 手写 LCS 行级切块 + 落盘 `managed/<id>/pending/`）+ `lib/pi/artifact-intercept.ts`（`resolveManagedTarget` 运行时识别、不建索引 D-D2-2）+ `lib/pi/artifact-guard.ts`（operations 自分流 + `assembleArtifactGuardOptions`）。用 agent team `ns-impl`（d2-impl 实现 + d2-verifier 独立验收）；test 164（新增 29）/lint/build(11 页) 全绿，**verifier 自写独立 fixture 交叉验证「受管编辑不写盘→PendingChange 落盘」3/3 PASS、10/10 验收项全过**。决策 D-D2-1~6。**已知 gap（留接线卡）**：接进 B4/C1 真实会话 + agent 读 artifact 当前内容的文件接口（内容存 versions/&lt;n&gt;.json 非裸文件、内置 read 读不到）。

## D3 · ArtifactPanel 渲染（行内高亮/并排）— ⬜ 未开始
- 依赖：D2
- 涉及：`components/ArtifactPanel`（扩展 FileViewer）
- 完成定义：行内高亮 + 并排 Diff + TOC + 划选；块 >25 降级
- 验证：5.4 AC
- **▶ 开工锚点（给新窗口 lead）**：
  - **D2 衔接（数据源）**：渲染数据 = `PendingChange.diffBlocks`（`lib/domain/pending-change-service.ts` 的 `DiffBlock`：`kind:add|del|mod` / `lines` / `state:pending|confirmed|rejected`）；PendingChange 已落 `managed/<id>/pending/<pendingId>.json`（`PendingChangeStore`），artifact 当前内容读 `artifact-service.getArtifact`。**op 恒为 `replace`**（D-D2-5：C 路线 edit 也走 replace），渲染只消费 diffBlocks、不依赖 op。
  - **state 驱动渲染**：`state≠pending` 的块渲染层过滤、高亮消失（docs/03 纯数据驱动）——这是与 D4 按块确认的接缝，D3 先按 state 过滤即可。
  - **参考**：扩展 pi-web `FileViewer`（非重写）；sf-mini 前端 `next-step/archive/sf-mini-frontend-*.md`：`InlineHighlightView`（行内高亮、子序列匹配锚定）/`DiffBlockView`/`DiffView`（并排）。
  - **待 D3 lead 拍板点**：① **前端怎么拿 pending——D2 只落盘没建读 API**（头号待拍板：需新增 GET 取某 artifact 的 pending）；② 扩展 FileViewer 还是新建 ArtifactPanel 包裹；③ 划选引用到对话框（`quoteText`）怎么接 ChatWindow；④ 块>25（`INLINE_HL_LIMIT`）降级并排的判定位置。
  - **红线/约定**：UI 卡**验收必走真浏览器 E2E**（[[next-step-browser-e2e]]，SSR/hydration bug 单测抓不到、B3 教训）；新增 `components/ArtifactPanel` 区配薄 README（[[next-step-area-readme-convention]]）；diffBlocks 是 D2 既定契约**别改**（要改回 D2）。
  - **不在 D3**：D2 留的 2 个接线 gap（接真实会话 / agent 读 artifact 文件接口）、按块确认写盘（D4）、版本切换（D5）。

## D4 · PendingChangeCard + 按块确认 — ✅ 已完成（commit `54503ec`，双层验收全 PASS）
- 依赖：D2、D3
- 涉及：`lib/domain/pending-change-service.ts`(新增 `applyResolvedBlocks`/`resolveBlock`/`resolveAndMaterialize`/`remove`、构造注入 ArtifactService)、`POST /api/artifacts/[id]/pending/[changeId]/resolve`(薄路由)、`lib/stores/useArtifactStore.ts`(新增 `refresh`/`diffFocusNonce`/`requestDiffFocus`)、`components/PendingChangeCard.tsx`(新建)、`components/ChatWindow.tsx`(挂载)、`components/AppShell.tsx`(+1 useEffect 监听 diffFocusNonce 展开右面板)
- 完成定义：YNRD + resolveBlock；全 resolve 后写盘 + 新版本 ✅
- 验证：5.5 AC 两层**全 PASS**——verifier 逻辑层独立复跑 222 tests/lint/build + 自写 8/8 fixture（混合行序、resolveAndMaterialize 双计数+1/删 pending、If-Match 并发取即时 version+陈旧→409）+ 红线全守；真浏览器 E2E 12/12、pageErrors 空、AC④ B 方案实测（收起面板→D→可靠展开并排 Diff）
- 实现要点：
  - **内容重建**（D-D4-1）：`applyResolvedBlocks(change)` 纯函数重放 lcsDiff+聚块、按块 state 取舍（confirmed 取新行 / rejected·pending 留旧行）；不变量「全 confirmed=newContent / 全 rejected=oldContent」+ 三块混合行序均已单测；仅 op=replace、失配/patch 抛 INVALID。
  - **逐块 resolve**（service）：`resolveBlock(...,{blockId?,action:'confirm'|'reject'})` 纯翻块 state 原子落盘（省 blockId=全 pending 块统一置态、幂等不回退已决）。
  - **写盘红线落 service**（D-D4-4/5）：「一组」=单条 PendingChange；写盘逻辑在 service `resolveAndMaterialize`——翻块后「全块非 pending」则 `applyResolvedBlocks`+注入的 `ArtifactService.submitVersion`(当前 version If-Match)+`remove`，返回 `{change, materialized, artifact?}`；resolve **路由退成薄调用**。6 条 service 级单测覆盖全决/未全决/逐块/全 reject/artifact 不存在。
  - **前端**：`PendingChangeCard`（仿 QuoteBar 挂 ChatWindow 底部、读 `useArtifactStore.pendingChanges` useShallow）逐块 ✓/✗ + YNRD（Y确认/N拒绝/R重生降级提示/D跳并排Diff、↑↓ 切聚焦块）；每次 resolve 后 `store.refresh()` 静默重拉（不重置 viewMode/不亮 loading）→ 行内高亮按新 state 消失（AC③）、全决时面板内容更新到新版（AC⑤）。
  - **D 键聚焦面板**（D-D4-3 选 **B** 最小信号版）：卡片 D 键调 `requestDiffFocus()`（切 viewMode='diff' + `diffFocusNonce`+1）；AppShell +1 useEffect 监听 nonce(>0)→`setRightPanelOpen(true)`——解决「面板收起后按 D 静默无反馈」，卡片不直接碰 AppShell 本地 state。**R 键降级**（D-D4-2）：保留键位、按下提示「需会话接线(D-D2-6)」，D4 不接真实重生。
  - 决策 D-D4-1~5（decisions.md）。

## D5 · 版本切换/回退/撤销重做 + SSE — ⬜ 未开始
- 依赖：D1、D3
- 涉及：ArtifactPanel、SSE 事件扩展
- 完成定义：版本下拉/rollback/双栈撤销；`artifact.created` 推送刷新
- 验证：5.6 AC
