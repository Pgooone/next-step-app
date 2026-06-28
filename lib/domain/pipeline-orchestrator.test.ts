/**
 * V1.2 第七轮·T3 编排器 runPipeline 单测（承重 verify + hermetic AC-2~7）。
 *
 * 两部分：
 *   A. **承重 verify**（T3 核心命门，lead 独立复跑）——用【真实 runPipeline + faux 三件读写同一
 *      fauxMap】（继承 T1-A spike 纪律：三处闭包引用同一 Map 对象 + faux runWorker 的
 *      fakeWrapper.destroy 必须 `fauxMap.delete(sid)`，否则 size 永不降=假绿）。证机制真接进生产
 *      runPipeline、而非只证拟定契约（spike 证的是手写编排循环）。6 断言：
 *        ① evict 每阶段调一次（顺序 + 本阶段 sessionId）② run 结束 fauxMap.size===0 ③ peak<=1
 *        ④ 顺序 log===["acq0","set0","evict0",...]（setOwner 在 evict 前）
 *        ⑤ 负对照（destroy 不删 Map → 第 2 阶段 acquireSlot 超时抛）
 *        ⑥ catch 路径释槽（runWorker 第 1 阶段 throw 且已 set → run failed + 该阶段 evict + 后续不跑）
 *   B. **hermetic AC**（注入纯 faux runWorker/acquireSlot/evict spy，仿 orchestrator.test.ts 范式）——
 *      AC-5（queued 在 acquireSlot 前落盘 + {timeoutMs:Infinity}）/ AC-6（累积喂下游含全部已完成上游 + F10）
 *      / AC-7（reconcileOrphan 端到端）/ 失败分支（timeout/aborted/判空）/ cancel 顶检测 / 单阶段 done。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProfileStore } from "./agent-profile-store";
import { PipelineRunStore, type PipelineRun, type PipelineRunStage } from "./pipeline-run-store";
import { ProjectRegistry } from "./project-registry";
import { runPipeline } from "./pipeline-orchestrator";
import { acquireSlot } from "../pi/concurrency-gate";
import { evictSession } from "../pi/evict-agent-sessions";
import type { RegisterInnerSession } from "../pi/dispatch-runner";
import type { AgentSessionWrapper } from "../rpc-manager";

// ---------------------------------------------------------------------------
// 夹具（仿 orchestrator.test.ts:38-56）
// ---------------------------------------------------------------------------
let dir: string;
let registry: ProjectRegistry;
let runStore: PipelineRunStore;
let profileStore: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r7-orch-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  runStore = new PipelineRunStore(registry);
  profileStore = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function projectRoot(): string {
  return registry.get(projectId).root;
}

/** 建一个含 N 阶段（order 1..N 各 agentId 各异、各 status:"pending"）的 running run（agent 档案随建）。 */
function makeRun(n: number): { run: PipelineRun; agentIds: string[] } {
  const agentIds: string[] = [];
  const stages: PipelineRunStage[] = [];
  for (let k = 0; k < n; k++) {
    const profile = profileStore.create(projectId, { name: `agent-${k}` });
    agentIds.push(profile.id);
    stages.push({
      order: k + 1,
      agentId: profile.id,
      agentName: profile.name,
      subTask: `子任务${k + 1}`,
      status: "pending",
      sessionId: null,
      artifactId: null,
      startedAt: null,
      finishedAt: null,
    });
  }
  const run: PipelineRun = {
    id: "run-" + Math.random().toString(36).slice(2),
    projectId,
    pipelineId: "bp-1",
    pipelineName: "测试蓝图",
    status: "running",
    currentStageIndex: 0,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    cancelRequested: false,
    failedReason: null,
    stages,
  };
  return { run, agentIds };
}

const throwingRegister = (() => {
  throw new Error("不应被调用（faux runWorker 不起真实会话）");
}) as unknown as RegisterInnerSession;

