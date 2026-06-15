/**
 * B4 —— registerInnerSession 单测（D-B4-1：从 startRpcSession 末段提取的「会话注册」）。
 *
 * 用 faux inner（只实现 wrapper 注册路径用到的 sessionId / sessionFile / subscribe）驱动，
 * 不起真实内核会话、不触网。断言：登记后可经 getRpcSession 取回、真实 sessionId 正确、
 * subscribe 被订阅、destroy 后从 registry 摘除。
 *
 * 注意 registry 是进程级 globalThis.__piSessions，跨用例共享——每个用例用唯一 sessionId
 * 并在末尾 destroy，避免互相污染。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionLike } from "./pi-types";
import { getRpcSession, registerInnerSession } from "./rpc-manager";

/** 造一个最小 faux inner：仅覆盖 AgentSessionWrapper 注册/订阅路径用到的成员。 */
function makeFauxInner(overrides?: Partial<AgentSessionLike>): {
  inner: AgentSessionLike;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn().mockReturnValue(unsubscribe);
  const inner = {
    sessionId: `faux-${Math.random().toString(36).slice(2)}`,
    sessionFile: "/tmp/faux-session.jsonl",
    subscribe,
    ...overrides,
  } as unknown as AgentSessionLike;
  return { inner, subscribe, unsubscribe };
}

const created: string[] = [];
afterEach(() => {
  // 清理本测试登记进进程级 registry 的会话
  for (const id of created.splice(0)) getRpcSession(id)?.destroy();
});

describe("registerInnerSession", () => {
  it("登记后可经 getRpcSession 取回，且 realSessionId == inner.sessionId、已订阅事件流", () => {
    const { inner, subscribe } = makeFauxInner();
    created.push(inner.sessionId);

    const { session, realSessionId } = registerInnerSession(inner);

    expect(realSessionId).toBe(inner.sessionId);
    expect(session.sessionId).toBe(inner.sessionId);
    expect(session.isAlive()).toBe(true);
    // start() 内 subscribe 被调用一次（接事件流）
    expect(subscribe).toHaveBeenCalledTimes(1);
    // 进程级 registry 里能取回同一个 wrapper
    expect(getRpcSession(inner.sessionId)).toBe(session);
  });

  it("destroy 后从 registry 摘除（onDestroy 回调生效），且退订事件流", () => {
    const { inner, unsubscribe } = makeFauxInner();
    created.push(inner.sessionId);

    const { session } = registerInnerSession(inner);
    expect(getRpcSession(inner.sessionId)).toBe(session);

    session.destroy();

    expect(session.isAlive()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(getRpcSession(inner.sessionId)).toBeUndefined();
  });

  it("inner.sessionFile 为空时不抛（仅跳过缓存路径），仍正常登记", () => {
    const { inner } = makeFauxInner({ sessionFile: undefined });
    created.push(inner.sessionId);

    const { realSessionId } = registerInnerSession(inner);

    expect(realSessionId).toBe(inner.sessionId);
    expect(getRpcSession(inner.sessionId)).toBeDefined();
  });
});
