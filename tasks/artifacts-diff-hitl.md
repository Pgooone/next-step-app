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

## D2 · 拦截编辑工具 → PendingChange — ⬜ 未开始（机制已预验证）
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

## D3 · ArtifactPanel 渲染（行内高亮/并排）— ⬜ 未开始
- 依赖：D2
- 涉及：`components/ArtifactPanel`（扩展 FileViewer）
- 完成定义：行内高亮 + 并排 Diff + TOC + 划选；块 >25 降级
- 验证：5.4 AC

## D4 · PendingChangeCard + 按块确认 — ⬜ 未开始
- 依赖：D2、D3
- 涉及：`components/PendingChangeCard`、ChatWindow
- 完成定义：YNRD + resolveBlock；全 resolve 后写盘 + 新版本
- 验证：5.5 AC

## D5 · 版本切换/回退/撤销重做 + SSE — ⬜ 未开始
- 依赖：D1、D3
- 涉及：ArtifactPanel、SSE 事件扩展
- 完成定义：版本下拉/rollback/双栈撤销；`artifact.created` 推送刷新
- 验证：5.6 AC