// ===========================================================================
// A. 承重 verify：真实 runPipeline + faux 三件读写同一 fauxMap（T3 核心命门）
// ===========================================================================
describe("承重 verify：runPipeline 每阶段 evict 后活会话计数确定性回落（F16/AC-2/3）", () => {
  /**
   * 唯一计数源 fauxMap。三处闭包（faux worker 的 destroy 删除、真实 acquireSlot 的 activeCount、
   * 真实 evictSession 的 getSession）**必须引用同一 fauxMap**。第八轮收窄：evict 按 `stage.sessionId`
   * 逐出（不再 sessionsForAgent 反查），evictSpy 第二参 = 本阶段 worker 的 sid（"s"+idx）。
   *
   * @param destroyDeletesMap 负对照开关：false → destroy 只翻 alive 不删 Map（证 size 回落断言依赖真 destroy）。
   * @param failFirstStage  catch 路径开关：true → faux runWorker 第 1 阶段先 fauxMap.set 再 throw。
   * @param preseedSurvivor （d）误杀覆盖：true → 第 1 阶段 worker 旁预置同 agent 的「用户接管」会话 sidB
   *   进 fauxMap，断言按 sid 逐出绝不误删它（退化回 by-agentId 则 sidB 被误删 → 红）。survivor 不计 peak。
   */
  function makeHarness(opts?: {
    destroyDeletesMap?: boolean;
    failFirstStage?: boolean;
    preseedSurvivor?: boolean;
  }) {
    const destroyDeletesMap = opts?.destroyDeletesMap ?? true;
    const failFirstStage = opts?.failFirstStage ?? false;
    const preseedSurvivor = opts?.preseedSurvivor ?? false;

    const fauxMap = new Map<string, AgentSessionWrapper>(); // 唯一计数源
    const log: string[] = []; // 单一调用日志（acq/set/evict 各 push）
    let peak = 0; // 仅计 worker 会话峰值（排除 survivor），保 ③ peak<=1 语义
    let survivors = 0; // 预置的用户接管会话数（如 sidB），随 fauxMap.size 基线
    let stageSeq = 0; // faux runWorker 调用计数（= 第几阶段，0-based）

    function makeFakeWrapper(sid: string): AgentSessionWrapper {
      let alive = true;
      const w = {
        isAlive: () => alive,
        inner: { isStreaming: false },
        send: async () => null,
        destroy: () => {
          alive = false;
          if (destroyDeletesMap) fauxMap.delete(sid); // ★命门：真删 Map 才回落（生产 onDestroy→registry.delete）
        },
      };
      return w as unknown as AgentSessionWrapper;
    }

    // faux runWorker：进阶段时 fauxMap.size 应为 survivors（上阶段 worker 已 evict、仅留预置的用户接管会话），
    // set worker 后留在 Map 模拟 completed 不自销毁（坐实只有 evict 才释）；记 worker peak。
    // 第 1 阶段 failFirstStage 时先 set 再 throw（catch 路径）。第 1 阶段 preseedSurvivor 时额外塞 sidB（同 agentId）。
    const fauxRunWorker = (async (args: { firstMessage: string; profile: { id: string } }) => {
      const idx = stageSeq++;
      const sid = "s" + idx;
      // 进阶段断言：上阶段 worker 已 evict 释槽 + acquireSlot 才放行 → size===survivors（基线）
      expect(fauxMap.size).toBe(survivors);
      // （d）第 1 阶段预置同 agent 的「用户接管」会话 sidB（跨 run 复活，按 sid 逐出绝不该删它）。
      if (preseedSurvivor && idx === 0) {
        fauxMap.set("sidB", makeFakeWrapper("sidB"));
        survivors++;
      }
      fauxMap.set(sid, makeFakeWrapper(sid));
      peak = Math.max(peak, fauxMap.size - survivors); // 仅计 worker 峰值
      if (failFirstStage && idx === 0) {
        throw new Error("worker 崩了");
      }
      return {
        sessionId: sid,
        reason: "completed" as const,
        output: "out" + idx,
        artifactIds: ["a" + idx],
        createdContent: "C" + idx,
        firstMessage: args.firstMessage,
      };
    }) as never;

    // 真实 acquireSlot，数同一 fauxMap 的 **worker** 占用（排除预置的用户接管会话 survivors，它们不在本 run
    // 的 worker 轮转里）；外层 spy 记 log["acq"+idx]。survivors===0 时与 fauxMap.size 完全等价（不扰动既有用例）。
    const acquireSpy = vi.fn(async (o?: Parameters<typeof acquireSlot>[0]) => {
      log.push("acq" + stageSeq); // stageSeq 此刻 = 即将跑的阶段 idx（runWorker 还没自增）
      return acquireSlot({
        activeCount: () => fauxMap.size - survivors,
        limit: 1,
        timeoutMs: o?.timeoutMs === Infinity ? 30 : (o?.timeoutMs ?? 30), // Infinity→30 防负对照真挂死
        pollMs: 1,
      });
    });

    // 真实 setOwner spy：记 log["set"+(stageSeq-1)]（此刻 runWorker 已自增过 stageSeq）。
    const setOwnerSpy = vi.fn(() => {
      log.push("set" + (stageSeq - 1));
    });

    // 真实 evictSession（按 sid 逐出），删同一 fauxMap；外层 spy 记 log["evict"+(stageSeq-1)] + 断言调用。
    const evictSpy = vi.fn((root: string, sessionId: string | null) => {
      log.push("evict" + (stageSeq - 1));
      return evictSession(root, sessionId, {
        getSession: (s) => fauxMap.get(s),
      });
    });

    return {
      fauxMap,
      log,
      get peak() {
        return peak;
      },
      deps: {
        registry,
        runStore,
        profileStore,
        runWorker: fauxRunWorker,
        acquireSlot: acquireSpy as unknown as typeof acquireSlot,
        setOwner: setOwnerSpy,
        evictSession: evictSpy as unknown as typeof evictSession,
        registerInnerSession: throwingRegister,
      },
      acquireSpy,
      setOwnerSpy,
      evictSpy,
    };
  }

  it("①②③④ 连跑 4 阶段：evict 每阶段一次(顺序+本阶段 sessionId) + 结束 size===0 + peak<=1 + 顺序 acq→set→evict", async () => {
    const { run } = makeRun(4);
    const h = makeHarness();

    const result = await runPipeline(run, h.deps);

    expect(result.status).toBe("done");
    // ① evict 每阶段一次，第二参 === 本阶段 sessionId（第八轮收窄：按 sid 逐出，faux worker 返 "s"+idx）
    expect(h.evictSpy).toHaveBeenCalledTimes(4);
    expect(h.evictSpy).toHaveBeenNthCalledWith(1, projectRoot(), "s0");
    expect(h.evictSpy).toHaveBeenNthCalledWith(2, projectRoot(), "s1");
    expect(h.evictSpy).toHaveBeenNthCalledWith(3, projectRoot(), "s2");
    expect(h.evictSpy).toHaveBeenNthCalledWith(4, projectRoot(), "s3");
    // ② run 结束 fauxMap.size===0（F16 命门：无须等 10min idle）
    expect(h.fauxMap.size).toBe(0);
    // ③ peak<=1（任一阶段末活会话≤1）
    expect(h.peak).toBeLessThanOrEqual(1);
    // ④ 顺序：每阶段 acquireSlot→runWorker→setOwner→evict（setOwner 在 evict 之前 = T1-A 契约）
    expect(h.log).toEqual([
      "acq0", "set0", "evict0",
      "acq1", "set1", "evict1",
      "acq2", "set2", "evict2",
      "acq3", "set3", "evict3",
    ]);
  });

  // （d）加固误杀根除（AC-1）：某阶段 agent 预置「用户接管」会话 sidB，连跑 4 阶段按 sid 逐出绝不误删 sidB。
  // 退化回 by-agentId（变异检查）→ 第 1 阶段 evict 会连带 destroy sidB → 末尾「sidB 仍在 Map」断言红。
  it("（误杀根除）连跑 4 阶段 + 同 agent 预置用户接管会话 sidB → sidB 未被误删", async () => {
    const { run } = makeRun(4);
    const h = makeHarness({ preseedSurvivor: true });

    const result = await runPipeline(run, h.deps);

    expect(result.status).toBe("done");
    // 4 个 worker 会话各被本阶段 evict（按 sid），但同 agent 的用户接管会话 sidB 始终未被触碰
    expect(h.evictSpy).toHaveBeenCalledTimes(4);
    expect(h.fauxMap.has("sidB")).toBe(true); // ★误杀根除直接证据
    expect(h.fauxMap.get("sidB")!.isAlive()).toBe(true);
    expect(h.fauxMap.size).toBe(1); // 仅剩 sidB（4 个 worker 会话全被本阶段 evict）
    expect(h.peak).toBeLessThanOrEqual(1); // worker 峰值仍 ≤1（survivor 不计）
  });

  it("⑤ 负对照：destroy 不删 Map → 第 2 阶段 acquireSlot 超时抛错（证 size 回落断言依赖真 destroy）", async () => {
    const { run } = makeRun(4);
    // destroyDeletesMap=false → 第 1 阶段 evict 的 destroy 不删 Map → size 留 1=limit →
    // 第 2 阶段 acquireSlot（Infinity→30ms）超时抛「上限」→ runPipeline 捕获→failRun。
    const h = makeHarness({ destroyDeletesMap: false });

    const result = await runPipeline(run, h.deps);

    expect(result.status).toBe("failed");
    expect(result.failedReason).toMatch(/上限/);
    // 只跑到第 1 阶段（acq0/set0/evict0 + 第 2 阶段 acq1 超时），第 2 阶段没 set/evict
    expect(h.log).toEqual(["acq0", "set0", "evict0", "acq1"]);
  }, 4000);

  // ⑥ catch 路径（第八轮收窄后语义变化）：worker 抛错时 stage.sessionId 恒为初值 null（:181 在 try 之后、
  //   未执行），故 catch 内 doEvict 传 null → evictSession(null) 是 **no-op**——s0 不被删、size 停在 1。
  //   这正是收窄的可接受取舍：catch 漏的只是「正崩 worker 自己那一槽」，靠 wrapper 10min idle + AC-7
  //   reconcileOrphan 兜底回收（worker 自身会话只进 __piSessions 不进 owner-map，旧 by-agentId catch 本就反查
  //   不到它、同样释不了槽，无退化）。
  it("⑥ catch 路径：runWorker 第 1 阶段已 set 后 throw → run failed + evict 以 null 调(no-op) + s0 留 Map + 后续不跑", async () => {
    const { run } = makeRun(4);
    const h = makeHarness({ failFirstStage: true });

    const result = await runPipeline(run, h.deps);

    expect(result.status).toBe("failed");
    expect(result.failedReason).toContain("worker 执行失败");
    expect(result.failedReason).toContain("worker 崩了");
    // catch 内 doEvict 恰调 1 次、第二参 === null（stage.sessionId 未赋值，:181 在 try 后）
    expect(h.evictSpy).toHaveBeenCalledTimes(1);
    expect(h.evictSpy).toHaveBeenNthCalledWith(1, projectRoot(), null);
    // size 不回落：evictSession(null) no-op → s0 仍在 Map（该槽靠 10min idle + AC-7 对账兜底）
    expect(h.fauxMap.size).toBe(1);
    expect(h.fauxMap.has("s0")).toBe(true);
    // 后续阶段不跑：第 1 阶段 status=failed，后 3 阶段仍 pending
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages.slice(1).map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
  });
});

