/**
 * 第八轮 T1 承重 spike（hermetic）—— 坐实 evict-by-sessionId 的**逐出粒度正确**。
 *
 * 背景：第七轮 T6 留的跨 run 误杀（D-R7-07 决策2）—— 编排器每阶段跑完按 **agentId** 一锅端逐出该 agent
 * 全部会话，会把用户在另一条 run 里接管的同 agent 会话一并 destroy。第八轮收窄为 **按 stage.sessionId**
 * 逐出。承重命门：新函数 `evictSession(projectRoot, sessionId, deps?)` 按 sid 逐出时
 * **只 destroy 目标 sid、不误删同 agent 的其他活会话、流式先 abort、绝不碰 owner-map（bySession）**。
 *
 * 本卡用 **hermetic 单测**（纯 faux：不起真会话、不 import 任何生产 rpc-manager / node:fs）坐实它。
 * 候选 `evictSession` 实现按详设 §1.1 **内联**于本文件（T2 才落生产 `evict-session.ts`、T3 收官删本 spike）。
 *
 * faux 纪律（沿第七轮 T1/T3）：
 *  - `fauxMap` 是**唯一计数源**（模拟进程级 `__piSessions`），三处闭包同一 Map 实例：
 *    ① getSession 从它取 ② faux destroy 删它 ③ size/has 断言读它。
 *  - faux `destroy()` 默认**真删 fauxMap**（非仅翻标志）→ size 回落才有意义。
 *  - 负对照 / 变异检查是**真会因实现错误变红**的判别式（destroy 不删 Map ⇒ size 不回落；按 agentId 逐出 ⇒ 误删 sidB），不是摆设。
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionWrapper } from "../rpc-manager";

/* ───────────────────────── 候选实现（内联，详设 §1.1） ───────────────────────── */

/** evictSession 的依赖口（hermetic 注入 faux；生产走真实 getRpcSession）。 */
interface EvictSessionDeps {
  getSession: (sid: string) => AgentSessionWrapper | undefined;
}

/**
 * 按单个 sessionId 逐出：只 destroy 目标 sid、流式先 abort、**绝不**做 sessionsForAgent 反查、**绝不**碰
 * bySession / removeOwner。这正是「不误删同 agent 其他会话」「不破坏 re-attach 的 getOwner」的关键。
 */
async function evictSession(
  _projectRoot: string,
  sessionId: string,
  deps: EvictSessionDeps,
): Promise<void> {
  const w = deps.getSession(sessionId);
  if (!w?.isAlive()) return; // 不存在 / 已死：安全跳过
  if (w.inner.isStreaming) await w.send({ type: "abort" }); // 流式先终止在途回合（防 jsonl 双写）
  w.destroy(); // destroy → onDestroy → 真删 registry（faux 里 = 删 fauxMap）
}

/* ─────────────────────────────── faux harness ─────────────────────────────── */

type CallLog = string[];

interface FauxWrapper {
  inner: { isStreaming: boolean };
  isAlive(): boolean;
  send(cmd: { type: string }): Promise<void>;
  destroy(): void;
}

/**
 * 构造一套 hermetic 环境：返回 `fauxMap`（唯一计数源）、`ownerBySession`（owner-map 反查，模拟 bySession）、
 * `getSession`（注入给 evictSession 的依赖）、`order`（跨会话共享的调用序日志）、`mk`（造单个会话）。
 *
 * @param destroyDeletesMap 控制 faux destroy 是否真删 fauxMap：true=真删（默认，正常实现）；false=只翻 alive（负对照）。
 */
function makeHarness(destroyDeletesMap = true) {
  const fauxMap = new Map<string, FauxWrapper>(); // ← 唯一计数源（模拟 __piSessions）
  const ownerBySession = new Map<string, string>(); // ← owner-map（模拟 bySession）；getOwner(sid) 读它
  const order: CallLog = []; // ← 跨会话共享的调用序（断 abort 在 destroy 之前）

  /** 造一个会话并登记进 fauxMap + ownerBySession。 */
  function mk(sid: string, agentId: string, opts: { streaming?: boolean } = {}) {
    let alive = true;
    const w: FauxWrapper = {
      inner: { isStreaming: opts.streaming ?? false },
      isAlive: () => alive,
      send: async (cmd) => {
        order.push(`${sid}:send:${cmd.type}`);
      },
      destroy: () => {
        order.push(`${sid}:destroy`);
        alive = false;
        if (destroyDeletesMap) fauxMap.delete(sid); // ← 真删唯一计数源
      },
    };
    fauxMap.set(sid, w);
    ownerBySession.set(sid, agentId);
    return w;
  }

  // 注入给 evictSession 的 getSession 与 fauxMap 是**同一个 Map 实例**（闭包捕获）。
  const getSession = (sid: string) =>
    fauxMap.get(sid) as unknown as AgentSessionWrapper | undefined;

  return { fauxMap, ownerBySession, getSession, order, mk };
}

/* ─────────────────────────────── 退化版（变异检查） ─────────────────────────────── */

/**
 * 变异体：误写成「按 agentId 逐出该 agent **全部**会话」（遍历 ownerBySession 找出同 agent 所有 sid 全 destroy）。
 * 这正是第七轮 T6 的旧粒度。用它对 sidA 阶段调用 → 必然误删同 agent 的 sidB，证「断言① sidB 仍活」有判别力。
 */
async function evictSessionMutant(
  ownerBySession: Map<string, string>,
  targetSid: string,
  deps: EvictSessionDeps,
): Promise<void> {
  const agentId = ownerBySession.get(targetSid);
  if (agentId === undefined) return;
  for (const [sid, owner] of ownerBySession) {
    if (owner !== agentId) continue;
    const w = deps.getSession(sid);
    if (!w?.isAlive()) continue;
    if (w.inner.isStreaming) await w.send({ type: "abort" });
    w.destroy();
  }
}

