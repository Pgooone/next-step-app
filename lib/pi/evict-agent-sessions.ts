/**
 * 第六轮补丁 / 方案B —— 改 agent `mode` 后，把该 agent 名下**存活会话**从 rpc-manager registry 逐出，
 * 使其下一条消息走 re-attach 路径（{@link resolveOrReattachSession}）。re-attach 全链**现读磁盘 agent.json**
 * （`lookupProfile` 每次 `new AgentProfileStore().get` → `readProfile` 无缓存）→ 按**新 mode** 重建工具集：
 * doc→受限白名单（bash 即时消失）、coding→profile.tools（bash 恢复）。两方向对称。
 *
 * 为何「逐出 + re-attach 重建」而非「热改活会话工具集」：内核工具集/systemPrompt 绑定在 `createAgentSession`
 * 构造期、每次由内核 `_rebuildSystemPrompt` 现算，事后热改会被覆盖、与构造期语义冲突（见 agent-profile-session.ts
 * 注释 + 设计决策记录 D-MODE）。故只逐出、靠既有 re-attach 链重建。
 *
 * ⚠️ 红线：**只删 registry（destroy），绝不碰 bySession/removeOwner**——动 map 会让 re-attach 的 getOwner 返 null、
 * 误落 generic 分支、反塞回 write/edit/bash（即第五轮修过的 bug）。
 *
 * ⚠️ 数据正确性守卫：`wrapper.destroy()` 不调内核 `inner.dispose()/abort()`（rpc-manager.ts:230-236）；若逐出时
 * 会话**正在流式生成**，内核 agent 循环会变无头孤儿继续后台写同一 jsonl，re-attach 再开句柄并发追加 → jsonl 交错损坏。
 * 故逐出前对在流式的会话先 `send({type:'abort'})`（= `inner.abort()` + waitForIdle）终止在途回合，再 destroy。
 */
import { getRpcSession, type AgentSessionWrapper } from "../rpc-manager";
import { sessionsForAgent } from "../domain/session-agent-map";

/** 依赖口：生产走真实 import；测试注入 faux（不碰进程级 registry / 文件）。 */
export interface EvictDeps {
  sessionsForAgent?: (cwd: string, agentId: string) => string[];
  getSession?: (sid: string) => AgentSessionWrapper | undefined;
}

/**
 * 逐出某 agent 名下全部存活会话；返回被逐出的 sessionId 列表。
 * 对已 idle 销毁 / 不存在的 sid 安全跳过（getRpcSession 返 undefined / isAlive()=false）。
 *
 * @param projectRoot 项目根 cwd（= `ProjectRegistry.get(projectId).root`，bySession 落盘所在）。
 */
export async function evictAgentSessions(
  projectRoot: string,
  agentId: string,
  deps?: EvictDeps,
): Promise<string[]> {
  const lookup = deps?.sessionsForAgent ?? sessionsForAgent;
  const getSession = deps?.getSession ?? getRpcSession;
  const evicted: string[] = [];
  for (const sid of lookup(projectRoot, agentId)) {
    const w = getSession(sid);
    if (!w?.isAlive()) continue;
    // 在流式则先终止在途回合（防无头孤儿双写 jsonl），再逐出。
    if (w.inner.isStreaming) await w.send({ type: "abort" });
    w.destroy();
    evicted.push(sid);
  }
  return evicted;
}