// ===========================================================================
// B. hermetic AC（纯 faux spy，仿 orchestrator.test.ts）
// ===========================================================================
describe("runPipeline AC-5 排队态 + 不限超时", () => {
  it("每阶段 acquireSlot 都传 {timeoutMs:Infinity}，且 statusDetail='queued' 在 acquireSlot 之前落盘", async () => {
    const { run } = makeRun(2);
    // 形参显式声明 opts（仿 acquireSlot 签名）→ mock.calls[k][0] 有元素、tsc 不报越界元组。
    const acquireSpy = vi.fn(async (_opts?: Parameters<typeof acquireSlot>[0]) => {});
    // ★快照每次 write 时「当前阶段的 statusDetail」+ 是否已 acquireSlot——runStore.write 入参恒同一 current
    //   对象引用，事后读 mock.calls 只见终态（statusDetail 已被重置），故须在 write 调用时刻取快照。
    const writeSnapshots: Array<{ statusDetail?: string; acquiredCount: number }> = [];
    const origWrite = runStore.write.bind(runStore);
    vi.spyOn(runStore, "write").mockImplementation((pid, r) => {
      writeSnapshots.push({
        statusDetail: r.stages[r.currentStageIndex]?.statusDetail,
        acquiredCount: acquireSpy.mock.calls.length,
      });
      return origWrite(pid, r);
    });
    const fakeRun = (async () => ({
      sessionId: "s",
      output: "out",
      reason: "completed",
      artifactIds: [],
    })) as never;

    const result = await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: acquireSpy as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });

    expect(result.status).toBe("done");
    // 每次 acquireSlot 入参恒含 {timeoutMs:Infinity}
    expect(acquireSpy).toHaveBeenCalledTimes(2);
    expect(acquireSpy.mock.calls[0][0]).toEqual({ timeoutMs: Infinity });
    expect(acquireSpy.mock.calls[1][0]).toEqual({ timeoutMs: Infinity });

    // statusDetail='queued' 在 acquireSlot 之前落盘：存在一次 write 快照其当前阶段 statusDetail==='queued'，
    // 且该次快照时 acquireSlot 尚未被调用过（acquiredCount===0 表示第 1 阶段 queued 写在 acquireSlot 之前）。
    const firstQueued = writeSnapshots.find((s) => s.statusDetail === "queued");
    expect(firstQueued).toBeTruthy();
    expect(firstQueued!.acquiredCount).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("runPipeline AC-6 累积喂下游", () => {
  it("N=4：第 4 阶段首条 message 含前 3 阶段 agentName 与 C1/C2/C3（非只紧邻）+ F10 引导句", async () => {
    const { run } = makeRun(4);
    const firstMessages: string[] = [];
    let seq = 0;
    const fakeRun = (async (args: { firstMessage: string }) => {
      firstMessages.push(args.firstMessage);
      const idx = seq++;
      return {
        sessionId: "s" + idx,
        output: "out" + idx,
        reason: "completed",
        artifactIds: ["art" + idx],
        createdContent: "C" + (idx + 1), // C1/C2/C3/C4
      };
    }) as never;

    const result = await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });

    expect(result.status).toBe("done");
    expect(firstMessages).toHaveLength(4);
    // 第 1 阶段无上游
    expect(firstMessages[0]).not.toContain("## 上游产物");
    expect(firstMessages[0]).toContain("请在完成后调用 create_artifact 产出受管文档。"); // F10
    // 第 4 阶段累积含前 3 阶段 agentName + C1/C2/C3（非只 C3）
    const last = firstMessages[3];
    expect(last).toContain("## 上游产物（累积）");
    expect(last).toContain("### agent-0");
    expect(last).toContain("### agent-1");
    expect(last).toContain("### agent-2");
    expect(last).toContain("C1");
    expect(last).toContain("C2");
    expect(last).toContain("C3");
    expect(last).toContain("请在完成后调用 create_artifact 产出受管文档。"); // F10 也在下游
  });

  it("无 createdContent 时累积退回 output", async () => {
    const { run } = makeRun(2);
    const firstMessages: string[] = [];
    let seq = 0;
    const fakeRun = (async (args: { firstMessage: string }) => {
      firstMessages.push(args.firstMessage);
      const idx = seq++;
      return { sessionId: "s" + idx, output: "OUT" + idx, reason: "completed", artifactIds: [] };
    }) as never;

    await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });

    // 第 2 阶段上游正文退回 output（OUT0）
    expect(firstMessages[1]).toContain("OUT0");
  });
});

