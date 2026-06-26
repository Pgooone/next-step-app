# M5 · session-agent-mapping（功能#5 地基·承重墙）

领域层维护「会话 ↔ agent / 主对话」映射（会话无 `agentId` 且不改内核，故另存）。
批次 1（地基，无依赖，但须先做好供 M7/M8 接）。详见 详细设计.md · M5。

- [ ] 读 `lib/types.ts:174-184`（确认会话无 `agentId`）+ 现有 `lib/domain/` 范式（ProjectRegistry/AgentProfileStore）+ 一个现成领域 store + 一条会话 DELETE 链路
- [ ] 新建 `lib/domain/session-agent-map.ts`：数据结构 `SessionMap { mainSessionId: string|null; bySession: Record<string,string> }`，存盘 `<cwd>/.pi/ns-session-map.json`（原子写，照 `agent-profile-store.ts:189-193` 范式：临时文件 + `renameSync`）
- [ ] 领域接口：`getOwner(cwd,sid)` / `setOwner(cwd,sid,agentId)` / `getMain(cwd)` / `setMain(cwd,sid)`
- [ ] 新建 API `app/api/projects/[id]/session-map/route.ts`：`GET` → `SessionMap`；`PATCH` → 设 `mainSessionId` 或 增删 `bySession[sessionId]`
- [ ] 新建 `lib/stores/useSessionMapStore.ts`：前端状态（仿现有 store 的 fetch+refresh，带 projectId 维度）
- [ ] 删除清理 = 惰性清理：读映射时丢弃已不存在的会话项（兜底外部删 `.jsonl`），不挂 DELETE 链路
- [ ] 写/补单测（持久化往返、增删 owner/main、**惰性清理：读映射时丢弃已不存在会话项**、原子写）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 补 `lib/domain/README.md`（区 README 约定；API 路由目录免）
- [ ] 决策点：存盘位置 `<cwd>/.pi/ns-session-map.json`（已定 D-V1.1-01，见 `docs/设计决策记录.md`）→ 记入 `docs/设计决策记录.md`
- [ ] 不动内核会话文件（映射是附加元数据，守「不改内核」红线）
