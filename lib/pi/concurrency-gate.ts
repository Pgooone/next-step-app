import { readMaxConcurrent } from "./factory-config";

/**
 * C1 —— 全局并发闸门（AC⑤：同时活跃会话数 ≤ 3）。
 *
 * 计数源是 rpc-manager 的进程级 registry（`globalThis.__piSessions`），它含**前端聊天会话**
 * 与**派发 worker 会话**两类——闸门约束的就是两者之和。派发本身是串行（一次只起一个 worker），
 * 故 worker 自身恒 ≤1 个槽；闸门真正起作用是在「前端已占满会话」时让下一个 worker 等待空位。
 *
 * 行为（决策见 decisions.md，待 lead 记）：**等待**而非拒绝——起 worker 前轮询直到
 * `activeCount() < limit` 才放行；带超时兜底，超时抛错由 orchestrator 据此判该 worker 失败，
 * 防止前端常驻会话把派发永久饿死。
 *
 * 设计为可注入：`activeCount` 默认读 globalThis registry，测试传桩计数器以脱离进程级状态。
 */

/** 默认并发上限（项目红线：并发会话 ≤ 3）。 */
export const MAX_CONCURRENT_SESSIONS = 3;

/** 默认计数源：rpc-manager 进程级 registry 的当前会话数（不存在则视为 0）。 */
export function activeSessionCount(): number {
  return globalThis.__piSessions?.size ?? 0;
}

/**
 * 等到「活跃会话数 < limit」再放行；超时则抛错（由调用方判该 worker 失败）。
 * 纯轮询实现（registry 无变更事件）：每 `pollMs` 检查一次，简单可靠、单进程足够。
 *
 * @param activeCount 当前活跃会话数取数器（默认读 globalThis registry，测试可注入）。
 * @param limit 上限（默认 {@link MAX_CONCURRENT_SESSIONS}）。
 * @param timeoutMs 最长等待（兜底防永久饿死）。
 * @param pollMs 轮询间隔。
 */
export async function acquireSlot(opts?: {
  activeCount?: () => number;
  limit?: number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<void> {
  const activeCount = opts?.activeCount ?? activeSessionCount;
  const limit = opts?.limit ?? readMaxConcurrent();
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const pollMs = opts?.pollMs ?? 100;

  const deadline = Date.now() + timeoutMs;
  while (activeCount() >= limit) {
    if (Date.now() >= deadline) {
      throw new Error(`活跃会话已达上限 ${limit}，请关闭部分会话后重试`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