/* ─────────────────────────────────── 断言 ─────────────────────────────────── */

describe("evict-by-sessionId 承重 spike（第八轮 T1，hermetic）", () => {
  // 断言①：误杀根除直接证据 —— 同 agent 两会话（sidA 本阶段 worker / sidB 用户跨 run 接管），逐 sidA 不碰 sidB。
  it("断言①：evictSession('sidA') 后只剩 sidB（sidA 真删 Map，sidB 仍活）", async () => {
    const h = makeHarness();
    h.mk("sidA", "agentX");
    h.mk("sidB", "agentX");

    await evictSession("/root", "sidA", { getSession: h.getSession });

    expect(h.fauxMap.has("sidA")).toBe(false); // sidA 被 destroy → 真删 Map
    expect(h.fauxMap.has("sidB")).toBe(true); // sidB 未被触碰
    expect(h.fauxMap.size).toBe(1);
    expect(h.fauxMap.get("sidB")!.isAlive()).toBe(true); // sidB 仍 alive
    expect(h.order).toEqual(["sidA:destroy"]); // 全程只动了 sidA
  });

  // 断言②a：流式守卫 —— isStreaming 时先 send({type:'abort'}) 再 destroy（调用序为证）。
  it("断言②a：流式会话先 abort 再 destroy（顺序）", async () => {
    const h = makeHarness();
    h.mk("sidA", "agentX", { streaming: true });

    await evictSession("/root", "sidA", { getSession: h.getSession });

    expect(h.order).toEqual(["sidA:send:abort", "sidA:destroy"]); // abort 严格在 destroy 之前
    expect(h.fauxMap.has("sidA")).toBe(false);
  });

  // 断言②b：非流式不 abort、直接 destroy。
  it("断言②b：非流式会话不 abort、直接 destroy", async () => {
    const h = makeHarness();
    h.mk("sidA", "agentX", { streaming: false });

    await evictSession("/root", "sidA", { getSession: h.getSession });

    expect(h.order).toEqual(["sidA:destroy"]); // 无 send:abort
  });

  // 断言③：owner-map 红线 —— evictSession 全程不碰 ownerBySession（不动 bySession/removeOwner）。
  it("断言③：evict 后 owner-map 仍映射 sidA→agentX（绝不碰 bySession）", async () => {
    const h = makeHarness();
    h.mk("sidA", "agentX");
    h.mk("sidB", "agentX");

    await evictSession("/root", "sidA", { getSession: h.getSession });

    expect(h.ownerBySession.get("sidA")).toBe("agentX"); // owner-map 原样
    expect(h.ownerBySession.get("sidB")).toBe("agentX");
    expect(h.ownerBySession.size).toBe(2);
  });

  // 负对照：证「断言① 的 size 回落」真依赖 destroy 删 Map，不是假绿。
  it("负对照：destroy 不删 Map 时 size 不回落（证 size 回落非 vacuous）", async () => {
    const h = makeHarness(false); // ← destroy 只翻 alive、不删 fauxMap
    h.mk("sidA", "agentX");
    h.mk("sidB", "agentX");

    await evictSession("/root", "sidA", { getSession: h.getSession });

    expect(h.fauxMap.has("sidA")).toBe(true); // 条目仍在（destroy 没删）
    expect(h.fauxMap.size).toBe(2); // size 未回落
    expect(h.fauxMap.get("sidA")!.isAlive()).toBe(false); // 但确被 destroy 过（alive 翻 false）
    expect(h.order).toEqual(["sidA:destroy"]); // 实现确实调了 destroy，回落与否只取决于 destroy 删不删 Map
  });

  // 变异检查：退化成「按 agentId 逐出全部」必误删 sidB → 证断言① 的「sidB 仍活」有判别力。
  it("变异检查：按 agentId 逐出的退化版会误删 sidB（证断言① 有判别力）", async () => {
    const h = makeHarness();
    h.mk("sidA", "agentX");
    h.mk("sidB", "agentX");

    await evictSessionMutant(h.ownerBySession, "sidA", {
      getSession: h.getSession,
    });

    expect(h.fauxMap.has("sidA")).toBe(false);
    expect(h.fauxMap.has("sidB")).toBe(false); // ← 误删！正确实现绝不该出现
    expect(h.fauxMap.size).toBe(0);
  });

  // 边界：不存在的 sid → no-op、不抛。
  it("边界：getSession 返 undefined（sid 不存在）→ 安全跳过、不抛", async () => {
    const h = makeHarness();
    h.mk("sidB", "agentX"); // 只有 sidB，没有 sidA

    await expect(
      evictSession("/root", "sidA", { getSession: h.getSession }),
    ).resolves.toBeUndefined();

    expect(h.fauxMap.has("sidB")).toBe(true);
    expect(h.fauxMap.size).toBe(1);
    expect(h.order).toEqual([]); // 什么都没动
  });

  // 边界：已死会话（isAlive()=false）→ no-op、不 destroy。
  it("边界：已死会话（isAlive()=false）→ 安全跳过、不 destroy", async () => {
    const h = makeHarness();
    const w = h.mk("sidA", "agentX");
    w.isAlive = () => false; // 标记已死（如已被 idle 计时器回收）

    await evictSession("/root", "sidA", { getSession: h.getSession });

    // destroy 未被调用（order 里没有 sidA:destroy）；条目仍在 fauxMap（本测不验回收，只验不重复 destroy）
    expect(h.order).toEqual([]);
  });
});
