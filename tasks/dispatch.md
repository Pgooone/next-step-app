# Iter C · 多 Agent 可协作

模块目标：Orchestrator 串行派发 2–3 角色 + 产物落盘 + 汇总视图。
规格：`../../next-step/docs/05-features-功能清单.md` §5.3；路线图 `docs/06` Iter C。
状态：⬜ 未开始（依赖 Iter B）

---

## C1 · Orchestrator 串行派发 — ⬜ 未开始
- 依赖：B2
- 涉及：`lib/domain/orchestrator.ts`、`app/api/projects/[id]/dispatch`
- 完成定义：按 assignments 依次起 worker 会话、产物落盘、**并发 ≤3**
- 验证：5.3 AC
- 注：并发 ≤3 闸门加在 `startRpcSession` 注册表卡点（基座层无兜底，需自实现）

## C2 · 派发面板 + 汇总视图 — ⬜ 未开始
- 依赖：C1
- 涉及：`components/DispatchPanel`
- 完成定义：显示每个 assignment 状态与产物链接
- 验证：5.3 AC
