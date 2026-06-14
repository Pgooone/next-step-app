# Iter B · 多 Agent 可定义

模块目标：Agent 档案存储 + 管理 UI + 按档案注入起会话。
规格：`../../next-step/docs/05-features-功能清单.md` §5.2；路线图 `docs/06` Iter B。
状态：🔄 进行中（B1 ✅ B2 ✅，下一张 B3）

---

## B1 · Agent 档案存储与三件套落盘 — ✅ 已完成（commit 2c7187c）
- 依赖：A1
- 涉及：`lib/domain/agent-profile-store.ts`、`app/api/projects/[id]/agents/**`
- 完成定义：档案 CRUD + `.pi/agents/<id>/{agent.md,memory.md,agent.json}`
- 验证：5.2 AC①（落盘）；test 37/37、lint clean、build 成功
- 实现：AgentProfileStore 注入 ProjectRegistry 反查 root；agent.json 真相源、path 相对（D-20/21）；删档案删整个目录（D-19）；不校验 model/skills/tools（D-22）。②③④（注入）归 B2

## B2 · 按档案注入起会话 — ✅ 已完成
- 依赖：B1、A2
- 涉及：`lib/pi/agent-profile-session.ts`（+ `lib/pi/README.md`）；不碰内核 / `/api/agent/new` / `rpc-manager.ts`
- 完成定义：system prompt 注入 agent.md+memory（记忆只读注入）；应用 model/skills/tools/thinking
- 验证：5.2 AC①~④ 均有通过用例；test 50/50（其中本卡 13 个）、lint clean
- 实现：
  - **注入（D-24）**：`DefaultResourceLoader` + `appendSystemPromptOverride:(base)=>[块,...base]`，
    块用 `<agent_profile>` / `<agent_memory readonly>` 包裹；落在 append 段最前（基座之后、
    project_context/skills 之前）。实测扛 `setActiveToolsByName` 触发的 rebuild（D-24 证伪点已通过）。
  - **model（D-25）**：单 string 按首个 `/` 切 `provider/modelId`；空/无斜杠/查不到 → `modelFallback:true`
    用内核默认，不抛。
  - **skills（D-26）**：`skillsOverride` 按 name 过滤；缺失静默忽略并记 `diagnostics.missingSkills`。
  - **thinkingLevel**：`off|low|medium|high` 是内核 `ThinkingLevel` 子集，直传无需映射。
  - **边界（D-27/D-28）**：拥有 `assembleProfileSessionOptions` + `applyProfileRuntime` 两个真实函数，
    `createAgentSession` 调用留给调用方；空 tools 不清空 prompt。
  - **单测技能路径**：用 `additionalSkillPaths` 喂临时技能目录（不经 project trust 门，稳定可发现）。

## B3 · Agent 管理 UI — ⬜ 未开始
- 依赖：B1
- 涉及：`components/AgentManager`
- 完成定义：增删改档案可视化
- 验证：5.2 AC