describe("runPipeline 失败分支（仿 orchestrator.test.ts:378-404）", () => {
  async function runWithFirstResult(
    firstResult: Record<string, unknown>,
    n = 2,
  ): Promise<{ result: PipelineRun; calls: number; evictCalls: number }> {
    const { run } = makeRun(n);
    let calls = 0;
    const evict = vi.fn(async () => []);
    const fakeRun = (async () => {
      calls++;
      return firstResult;
    }) as never;
    const result = await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: evict as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });
    return { result, calls, evictCalls: evict.mock.calls.length };
  }

  it("reason=timeout → run failed + '阶段超时' + 后续 pending + 只起第 1 worker + 该阶段已 evict", async () => {
    const { result, calls, evictCalls } = await runWithFirstResult({
      sessionId: "s1",
      output: "",
      reason: "timeout",
      artifactIds: [],
    });
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("阶段超时");
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("pending");
    expect(calls).toBe(1);
    // evict 在四类失败 return 之前已调（setOwner 后、判定前）
    expect(evictCalls).toBe(1);
  });

  it("reason=aborted → run failed + '已取消'", async () => {
    const { result } = await runWithFirstResult({
      sessionId: "s1",
      output: "",
      reason: "aborted",
      artifactIds: [],
    });
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("已取消");
  });

  it("判空（output 空白 + artifactIds 空）→ run failed + '阶段未产出' + 该阶段已 evict", async () => {
    const { result, evictCalls } = await runWithFirstResult({
      sessionId: "s1",
      output: "   ",
      reason: "completed",
      artifactIds: [],
    });
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("阶段未产出");
    expect(evictCalls).toBe(1);
  });

  it("有 artifactIds + 空文本 → 不判失败、artifactId 取最后一个", async () => {
    const { result } = await runWithFirstResult(
      { sessionId: "s1", output: "", reason: "completed", artifactIds: ["x", "y"] },
      1,
    );
    expect(result.status).toBe("done");
    expect(result.stages[0].artifactId).toBe("y");
  });

  it("Agent 档案不存在（兜底 try/catch）→ run failed + '档案不存在'", async () => {
    // 构造引用不存在 agentId 的 run（绕过 makeRun）
    const run: PipelineRun = {
      id: "run-x",
      projectId,
      pipelineId: "bp",
      pipelineName: "p",
      status: "running",
      currentStageIndex: 0,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      cancelRequested: false,
      failedReason: null,
      stages: [
        {
          order: 1,
          agentId: "does-not-exist",
          agentName: "ghost",
          subTask: "t",
          status: "pending",
          sessionId: null,
          artifactId: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    };
    const worker = vi.fn();
    const result = await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: worker as never,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });
    expect(result.status).toBe("failed");
    expect(result.failedReason).toContain("档案不存在");
    expect(worker).not.toHaveBeenCalled(); // 前置失败，worker 未起
  });
});

