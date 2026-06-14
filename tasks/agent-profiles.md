# Iter B · 多 Agent 可定义

模块目标：Agent 档案存储 + 管理 UI + 按档案注入起会话。
规格：`../../next-step/docs/05-features-功能清单.md` §5.2；路线图 `docs/06` Iter B。
状态：⬜ 未开始（依赖 Iter A）

---

## B1 · Agent 档案存储与三件套落盘 — ⬜ 未开始
- 依赖：A1
- 涉及：`lib/domain/agent-profile-store.ts`、`app/api/projects/[id]/agents/**`
- 完成定义：档案 CRUD + `.pi/agents/<id>/{agent.md,memory.md,agent.json}`
- 验证：5.2 AC（落盘）

## B2 · 按档案注入起会话 — ⬜ 未开始
- 依赖：B1、A2
- 涉及：起会话封装 `lib/pi/*`
- 完成定义：system prompt 注入 agent.md+memory（记忆只读注入）；应用 model/skills/tools/thinking
- 验证：5.2 AC（注入/生效）

## B3 · Agent 管理 UI — ⬜ 未开始
- 依赖：B1
- 涉及：`components/AgentManager`
- 完成定义：增删改档案可视化
- 验证：5.2 AC
