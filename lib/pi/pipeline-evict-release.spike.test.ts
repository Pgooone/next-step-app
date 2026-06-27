/**
 * T1-A 承重 spike（V1.2 第七轮「流水线与阶段看板」承重墙卡）。
 *
 * 【核心命门】runPipeline 每阶段跑完调 evictAgentSessions 后，活会话计数确定性回落——
 * ≥4 阶段连跑、任一阶段结束时活 worker ≤1，无须等 10min idle（F16 / D-V1.2-41）。
 *
 * runPipeline 尚未实现，故本 spike 写「拟定契约的 faux 编排循环」：
 *   for each stage { fauxMap.set(worker) → acquireSlot 放行 → 阶段末 evictAgentSessions }
 * 两端都用**真实** acquireSlot 与**真实** evictAgentSessions（只把数据源 Map/会话集换 faux），
 * 绝不 stub 任一端。
 *
 * 【为何不复用 evict-agent-sessions.test.ts 的 fakeWrapper】生产里 acquireSlot 数的是
 * `Map.size`（concurrency-gate.ts:20），不是 isAlive()；真 destroy 也不删 registry（删只来自
 * onDestroy→registry.delete, rpc-manager.ts:290）。故本 spike 的 faux.destroy() **必须真删
 * fauxMap 自身**（见 makeFauxWorker），否则 size 永不降 = 假绿（N3 注释钉死此点）。
 *
 * 全 hermetic：私有 `fauxMap`（非 globalThis.__piSessions）、不触网、不用真实模型凭证。
 *
 * 真实函数 file:line：
 *   evictAgentSessions: evict-agent-sessions.ts:33-50（DI 缝 :22-25，流式先 abort :45，destroy :46）。
 *   acquireSlot: concurrency-gate.ts:32-50（全可注入 :38-41；timeoutMs=Infinity → deadline=Infinity、
 *     while 不进、立即返回）。
 */
import { describe, expect, it } from "vitest";
import { evictAgentSessions } from "./evict-agent-sessions";
import { acquireSlot } from "./concurrency-gate";
import type { AgentSessionWrapper } from "../rpc-manager";

