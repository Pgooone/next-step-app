# P0·wire · 接线 profile 会话（assembleArtifactGuardOptions）

档位1 核心改动：把 guard options 接进 profile 会话起会话链路，让自定义 agent 改受管
artifact 时被拦成 PendingChange。**仅此一处**（不碰主对话 `/api/agent/new`、dispatch、idle 重建）。
依赖 `p0-spike` PASS。详见 `../docs/QA/v2-P0接线范围与push决策.md`。

- [ ] 读 `lib/pi/profile-session-wiring.ts`(96-105) + `lib/pi/artifact-guard.ts`(43-56 deps / 149) + 入口 route `app/api/projects/[id]/agents/[agentId]/session/route.ts`
- [ ] 定 `sourceActor` 取值（`profile.name` vs `agentId`）——查 `PendingChange.sourceActor` 语义 + UI 怎么展示「谁改的」，记决策
- [ ] `profile-session-wiring.ts:105` createAgentSession 前合并 `assembleArtifactGuardOptions({sourceActor, cwd:projectRoot, registry, artifactService, pendingStore})` 的 options（按 spike 验证的合并策略 spread）
- [ ] deps 注入：registry/artifactService/pendingStore 从何来（route 传 or wiring 内 new）——与既有 D1~D5 服务实例一致，**避免双实例**
- [ ] 写单测：profile 会话装配出含 guard 的 options；受管写经会话被拦成 pending（faux）；非受管放行
- [ ] 跑门禁：`vitest` + `tsc --noEmit` + `eslint` 全绿
- [ ] 更新 `lib/pi/README.md`（接线说明）+ 单独 commit

**AC**：profile 会话起会话后，agent 对已存在受管 artifact 的 write/edit 被拦成 PendingChange、不写盘；普通文件写正常；单测 + 门禁全绿。