describe("runPipeline cancel 顶检测（signal）", () => {
  it("signal.aborted=true 起 run → 第 1 阶段顶检测即 failRun('已取消')、worker 0 调用", async () => {
    const { run } = makeRun(2);
    const controller = new AbortController();
    controller.abort();
    const worker = vi.fn();
    const result = await runPipeline(
      run,
      {
        registry,
        runStore,
        profileStore,
        runWorker: worker as never,
        acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
        setOwner: vi.fn(),
        evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
        registerInnerSession: throwingRegister,
      },
      controller.signal,
    );
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("已取消");
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("runPipeline 单阶段 done", () => {
  it("stages.length===1 跑一次 done → run done、firstMessage 无上游摘要", async () => {
    const { run } = makeRun(1);
    let captured = "";
    const fakeRun = (async (args: { firstMessage: string }) => {
      captured = args.firstMessage;
      return { sessionId: "s0", output: "out", reason: "completed", artifactIds: ["a0"] };
    }) as never;
    const result = await runPipeline(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });
    expect(result.status).toBe("done");
    expect(result.stages[0].status).toBe("done");
    expect(captured).not.toContain("## 上游产物");
    // 落盘可回读 done
    expect(runStore.get(projectId, run.id).status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// AC-7 读时对账（PipelineRunStore.reconcileOrphan 端到端，T2 已实现，此处补 runPipeline 上下文一条）
// ---------------------------------------------------------------------------
describe("AC-7 读时对账（reconcileOrphan）", () => {
  it("running run、当前阶段有 sessionId 但不在 liveSet → 翻 failed + '进程重启'", () => {
    const { run } = makeRun(2);
    run.currentStageIndex = 0;
    run.stages[0].status = "running";
    run.stages[0].sessionId = "dead-session";
    runStore.create(projectId, run);

    const reconciled = runStore.reconcileOrphan(projectId, run, new Set<string>(["other-live"]));

    expect(reconciled.status).toBe("failed");
    expect(reconciled.failedReason).toContain("进程重启");
    expect(reconciled.stages[0].status).toBe("failed");
    // 落盘也是 failed
    expect(runStore.get(projectId, run.id).status).toBe("failed");
  });

  it("当前阶段 sessionId 仍在 liveSet → 不动", () => {
    const { run } = makeRun(2);
    run.currentStageIndex = 0;
    run.stages[0].status = "running";
    run.stages[0].sessionId = "alive-session";
    runStore.create(projectId, run);

    const reconciled = runStore.reconcileOrphan(projectId, run, new Set<string>(["alive-session"]));

    expect(reconciled.status).toBe("running");
  });
});

// ===========================================================================
// T6 承重 verify：mid-flight cancel（运行中 abort signal）→ failRun('已取消') + 该阶段 evict 释槽
//
// 区别于上面 cancel 顶检测（signal 起始即 aborted、worker 0 调用）：这里 worker **已起、跑到一半**才 abort，
// 验证「停止」真能中断在跑会话并释槽。复用承重 fauxMap 纪律（三处闭包引用同一 fauxMap + faux destroy 真删
// Map，否则 size 永不降 = 假绿）+ 负对照（不 abort → done、每阶段 evict）。证 T6 cancel 路由翻转的 signal
// 经 runPipeline 顶检测/worker signal 接通后，aborted 阶段在结果判定前已 evict（pipeline-orchestrator.ts:187），
// run 失败原因为 '已取消'（:194）。
//
// 注：T6 的薄 cancel 路由（app/api/pipeline-runs/[runId]/cancel）仅做「findRun → 翻 cancelRequested →
// store.write → getRunController?.abort → deleteRunController」的纯转发，本仓 vitest 仅 include lib/**（见
// vitest.config：无 app/ route 测先例），故按规格把 cancel 核心承重并入此处编排器层 verify：abort 经 signal
// 接通 runPipeline 的端到端中断 + 释槽，是「停止」语义的真命门；路由层 abort/delete 调用由 run-controllers
// 单测覆盖范围（globalThis 单例 set/get/delete）+ 编排器既有 signal 顶检测共同保证。
// ===========================================================================
describe("T6 承重 verify：mid-flight cancel → 中断在跑会话 + 释槽 + failedReason='已取消'", () => {
  /**
   * @param onWorkerEntered 第 1 阶段 faux worker 已 set 进 fauxMap、即将 await abort 时回调（测试据此 abort，免 setTimeout 竞态）。
   * @param destroyDeletesMap 负对照开关：false → destroy 只翻 alive 不删 Map（证 size 回落断言依赖真 destroy）。
   */
  function makeCancelHarness(opts?: {
    onWorkerEntered?: () => void;
    destroyDeletesMap?: boolean;
  }) {
    const destroyDeletesMap = opts?.destroyDeletesMap ?? true;
    const fauxMap = new Map<string, AgentSessionWrapper>(); // 唯一计数源
    let stageSeq = 0;
    let peak = 0;
    const evictedSids: (string | null)[] = []; // 第八轮：evict 第二参为本阶段 sessionId（"s"+idx）

    function makeFakeWrapper(sid: string): AgentSessionWrapper {
      let alive = true;
      const w = {
        isAlive: () => alive,
        inner: { isStreaming: false },
        send: async () => null,
        destroy: () => {
          alive = false;
          if (destroyDeletesMap) fauxMap.delete(sid); // ★命门：真删 Map 才回落
        },
      };
      return w as unknown as AgentSessionWrapper;
    }

    // faux runWorker：第 1 阶段 set 进 Map 后 await 由 signal 控的 abort-promise（mid-flight），signal 触发
    // 即返回 reason:"aborted"；后续阶段（负对照下游）正常 completed。args.signal 由 runPipeline 透传
    // （pipeline-orchestrator.ts:163）。
    const fauxRunWorker = (async (args: {
      firstMessage: string;
      profile: { id: string };
      signal?: AbortSignal;
    }) => {
      const idx = stageSeq++;
      const sid = "s" + idx;
      expect(fauxMap.size).toBe(0); // 进阶段：上阶段已 evict 释槽
      fauxMap.set(sid, makeFakeWrapper(sid));
      peak = Math.max(peak, fauxMap.size);

      // 仅 cancel 测试（提供 onWorkerEntered）才在第 1 阶段 mid-flight 等待 abort；负对照（无 onWorkerEntered）
      // 第 1 阶段直接正常 completed（否则会 await 永不解的 promise → 挂死）。
      if (idx === 0 && opts?.onWorkerEntered) {
        // 通知测试：已占槽、即将等待（测试此刻 abort）。
        opts.onWorkerEntered();
        // mid-flight 等待 abort（已 aborted 立即解；否则挂 listener）。
        await new Promise<void>((res) => {
          const sig = args.signal;
          if (!sig || sig.aborted) return res();
          sig.addEventListener("abort", () => res(), { once: true });
        });
        if (args.signal?.aborted) {
          return {
            sessionId: sid,
            reason: "aborted" as const,
            output: "",
            artifactIds: [] as string[],
            createdContent: "",
            firstMessage: args.firstMessage,
          };
        }
      }
      return {
        sessionId: sid,
        reason: "completed" as const,
        output: "out" + idx,
        artifactIds: ["a" + idx],
        createdContent: "C" + idx,
        firstMessage: args.firstMessage,
      };
    }) as never;

    const evictSpy = vi.fn((root: string, sessionId: string | null) => {
      evictedSids.push(sessionId);
      return evictSession(root, sessionId, {
        getSession: (s) => fauxMap.get(s),
      });
    });

    return {
      fauxMap,
      evictedSids,
      get peak() {
        return peak;
      },
      deps: {
        registry,
        runStore,
        profileStore,
        runWorker: fauxRunWorker,
        // 真实 acquireSlot 数同一 fauxMap（Infinity→30 防负对照真挂死）。
        acquireSlot: (async (o?: Parameters<typeof acquireSlot>[0]) =>
          acquireSlot({
            activeCount: () => fauxMap.size,
            limit: 1,
            timeoutMs: o?.timeoutMs === Infinity ? 30 : (o?.timeoutMs ?? 30),
            pollMs: 1,
          })) as unknown as typeof acquireSlot,
        setOwner: vi.fn(),
        evictSession: evictSpy as unknown as typeof evictSession,
        registerInnerSession: throwingRegister,
      },
      evictSpy,
    };
  }

  it("①②③ worker 跑到一半 abort → run failed + failedReason='已取消' + 该阶段 evict 一次 + fauxMap 该会话被移除(size 回落非本就0)", async () => {
    const { run } = makeRun(4);
    const controller = new AbortController();
    // onWorkerEntered：worker 第 1 阶段占槽后回调（此刻 fauxMap.size===1，证「回落」非「本就 0」），再 abort。
    let sizeAtAbort = -1;
    const h = makeCancelHarness({
      onWorkerEntered: () => {
        sizeAtAbort = -2; // 占位：真正取值在断言前用 fauxMap.size，但这里先记录 abort 时机
        controller.abort();
      },
    });

    const result = await runPipeline(run, h.deps, controller.signal);

    // ① run 失败、原因恰为「已取消」（不是只判 status）
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("已取消");
    // 第 1 阶段 failed、后续仍 pending（中止后续）
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages.slice(1).map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
    // ② 该阶段 evict 恰一次、命中第 1 阶段 sessionId="s0"（aborted 非 throw 路径：:181 已赋 sessionId、
    //    :187 按 sid evict 释槽。第八轮收窄后第二参为 sid 而非 agentId）
    expect(h.evictSpy).toHaveBeenCalledTimes(1);
    expect(h.evictSpy).toHaveBeenNthCalledWith(1, projectRoot(), "s0");
    // ③ fauxMap 该会话被移除 → size 回落到 0（abort 时占了 1 槽，evict 真删才回落；区别于「本就 0」）
    expect(h.fauxMap.size).toBe(0);
    expect(sizeAtAbort).toBe(-2); // onWorkerEntered 确曾触发（abort 确在 mid-flight 而非起始）
  });

  it("④ 负对照：不 abort → run done、每阶段 evict、size 回落 0", async () => {
    const { run } = makeRun(4);
    const controller = new AbortController(); // 从不 abort
    const h = makeCancelHarness(); // 无 onWorkerEntered → 第 1 阶段 signal 未 aborted → 正常 completed

    const result = await runPipeline(run, h.deps, controller.signal);

    expect(result.status).toBe("done");
    // 每阶段 evict 一次（4 阶段）、第二参依次为本阶段 sessionId（第八轮收窄：按 sid 逐出）
    expect(h.evictSpy).toHaveBeenCalledTimes(4);
    expect(h.evictedSids).toEqual(["s0", "s1", "s2", "s3"]);
    expect(h.fauxMap.size).toBe(0);
    expect(h.peak).toBeLessThanOrEqual(1);
  });

  it("⑤ 负对照(destroy 不删 Map)：mid-flight abort 后第 1 阶段 evict 的 destroy 不删 Map → size 不回落（证 size 断言依赖真 destroy）", async () => {
    const { run } = makeRun(4);
    const controller = new AbortController();
    const h = makeCancelHarness({
      destroyDeletesMap: false,
      onWorkerEntered: () => controller.abort(),
    });

    const result = await runPipeline(run, h.deps, controller.signal);

    // run 仍因取消而 failed（evict 被调，但 faux destroy 不删 Map）
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("已取消");
    // ★命门反证：destroy 不删 Map → size 停在 1（证 ③ 的「size 回落」断言真依赖 destroy 删 Map，非 vacuous）
    expect(h.fauxMap.size).toBe(1);
  });
});