describe("T1-A：runPipeline 每阶段 evict 后活会话计数确定性回落（F16/D-V1.2-41 命门）", () => {
  /**
   * 唯一计数源 fauxMap + 按 agentId 真反查的 sessionsForAgent。
   * 三处闭包（faux worker 的 destroy 删除、acquireSlot 的 activeCount、evict 的 getSession）
   * **必须引用同一个 fauxMap 变量**——绝不各 new 或传 size 快照数字（否则假 GO）。
   */
  function makeHarness() {
    const fauxMap = new Map<string, AgentSessionWrapper>(); // 唯一计数源
    const ownerByAgent: Record<string, string[]> = {}; // agentId -> [sid]，faux sessionsForAgent 真反查

    function makeFauxWorker(sid: string, opts?: { streaming?: boolean }) {
      let alive = true;
      const calls = { aborted: 0 };
      const w = {
        isAlive: () => alive,
        inner: { isStreaming: opts?.streaming ?? false }, // 显式 false，不靠 undefined 偶合
        send: async (c: { type: string }) => {
          if (c.type === "abort") calls.aborted++;
          return null;
        },
        destroy: () => {
          alive = false;
          fauxMap.delete(sid); // ★必须 delete 自身——size 才会真回落（生产 onDestroy→registry.delete）
        },
      };
      return { w: w as unknown as AgentSessionWrapper, calls };
    }

    // evict 的 DI 缝：sessionsForAgent 按 agentId 真反查 ownerByAgent、getSession 读同一 fauxMap。
    const evictDeps = {
      sessionsForAgent: (_cwd: string, agentId: string) => ownerByAgent[agentId] ?? [],
      getSession: (s: string) => fauxMap.get(s),
    };

    return { fauxMap, ownerByAgent, makeFauxWorker, evictDeps };
  }

  it("A1/A2/A3：连跑 4 阶段，每阶段 acquireSlot 放行→set→evict 回落，任一时刻 size<=1、evict 精确命中本阶段 sid", async () => {
    const { fauxMap, ownerByAgent, makeFauxWorker, evictDeps } = makeHarness();

    // 忠实编排顺序（runPipeline 拟定契约）：每阶段 acquireSlot（前置阶段已 evict、size=0、放行）→
    // set worker（size=1）→ 阶段末 evictAgentSessions（size 回落 0）。两端都用真实函数。
    for (let i = 0; i < 4; i++) {
      const sid = "s" + i;
      const agentId = "agent-" + i;
      const fw = makeFauxWorker(sid);

      // 起 worker 前：真实 acquireSlot（数同一 fauxMap）。前置阶段已 evict → size=0<limit=1。
      // timeoutMs=Infinity → deadline=Infinity → while(size>=limit) 不进、立即返回（concurrency-gate.ts:43-49）。
      await acquireSlot({
        activeCount: () => fauxMap.size,
        limit: 1,
        timeoutMs: Infinity,
        pollMs: 1,
      });
      // 放行时 size 必为 0（acquireSlot 仅在 <limit 才 resolve）
      expect(fauxMap.size).toBe(0);

      // 放 worker 进唯一计数源
      fauxMap.set(sid, fw.w);
      ownerByAgent[agentId] = [sid];

      // A1：进 worker 后 size==1
      expect(fauxMap.size).toBe(1);
      // A2 不变式（worker 在场时刻）：任一时刻 size<=1
      expect(fauxMap.size).toBeLessThanOrEqual(1);

      // A3：evict 精确命中——只销本阶段 sid，返回值恰 === [该阶段 sid]
      const evicted = await evictAgentSessions("/root", agentId, evictDeps);
      expect(evicted).toEqual([sid]);

      // 阶段末：size 回落到 0（F16 命门：无须等 10min idle）
      expect(fauxMap.size).toBe(0);
      // A2 不变式（阶段末时刻）：size<=1
      expect(fauxMap.size).toBeLessThanOrEqual(1);
    }
  });

  it("A4：流式分支显式覆盖——evict 时先 abort 再 destroy，destroy 后 size 回落", async () => {
    const { fauxMap, ownerByAgent, makeFauxWorker, evictDeps } = makeHarness();
    const sid = "s-stream";
    const fw = makeFauxWorker(sid, { streaming: true });
    fauxMap.set(sid, fw.w);
    ownerByAgent["agent-stream"] = [sid];
    expect(fauxMap.size).toBe(1);

    const evicted = await evictAgentSessions("/root", "agent-stream", evictDeps);
    expect(evicted).toEqual([sid]);
    // 流式：先 abort（evict-agent-sessions.ts:45）再 destroy（:46）
    expect(fw.calls.aborted).toBe(1);
    // destroy 后 size 回落
    expect(fauxMap.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 负对照（对称取值相反）：证「断言测的是真实耦合，不是常量」。
  // ---------------------------------------------------------------------------

  it("N1：跑完第 1 阶段后故意不调 evict（size=1=limit）→ acquireSlot 超时抛错", async () => {
    const { fauxMap, makeFauxWorker } = makeHarness();
    // 放 worker、**不** evict（留 size=1=limit）
    fauxMap.set("s0", makeFauxWorker("s0").w);
    expect(fauxMap.size).toBe(1);

    // 负向支：timeoutMs 用小正值（30ms），绝不用 0 或 Infinity。
    await expect(
      acquireSlot({ activeCount: () => fauxMap.size, limit: 1, timeoutMs: 30, pollMs: 5 }),
    ).rejects.toThrow(/上限/);
  }, 2000);

  it("N2 sanity：acquireSlot 喂另一个空 Map → 即便 fauxMap 满也立即放行（证断言依赖同对象）", async () => {
    const { fauxMap, makeFauxWorker } = makeHarness();
    // fauxMap 满（size=1=limit），但 acquireSlot 数的是**另一个**空 Map
    fauxMap.set("s0", makeFauxWorker("s0").w);
    expect(fauxMap.size).toBe(1);

    // 喂空 Map：size=0<limit=1 → 立即放行；若 N1 的断言不是依赖同对象，N1 也会假性放行而非超时。
    await acquireSlot({
      activeCount: () => new Map().size,
      limit: 1,
      timeoutMs: 30,
      pollMs: 5,
    });
    // fauxMap 仍满，证明放行与 fauxMap 无关（即喂的不是同一对象）
    expect(fauxMap.size).toBe(1);
  }, 2000);

  // N3（说明性，非可执行断言）：
  // 若把 makeFauxWorker 的 destroy 改成只翻 alive 不删 fauxMap（即直接复用
  // evict-agent-sessions.test.ts:16-19 的 fakeWrapper），则 A1/A3/A4 的「size 回落到 0」断言会失败——
  // 因为生产 acquireSlot 数的是 Map.size 而非 isAlive()，真 destroy 也不删 registry（删只来自
  // onDestroy→registry.delete, rpc-manager.ts:290）。这正是本 spike 不复用现成 fakeWrapper、
  // 而要求 destroy 真删 Map 的理由。
});
