# Iter B · 多 Agent 可定义

模块目标：Agent 档案存储 + 管理 UI + 按档案注入起会话。
规格：`../../next-step/docs/05-features-功能清单.md` §5.2；路线图 `docs/06` Iter B。
状态：✅ 完成（B1 ✅ B2 ✅ B3 ✅ B4 ✅）

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

## B3 · Agent 管理 UI（纯 CRUD）— ✅ 已完成（commit 3e5f8d1）
- 依赖：B1
- 范围（D-29 用户拍板）：**只做增删改档案可视化**；「按档案接进真实起会话」的 wiring 拆 B4。
- 涉及：`components/AgentManager.tsx`（单文件多区 D-32）、`lib/stores/useAgentStore.ts`（D-33）、`components/AppShell.tsx`（加模态挂载入口）
- 完成定义：当前项目下列出/新建/编辑/删除档案（调 B1 CRUD API）；表单字段对齐 AgentProfile（name/role/model/skills/tools/thinkingLevel）
- 决策（D-30/31/32/33）：model 下拉(/api/models)+可留空、skills 多选(/api/skills?cwd)、tools 勾选内置集(read/bash/edit/write/grep/find/ls)、删除内联确认且文案强调「删整个 .pi/agents/<id>/ 目录」
- 验证：5.2 AC①（创建落盘的 UI 侧）；`useAgentStore` 单测（mock fetch）+ build + 人工。**AC②③④ 属 B2 单测 + B4 集成，不在 B3**
- 注：本环境无浏览器/凭证，组件渲染只能 build+人工（vitest 仅 include lib/**，无 RTL）

## B4 · 按档案起会话接线（wiring）— ✅ 已完成
- 依赖：B2、A2、B3
- 范围（D-29）：把 B2 注入封装接进真实起会话链路，使「起会话时按档案注入」端到端可用
- 涉及：新端点 `POST /api/projects/[id]/agents/[agentId]/session`（薄壳）+ `lib/pi/profile-session-wiring.ts`（组合层 `startProfileSession`）+ `lib/rpc-manager.ts` 新增 `registerInnerSession` + 前端 `AgentManager`「起会话」入口（行内 input 收首条 message）+ `AppShell` 接线；**未碰 `/api/agent/new`**
- 验证：5.2 AC②③④ 全 PASS；test 84/84、lint clean、build 11/11 页；**真浏览器 E2E**（Playwright+缓存 chromium）实测 live `systemPrompt` 含 role/memory 特征文本、改 role 后 `hasNewRole && !hasOldRole`、D-B4-8 两路验证、未复现 B3「按钮刷新卡死」
- 实现：
  - **E1 解法（D-B4-1）**：`registerInnerSession` 提取 `startRpcSession` 注册段为独立函数；端点自行 `createAgentSession` 注入档案 options，绕开旧 toolNames 段零冲突。
  - **组合层（D-B4-7）**：端点逻辑抽 `lib/pi/profile-session-wiring.ts`（route 退薄壳），依赖注入以便 faux 集成测（vitest 仅覆盖 lib/**）。
  - **懒落盘坑（D-B4-3）**：端点带首条 message 一步「建会话+发首条」（内核未发 prompt 懒落盘、会读到幻影空会话）；前端行内 input 收首条、禁 `window.prompt`。
  - **cwd（D-B4-2）**：取 `registry.get(id).root`，不从请求体。
  - **AC④ + agent.md 定位（D-B4-6 / D-B4-8）**：抽 `renderAgentMd` 给 create/update 共用；update **仅 name/role 实际变更才重写 agent.md**（保护手编内容），role 变更仍重写守 AC④。
  - **诊断（D-B4-5）**：`modelFallback` / `missingSkills` 仅 store `console.warn`。
  - **已知缺陷（D-B4-4）**：idle 重建丢 live 注入（model/thinking 回默认、systemPrompt 已落盘仍在），超 B4 范围、Iter D 再议。
- 契约：docs/04 已补 session 端点；决策 D-B4-1~8。
