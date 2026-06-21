import { describe, expect, it } from "vitest";
import { evictAgentSessions } from "./evict-agent-sessions";
import type { AgentSessionWrapper } from "../rpc-manager";

/** 最小 faux wrapper：仅实现 evictAgentSessions 用到的 isAlive/inner.isStreaming/send/destroy。 */
function fakeWrapper(opts: { alive?: boolean; streaming?: boolean }) {
  const calls = { aborted: 0, destroyed: 0 };
  let alive = opts.alive ?? true;
  const w = {
    isAlive: () => alive,
    inner: { isStreaming: opts.streaming ?? false },
    send: async (c: { type: string }) => {
      if (c.type === "abort") calls.aborted++;
      return null;
    },
    destroy: () => {
      alive = false;
      calls.destroyed++;
    },
  };
  return { w: w as unknown as AgentSessionWrapper, calls };
}

describe("evictAgentSessions（方案B：改 mode 逐出存活会话）", () => {
  it("逐出该 agent 名下全部存活会话（返回被逐 sid 列表，验多会话全覆盖）", async () => {
    const a = fakeWrapper({});
    const b = fakeWrapper({});
    const map: Record<string, AgentSessionWrapper> = { s1: a.w, s2: b.w };
    const evicted = await evictAgentSessions("/root", "agent-A", {
      sessionsForAgent: () => ["s1", "s2"],
      getSession: (sid) => map[sid],
    });
    expect(evicted.sort()).toEqual(["s1", "s2"]);
    expect(a.calls.destroyed).toBe(1);
    expect(b.calls.destroyed).toBe(1);
  });

  it("在流式的会话：先 abort 再 destroy（防无头孤儿双写 jsonl）", async () => {
    const s = fakeWrapper({ streaming: true });
    const evicted = await evictAgentSessions("/root", "agent-A", {
      sessionsForAgent: () => ["s1"],
      getSession: () => s.w,
    });
    expect(evicted).toEqual(["s1"]);
    expect(s.calls.aborted).toBe(1);
    expect(s.calls.destroyed).toBe(1);
  });

  it("非流式会话：不 abort、直接 destroy", async () => {
    const s = fakeWrapper({ streaming: false });
    await evictAgentSessions("/root", "agent-A", {
      sessionsForAgent: () => ["s1"],
      getSession: () => s.w,
    });
    expect(s.calls.aborted).toBe(0);
    expect(s.calls.destroyed).toBe(1);
  });

  it("已死 / 不存在的会话安全跳过（不 destroy、不计入逐出列表）", async () => {
    const dead = fakeWrapper({ alive: false });
    const evicted = await evictAgentSessions("/root", "agent-A", {
      sessionsForAgent: () => ["dead", "missing"],
      getSession: (sid) => (sid === "dead" ? dead.w : undefined),
    });
    expect(evicted).toEqual([]);
    expect(dead.calls.destroyed).toBe(0);
  });

  it("无该 agent 会话 → 空数组、无副作用", async () => {
    const evicted = await evictAgentSessions("/root", "ghost", {
      sessionsForAgent: () => [],
      getSession: () => undefined,
    });
    expect(evicted).toEqual([]);
  });
});
