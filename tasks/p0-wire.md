# P0·wire · 接线 profile 会话（assembleArtifactGuardOptions）

档位1 核心改动：把 guard options 接进 profile 会话起会话链路，让自定义 agent 改受管
artifact 时被拦成 PendingChange。**仅此一处**（不碰主对话 `/api/agent/new`、dispatch、idle 重建）。
依赖 `p0-spike` PASS。详见 `../docs/QA/开发/v2-P0接线范围与push决策.md`。

- [x] 读 `lib/pi/profile-session-wiring.ts`(96-105) + `lib/pi/artifact-guard.ts`(43-56 deps / 149) + 入口 route `app/api/projects/[id]/agents/[agentId]/session/route.ts`
- [x] 定 `sourceActor` 取值（`profile.name` vs `agentId`）——查 `PendingChange.sourceActor` 语义 + UI 怎么展示「谁改的」，记决策
- [x] `profile-session-wiring.ts:105` createAgentSession 前合并 `assembleArtifactGuardOptions({sourceActor, cwd:projectRoot, registry, artifactService, pendingStore})` 的 options（按 spike 验证的合并策略 spread）
- [x] deps 注入：registry/artifactService/pendingStore 从何来（route 传 or wiring 内 new）——与既有 D1~D5 服务实例一致，**避免双实例**
- [x] 写单测：profile 会话装配出含 guard 的 options；受管写经会话被拦成 pending（faux）；非受管放行
- [x] 跑门禁：`vitest` + `tsc --noEmit` + `eslint` 全绿
- [x] 更新 `lib/pi/README.md`（接线说明）+ 单独 commit

**AC**：✅ **达成**——profile 会话起会话后，agent 对已存在受管 artifact 的 write/edit 被拦成 PendingChange、不写盘；普通文件写正常；单测 + 门禁全绿。

## 结果（2026-06-18 · ✅ 完成 / ns-p0 队员 wire-dev 实现，lead 亲验）

唯一生产改动点 `lib/pi/profile-session-wiring.ts`：建会话前合并 `assembleArtifactGuardOptions({sourceActor: profile.name, cwd}).options` → `createAgentSession({...options, ...guardOptions, ...createOptionsOverride})`。

- **deps 注入**：全仓库服务皆「每处 new 的文件后端实例、无内存单例」，故让 guard **默认其文件后端**即可（route 不改、不线程化依赖），与 resolve/pending 路由 `new PendingChangeStore()` 指向同一批 `.pi` 文件 → UI 读得到。「避免双实例」= 别传不同路径 registry。
- **sourceActor = profile.name**（决策 D-V1.1-13；`PendingChangeCard.tsx:227-229` 渲染「变更来自 <name>」，已核对）。
- **测试注入口** `guardDepsOverride?`（决策 D-V1.1-13，测试专用、生产省略 → 行为不变）。
- 单测 `profile-session-wiring.test.ts` +2 用例：受管 write→磁盘无文件+PendingChange 落盘(sourceActor=需求分析师)；非受管 write→落盘+pending=0。
- 门禁 **lead 复跑**：vitest **301 passed**、tsc **exit 0**、eslint **0**。
- 红线守：route/dispatch-runner/rpc-manager/内核/白名单语义零改；idle 重建丢 guard 登记为 P0 gap（JSDoc + README）。
- **commit 由 lead 统一做**（非队员；队员只实现 + 回报）。
