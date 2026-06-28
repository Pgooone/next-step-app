import { describe, expect, it } from "vitest";
import { evictAgentSessions, evictSession } from "./evict-agent-sessions";
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

describe("evictSession（第八轮：按单个 sessionId 逐出、不误删同 agent 其他会话）", () => {
  /**
   * faux registry：sidA/sidB **同属 agentX**（模拟「本阶段 worker sidA + 用户跨 run 接管 sidB」）。
   * `order` 跨会话共享调用序（断 abort 在 destroy 之前）；`ownerBySession` 模拟 owner-map（getOwner 反查、本测验零碰）。
   * faux destroy 只翻 alive（与生产 onDestroy→registry.delete 解耦：本测只验「目标 destroy / 同伴不动」，
   * 经 isAlive 观测，不依赖删 Map）。
   */
  function makeRegistry() {
    const order: string[] = [];
    const ownerBySession = new Map<string, string>();
    const map: Record<string, AgentSessionWrapper> = {};

    function mk(sid: string, agentId: string, opts: { streaming?: boolean } = {}) {
      let alive = true;
      const w = {
        isAlive: () => alive,
        inner: { isStreaming: opts.streaming ?? false },
        send: async (c: { type: string }) => {
          order.push(`${sid}:send:${c.type}`);
          return null;
        },
        destroy: () => {
          order.push(`${sid}:destroy`);
          alive = false;
        },
      };
      map[sid] = w as unknown as AgentSessionWrapper;
      ownerBySession.set(sid, agentId);
      return map[sid];
    }

    return { order, ownerBySession, map, mk, getSession: (sid: string) => map[sid] };
  }

  it("① 逐 sidA 只 destroy sidA、同 agent 的 sidB 仍 alive（不误删）", async () => {
    const r = makeRegistry();
    r.mk("sidA", "agentX");
    r.mk("sidB", "agentX");

    await evictSession("/root", "sidA", { getSession: r.getSession });

    expect(r.map.sidA.isAlive()).toBe(false); // sidA 被 destroy
    expect(r.map.sidB.isAlive()).toBe(true); // sidB 未被触碰
    expect(r.order).toEqual(["sidA:destroy"]); // 全程只动 sidA
  });

  it("② 流式会话先 abort 再 destroy（顺序）", async () => {
    const r = makeRegistry();
    r.mk("sidA", "agentX", { streaming: true });

    await evictSession("/root", "sidA", { getSession: r.getSession });

    expect(r.order).toEqual(["sidA:send:abort", "sidA:destroy"]); // abort 严格在 destroy 之前
  });

  it("③ evict 后 owner-map 仍映射 sidA→agentX（绝不碰 bySession/removeOwner）", async () => {
    const r = makeRegistry();
    r.mk("sidA", "agentX");
    r.mk("sidB", "agentX");

    await evictSession("/root", "sidA", { getSession: r.getSession });

    // getOwner 反查不变（owner-map 零碰、第五轮红线）
    expect(r.ownerBySession.get("sidA")).toBe("agentX");
    expect(r.ownerBySession.get("sidB")).toBe("agentX");
    expect(r.ownerBySession.size).toBe(2);
  });

  it("不存在 / 已死 / null 的 sid → 安全跳过、不 destroy、不抛", async () => {
    const r = makeRegistry();
    const dead = r.mk("dead", "agentX");
    (dead as unknown as { isAlive: () => boolean }).isAlive = () => false;

    await expect(
      evictSession("/root", "missing", { getSession: r.getSession }),
    ).resolves.toBeUndefined();
    await evictSession("/root", "dead", { getSession: r.getSession });
    await evictSession("/root", null, { getSession: r.getSession }); // catch 路径恒 null → no-op

    expect(r.order).toEqual([]); // 什么都没 destroy
  });
});
