# Iter D · 产物 Diff + 版本 + HITL（v2）

模块目标：Artifact 抽象 + 拦截编辑 + 面板渲染 + 按块确认 + 版本管理。
规格：`../../next-step/docs/05-features-功能清单.md` §5.4/5.5/5.6；路线图 `docs/06` Iter D。
状态：⬜ 未开始（依赖 Iter A 与 Iter C）

> ✅ **D2 的拦截机制已由 spike 预验证可行**，见 `../spike/d2-intercept/README.md`：
> 用 `noTools:"builtin" + customTools:[替身 write/edit]`，替身 execute 不写盘、转 PendingChange。
> **不能用 `excludeTools`**（会把同名替身剔除）。

---

## D1 · Artifact 抽象 + 版本表 — ⬜ 未开始
- 依赖：A1
- 涉及：`lib/domain/artifact-service.ts`、`.pi/artifacts/**`
- 完成定义：Artifact/ArtifactVersion 读写 + 乐观锁（`If-Match`）
- 验证：5.6 AC（提交/回退/冲突）
- 未决设计：受管 Artifact 识别用显式注册表 + `realpath→artifactId` 索引；纯文件乐观锁原子性（临时文件 + rename）

## D2 · 拦截编辑工具 → PendingChange — ⬜ 未开始（机制已预验证）
- 依赖：D1
- 涉及：`lib/pi/*` 工具拦截层
- 完成定义：对 artifact 的编辑不写盘、转 diff_blocks、暂存 PendingChange（标 source_actor）
- 验证：5.4/5.5 AC（不写盘）
- 实现：`createAgentSession({ noTools:"builtin", customTools:[替身] })`；details 复刻内置（write→undefined，edit→{diff,patch,firstChangedLine}）

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
