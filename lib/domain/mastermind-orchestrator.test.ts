/**
 * 第 8.6 轮 · T4 编排器 runMastermind 单测（承重 verify + hermetic AC，仿 pipeline-orchestrator.test.ts）。
 *
 * A. **承重 verify**（spike-2 核心命门，lead 独立复跑）——真实 runMastermind + faux 三闭包共用同一
 *    fauxMap（继承 T3-A 纪律：三处引用同一 Map + faux worker 的 destroy 必须 fauxMap.delete，否则 size
 *    永不降=假绿）：
 *      AC-2.1（两 attempt 都 timeout → run paused + paused 落盘那刻 fauxMap.size 回落基线，用 onWorkerEntered
 *              记 sizeAtPause 证「回落非本就 0」+ evictSpy 以本阶段 sid 命中）
 *      AC-2.2（负对照 destroyDeletesMap:false → size 不回落，仍绿则判 vacuous FAIL）
 *      AC-2.3（retry 恰 1 次：runWorker 恰 2 次、第 3 次红）
 * B. **hermetic AC**（纯 faux runWorker/evict spy）——
 *      AC-2.4（resume 不重跑 done：stage0=done+artifactId / stage1=paused → resume(retry) → runWorker.calls
 *              只含 stage1 + stage1 firstMessage 含 stage0 产物）
 *      AC-4.1（skip → partial）/ AC-4.4（临时造：跑后 AgentProfileStore 新增 teammates.length 档案、
 *              stage.agentId 非空、名含 uuid）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProfileStore } from "./agent-profile-store";
import { ArtifactService } from "./artifact-service";
import {
  MastermindRunStore,
  type MastermindRun,
  type MastermindStage,
  type MastermindTeammate,
} from "./mastermind-run-store";
import { ProjectRegistry } from "./project-registry";
import { runMastermind } from "./mastermind-orchestrator";
import { acquireSlot } from "../pi/concurrency-gate";
import { evictSession } from "../pi/evict-agent-sessions";
import type { RegisterInnerSession } from "../pi/dispatch-runner";
import type { AgentSessionWrapper } from "../rpc-manager";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
let dir: string;
let registry: ProjectRegistry;
let runStore: MastermindRunStore;
let profileStore: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r86-mmorch-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  runStore = new MastermindRunStore(registry);
  profileStore = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const throwingRegister = (() => {
  throw new Error("不应被调用（faux runWorker 不起真实会话）");
}) as unknown as RegisterInnerSession;

/**
 * 建一个 N 队员的 running run，stages 由路由从 plan 建好（agentId 占位空串、待编排器临时造），
 * 各 status:"pending" / retryCount:0。teammates mode 默认 doc。
 */
function makeRun(n: number): MastermindRun {
  const teammates: MastermindTeammate[] = [];
  const stages: MastermindStage[] = [];
  for (let k = 0; k < n; k++) {
    teammates.push({
      name: `队员${k + 1}`,
      role: `role${k + 1}`,
      subTask: `子任务${k + 1}`,
      acceptanceCriteria: `AC${k + 1}`,
    });
    stages.push({
      order: k + 1,
      agentId: "", // 占位：编排器首次进阶段临时造
      agentName: "",
      subTask: `子任务${k + 1}`,
      status: "pending",
      sessionId: null,
      artifactId: null,
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
    });
  }
  return {
    id: "mrun-" + Math.random().toString(36).slice(2),
    projectId,
    status: "running",
    plan: { teammates, notes: "" },
    stages,
    currentStageIndex: 0,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    cancelRequested: false,
    failedReason: null,
  };
}

// ===========================================================================
// A. 承重 verify（真实 runMastermind + faux 三件读写同一 fauxMap）
// ===========================================================================
describe("承重 verify：runMastermind 每 attempt evict 释槽 + 失败暂停时 fauxMap.size 回落基线（spike-2）", () => {
  /**
   * @param workerReason 每次 runWorker 返回的 reason（"completed" | "timeout" | ...）。
   * @param destroyDeletesMap 负对照开关：false → destroy 只翻 alive 不删 Map（证 size 回落断言依赖真 destroy）。
   * @param onWorkerEntered worker 已 set 进 fauxMap 后回调（测试据此记录 sizeAtEnter，证「回落非本就 0」）。
   */
  function makeHarness(opts?: {
    workerReason?: "completed" | "timeout";
    destroyDeletesMap?: boolean;
    onWorkerEntered?: (sizeInMap: number) => void;
  }) {
    const workerReason = opts?.workerReason ?? "completed";
    const destroyDeletesMap = opts?.destroyDeletesMap ?? true;

    const fauxMap = new Map<string, AgentSessionWrapper>(); // 唯一计数源
    let stageSeq = 0; // faux runWorker 调用计数
    let peak = 0;
    const evictedSids: (string | null)[] = [];

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

    // faux runWorker：进阶段时 fauxMap.size 应为 0（上次 worker 已 evict 释槽）；set worker 后留在 Map
    // 模拟 completed 不自销毁；每次返回 opts.workerReason。sid 用调用序号"s"+idx（每 attempt 唯一）。
    const fauxRunWorker = (async (args: { firstMessage: string; profile: { id: string } }) => {
      const idx = stageSeq++;
      const sid = "s" + idx;
      expect(fauxMap.size).toBe(0); // 进阶段：上次 worker 已 evict
      fauxMap.set(sid, makeFakeWrapper(sid));
      peak = Math.max(peak, fauxMap.size);
      opts?.onWorkerEntered?.(fauxMap.size);
      return {
        sessionId: sid,
        reason: workerReason,
        output: workerReason === "completed" ? "out" + idx : "",
        artifactIds: workerReason === "completed" ? ["a" + idx] : ([] as string[]),
        createdContent: "C" + idx,
        firstMessage: args.firstMessage,
      };
    }) as never;

    // 真实 acquireSlot 数同一 fauxMap（Infinity→30 防负对照真挂死）。
    const acquireSpy = vi.fn(async (o?: Parameters<typeof acquireSlot>[0]) =>
      acquireSlot({
        activeCount: () => fauxMap.size,
        limit: 1,
        timeoutMs: o?.timeoutMs === Infinity ? 30 : (o?.timeoutMs ?? 30),
        pollMs: 1,
      }),
    );

    // 真实 evictSession（按 sid 逐出），删同一 fauxMap；记 evictedSids。
    const evictSpy = vi.fn((root: string, sessionId: string | null) => {
      evictedSids.push(sessionId);
      return evictSession(root, sessionId, { getSession: (s) => fauxMap.get(s) });
    });

    return {
      fauxMap,
      evictedSids,
      get peak() {
        return peak;
      },
      get workerCalls() {
        return stageSeq;
      },
      deps: {
        registry,
        runStore,
        profileStore,
        runWorker: fauxRunWorker,
        acquireSlot: acquireSpy as unknown as typeof acquireSlot,
        setOwner: vi.fn(),
        evictSession: evictSpy as unknown as typeof evictSession,
        registerInnerSession: throwingRegister,
      },
      acquireSpy,
      evictSpy,
    };
  }

  it("AC-2.1 某阶段两 attempt 都 timeout → run paused + paused 落盘那刻 fauxMap.size 回落 0（非本就 0）+ 两 evict 命中本阶段 sid", async () => {
    const run = makeRun(2);
    let sizeAtEnter = -1;
    const h = makeHarness({
      workerReason: "timeout",
      onWorkerEntered: (sizeInMap) => {
        sizeAtEnter = sizeInMap; // worker 占槽时 size===1，证「回落」非「本就 0」
      },
    });

    const result = await runMastermind(run, h.deps);

    // run 暂停（非终态 failed）、原因为「阶段超时」、失败队员为第 1 阶段
    expect(result.status).toBe("paused");
    expect(result.failedReason).toBe("阶段超时");
    expect(result.failedTeammate?.order).toBe(1);
    expect(result.failureOptions).toEqual(["retry", "reassign", "skip", "abort"]);
    // 第 1 阶段 failed、第 2 阶段仍 pending（中止后续）
    expect(result.stages[0].status).toBe("failed");
    expect(result.stages[1].status).toBe("pending");
    // 两 attempt 各起一次 worker（AC-2.3 也覆盖），evict 各 attempt 一次、命中本阶段两个 sid
    expect(h.workerCalls).toBe(2);
    expect(h.evictSpy).toHaveBeenCalledTimes(2);
    expect(h.evictedSids).toEqual(["s0", "s1"]);
    // ★paused 落盘那刻 fauxMap.size 回落 0（第 2 attempt worker 也 evict 了）；worker 占槽时确曾 size===1
    expect(h.fauxMap.size).toBe(0);
    expect(sizeAtEnter).toBe(1);
    expect(h.peak).toBeLessThanOrEqual(1);
  }, 4000);

  it("AC-2.2 负对照：destroy 不删 Map → 第 2 attempt acquireSlot 超时（证 size 回落断言依赖真 destroy，非 vacuous）", async () => {
    const run = makeRun(2);
    // destroyDeletesMap=false → attempt0 evict 的 destroy 不删 Map → size 留 1=limit →
    // attempt1 acquireSlot（Infinity→30ms）超时抛「上限」→ runMastermind 捕获→failRun（终态 failed）。
    const h = makeHarness({ workerReason: "timeout", destroyDeletesMap: false });

    const result = await runMastermind(run, h.deps);

    // acquireSlot 超时走 failRun（终态 failed，非 paused）——证 negative control 生效路径
    expect(result.status).toBe("failed");
    expect(result.failedReason).toMatch(/上限/);
    // 只跑到 attempt0 的 worker（attempt1 卡在 acquireSlot），size 停在 1（destroy 没删）
    expect(h.workerCalls).toBe(1);
    expect(h.fauxMap.size).toBe(1);
  }, 4000);

  it("AC-2.3 retry 恰 1 次：单阶段两 attempt 都 timeout → runWorker 恰 2 次（无第 3 次）", async () => {
    const run = makeRun(1);
    const h = makeHarness({ workerReason: "timeout" });

    const result = await runMastermind(run, h.deps);

    expect(result.status).toBe("paused");
    // retry 恰 1 次：attempt0 + attempt1 = 2 次 runWorker，绝无第 3 次
    expect(h.workerCalls).toBe(2);
    expect(h.evictSpy).toHaveBeenCalledTimes(2);
    // 该阶段 retryCount 已到 1（用尽）
    expect(result.stages[0].retryCount).toBe(1);
  }, 4000);
});

// ===========================================================================
// B. hermetic AC（纯 faux spy）
// ===========================================================================
describe("runMastermind AC-2.4 resume 不重跑 done", () => {
  it("stage0=done+artifactId / stage1=paused → resume(retry) → runWorker 只含 stage1 + firstMessage 含 stage0 产物", async () => {
    // 先造一个真实受管文档作 stage0 产物（resume 时编排器从 artifactId 回读拼进下游）。
    const art = new ArtifactService(registry).createArtifact(projectId, {
      kind: "design",
      title: "阶段0产物",
      content: "STAGE0_CONTENT_MARK",
      author: "role1",
    });
    // stage0 的临时 agent 也须真实存在（否则 done 阶段虽跳过、但不影响；这里 done 阶段不解析 profile）。
    const a0 = profileStore.create(projectId, { name: "role1-done", role: "role1" });
    const a1 = profileStore.create(projectId, { name: "role2-paused", role: "role2" });

    const run: MastermindRun = {
      id: "mrun-resume",
      projectId,
      status: "paused", // resume 前是 paused
      plan: {
        teammates: [
          { name: "队员1", role: "role1", subTask: "子任务1", acceptanceCriteria: "AC1" },
          { name: "队员2", role: "role2", subTask: "子任务2", acceptanceCriteria: "AC2" },
        ],
        notes: "",
      },
      stages: [
        {
          order: 1,
          agentId: a0.id,
          agentName: a0.name,
          subTask: "子任务1",
          status: "done", // 已完成 → resume 不重跑
          sessionId: "s-old-0",
          artifactId: art.id,
          startedAt: null,
          finishedAt: new Date().toISOString(),
          retryCount: 0,
        },
        {
          order: 2,
          agentId: a1.id,
          agentName: a1.name,
          subTask: "子任务2",
          status: "pending", // resume(retry) 已把 failed 阶段重置 pending（模拟 resume 路由所为）
          sessionId: null,
          artifactId: null,
          startedAt: null,
          finishedAt: null,
          retryCount: 0,
        },
      ],
      currentStageIndex: 1,
      failedTeammate: { order: 2, agentId: a1.id, reason: "阶段超时" },
      failureOptions: ["retry", "reassign", "skip", "abort"],
      createdAt: new Date().toISOString(),
      finishedAt: null,
      cancelRequested: false,
      failedReason: "阶段超时",
    };

    const workerFirstMessages: string[] = [];
    const workerProfileIds: string[] = [];
    const fakeRun = (async (args: { firstMessage: string; profile: { id: string } }) => {
      workerFirstMessages.push(args.firstMessage);
      workerProfileIds.push(args.profile.id);
      return { sessionId: "s-new-1", output: "out1", reason: "completed", artifactIds: ["a1new"] };
    }) as never;

    const result = await runMastermind(run, {
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
    // ★只跑 stage1（stage0 done 被 continue 跳过）
    expect(workerFirstMessages).toHaveLength(1);
    expect(workerProfileIds).toEqual([a1.id]);
    // stage1 firstMessage 含 stage0 的 agentName + 从 artifactId 回读的产物正文
    expect(workerFirstMessages[0]).toContain("## 上游产物（累积）");
    expect(workerFirstMessages[0]).toContain("### " + a0.name);
    expect(workerFirstMessages[0]).toContain("STAGE0_CONTENT_MARK");
    // stage0 保持 done、未被改动
    expect(result.stages[0].status).toBe("done");
    expect(result.stages[1].status).toBe("done");
  });
});

describe("runMastermind AC-4.1 skip → partial", () => {
  it("含 skipped 阶段跑完 → run.status='partial'", async () => {
    const run = makeRun(2);
    // 模拟用户在 paused 时选 skip 第 1 阶段（resume 路由所为）。
    run.stages[0].status = "skipped";
    run.stages[0].agentId = profileStore.create(projectId, { name: "role1-x", role: "role1" }).id;

    const fakeRun = (async () => ({
      sessionId: "s1",
      output: "out",
      reason: "completed",
      artifactIds: ["a1"],
    })) as never;

    const result = await runMastermind(run, {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    });

    // 第 1 阶段 skipped、第 2 阶段 done → 整 run partial（非全 done）
    expect(result.status).toBe("partial");
    expect(result.stages[0].status).toBe("skipped");
    expect(result.stages[1].status).toBe("done");
  });
});

describe("runMastermind AC-4.4 临时造 agentId", () => {
  it("跑后 AgentProfileStore 新增 teammates.length 档案、各 stage.agentId 非空、名含 uuid8", async () => {
    const run = makeRun(3); // 3 队员、agentId 全占位空串
    // 起始档案数（应为 0）
    const before = profileStore.list(projectId).length;

    const fakeRun = (async () => ({
      sessionId: "s",
      output: "out",
      reason: "completed",
      artifactIds: ["a"],
    })) as never;

    const result = await runMastermind(run, {
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
    // 恰新增 3 个临时档案
    const after = profileStore.list(projectId);
    expect(after.length - before).toBe(3);
    // 各 stage.agentId 非空、agentName 含「role-<uuid8>」形态
    for (let k = 0; k < 3; k++) {
      expect(result.stages[k].agentId).toBeTruthy();
      expect(result.stages[k].agentName).toMatch(new RegExp(`^role${k + 1}-[0-9a-f]{8}$`));
      // 落盘可查到该档案
      expect(() => profileStore.get(projectId, result.stages[k].agentId)).not.toThrow();
    }
  });

  it("failRun 兜底（signal 起始即 aborted）→ run failed 终态（写 finishedAt）、worker 0 调用", async () => {
    const run = makeRun(2);
    const controller = new AbortController();
    controller.abort();
    const worker = vi.fn();
    const result = await runMastermind(
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
    expect(result.status).toBe("failed"); // abort 属终态 failed（非 paused）
    expect(result.failedReason).toBe("已取消");
    expect(result.finishedAt).not.toBeNull();
    expect(worker).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C. 并行分支（M6/D-V1.2-87 档 2·真并行扇出）
//    覆盖 T6 AC ①~⑥：全成/部分败(全 settle 才判)/批内 upstream 独立/serial 零回归/取消不起新 stage。
// ===========================================================================
describe("runMastermind 并行分支（execution=parallel）", () => {
  /** 造一个 execution=parallel 的 running run（其余同 makeRun）。 */
  function makeParallelRun(n: number): MastermindRun {
    const run = makeRun(n);
    run.plan.execution = "parallel";
    return run;
  }

  /**
   * 可控并行 harness：每 stage 一个 deferred，测试显式 resolve 才让该 stage 的 worker 回合结束——
   * 借此断言「真并行」（全部 worker 都已进场后才逐个放行）+「全 settle 才判定」（失败 stage 先结束、
   * 成功 stage 仍在跑、批判定等到最后一个 settle）。
   *   - fauxMap 唯一计数源；worker 进场 set、evict destroy 删（真回落）。
   *   - acquireSlot 用宽 limit（并行放行多 worker）；evictSpy 记 sid。
   */
  function makeParallelHarness(opts?: {
    /** 按 firstMessage（含 stage.subTask=`子任务N`）判该 worker 返 reason；缺省全 completed。 */
    reasonFor?: (firstMessage: string) => "completed" | "timeout";
    /** acquireSlot 上限（并行需 ≥ stage 数才能全部同时放行）。 */
    limit?: number;
  }) {
    const limit = opts?.limit ?? 8;
    const fauxMap = new Map<string, AgentSessionWrapper>();
    const enteredOrder: string[] = []; // worker 进场序（profile.id 顺序 = 派发序）
    const firstMessages: string[] = [];
    const evictedSids: (string | null)[] = [];
    let seq = 0;
    let peak = 0;

    // 每次 runWorker 调用对应一个「回合结束」闸门；测试 resolve 它才让该 worker 结束。
    const gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
    function newGate() {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      const g = { promise, resolve };
      gates.push(g);
      return g;
    }

    function makeFakeWrapper(sid: string): AgentSessionWrapper {
      let alive = true;
      return {
        isAlive: () => alive,
        inner: { isStreaming: false },
        send: async () => null,
        destroy: () => {
          alive = false;
          fauxMap.delete(sid);
        },
      } as unknown as AgentSessionWrapper;
    }

    const fauxRunWorker = (async (args: { firstMessage: string; profile: { id: string } }) => {
      const idx = seq++;
      const sid = "s" + idx;
      const gate = newGate();
      fauxMap.set(sid, makeFakeWrapper(sid));
      peak = Math.max(peak, fauxMap.size);
      enteredOrder.push(sid);
      firstMessages.push(args.firstMessage);
      await gate.promise; // ★等测试放行——期间其它 stage 的 worker 也已进场（证真并行）
      const reason = opts?.reasonFor?.(args.firstMessage) ?? "completed";
      return {
        sessionId: sid,
        reason,
        output: reason === "completed" ? "out" + idx : "",
        artifactIds: reason === "completed" ? ["a" + idx] : ([] as string[]),
        createdContent: "C" + idx,
        firstMessage: args.firstMessage,
      };
    }) as never;

    const acquireSpy = vi.fn(async (o?: Parameters<typeof acquireSlot>[0]) =>
      acquireSlot({
        activeCount: () => fauxMap.size,
        limit,
        timeoutMs: o?.timeoutMs === Infinity ? 500 : (o?.timeoutMs ?? 500),
        pollMs: 1,
      }),
    );

    const evictSpy = vi.fn((root: string, sessionId: string | null) => {
      evictedSids.push(sessionId);
      return evictSession(root, sessionId, { getSession: (s) => fauxMap.get(s) });
    });

    return {
      fauxMap,
      enteredOrder,
      firstMessages,
      evictedSids,
      gates,
      /** 放行第 idx 个进场的 worker（让其回合结束）。 */
      release: (idx: number) => gates[idx]?.resolve(),
      releaseAll: () => gates.forEach((g) => g.resolve()),
      get peak() {
        return peak;
      },
      get workerCalls() {
        return seq;
      },
      acquireSpy,
      evictSpy,
      deps: {
        registry,
        runStore,
        profileStore,
        runWorker: fauxRunWorker,
        acquireSlot: acquireSpy as unknown as typeof acquireSlot,
        setOwner: vi.fn(),
        evictSession: evictSpy as unknown as typeof evictSession,
        registerInnerSession: throwingRegister,
      },
    };
  }

  it("AC① 全成 → done + 每 stage 各 evict 一次 + acquireSlot 调用次数=stage 数 + 三 worker 同时在场（真并行）", async () => {
    const run = makeParallelRun(3);
    const h = makeParallelHarness();

    const p = runMastermind(run, h.deps);

    // 等三 worker 都进场（证真并行：全部 acquireSlot 放行、三 worker 同时占槽），再逐个放行。
    await vi.waitFor(() => expect(h.workerCalls).toBe(3), { timeout: 1000 });
    expect(h.fauxMap.size).toBe(3); // 三 worker 同时在场
    expect(h.peak).toBe(3);
    h.releaseAll();

    const result = await p;
    expect(result.status).toBe("done");
    expect(result.stages.every((s) => s.status === "done")).toBe(true);
    // 每 stage 各 evict 一次（3 次）、命中三 sid
    expect(h.evictSpy).toHaveBeenCalledTimes(3);
    expect([...h.evictedSids].sort()).toEqual(["s0", "s1", "s2"]);
    // acquireSlot 调用次数 = stage 数（每 stage 一次、无重试）
    expect(h.acquireSpy).toHaveBeenCalledTimes(3);
    // 全 evict 后 fauxMap 回落 0
    expect(h.fauxMap.size).toBe(0);
  }, 6000);

  it("AC② 部分失败 → 全批 settle 后才 pauseRun（不 fail-fast：失败发生后其余 stage 仍完成）", async () => {
    const run = makeParallelRun(3);
    // 按 firstMessage 精确指定失败 stage（含 stage.subTask=`子任务N`）：order1 两 attempt 都 timeout、
    // 其余 completed。全并行（limit=8）；用 waitFor 循环持续放行新出现的 gate（含失败 stage retry 新起的）。
    const h = makeParallelHarness({
      limit: 8,
      reasonFor: (msg) => (msg.includes("子任务1") && !msg.includes("子任务10") ? "timeout" : "completed"),
    });

    const p = runMastermind(run, h.deps);
    // 持续放行：任何已出现但未放行的 gate 都 resolve，直到 run 促结。含失败 stage 的 attempt1 新 gate。
    let settled = false;
    const settlePromise = p.then((r) => {
      settled = true;
      return r;
    });
    const released = new Set<number>();
    while (!settled) {
      for (let i = 0; i < h.gates.length; i++) {
        if (!released.has(i)) {
          released.add(i);
          h.release(i);
        }
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    const result = await settlePromise;

    // ★整批 settle 后才 pause（非 fail-fast）：order1 失败，但 order2/order3 都跑完成 done。
    expect(result.status).toBe("paused");
    expect(result.failedTeammate?.order).toBe(1);
    expect(result.failedReason).toBe("阶段超时");
    expect(result.failureOptions).toEqual(["retry", "reassign", "skip", "abort"]);
    const byOrder = [...result.stages].sort((a, b) => a.order - b.order);
    expect(byOrder[0].status).toBe("failed");
    expect(byOrder[1].status).toBe("done"); // ★失败发生后其余 stage 仍完成（不 fail-fast 铁证）
    expect(byOrder[2].status).toBe("done");
    // 失败 stage 恰 2 次 worker（attempt0+1），成功 stage 各 1 次 → 共 4 次
    expect(h.workerCalls).toBe(4);
  }, 8000);

  it("AC③ 批内 upstream 独立：每 stage 的 firstMessage 都不含上游产物（并行无累积喂下游）", async () => {
    const run = makeParallelRun(3);
    const h = makeParallelHarness();
    const p = runMastermind(run, h.deps);
    await vi.waitFor(() => expect(h.workerCalls).toBe(3), { timeout: 1000 });
    h.releaseAll();
    await p;
    expect(h.firstMessages).toHaveLength(3);
    for (const msg of h.firstMessages) {
      expect(msg).not.toContain("上游产物");
      expect(msg).not.toContain("###"); // formatUpstream 前缀，parallel 绝不出现
      expect(msg).toContain("请在完成后调用 create_artifact");
    }
  }, 6000);

  it("AC⑥ cancelRequested（signal aborted）→ 并行下不起任何 stage、run failed('已取消')、worker 0 调用", async () => {
    const run = makeParallelRun(3);
    const controller = new AbortController();
    controller.abort(); // 起跑前即取消
    const h = makeParallelHarness();
    const result = await runMastermind(run, h.deps, controller.signal);
    expect(result.status).toBe("failed");
    expect(result.failedReason).toBe("已取消");
    expect(result.finishedAt).not.toBeNull();
    expect(h.workerCalls).toBe(0); // 并行下不起任何 stage
  }, 4000);
});

// ===========================================================================
// D. serial 零回归补充：无 execution 字段 / execution='serial' 都走串行 + 累积喂下游
//    （现有 A/B 组测试已隐含无 execution 走 serial；此处显式钉死语义。）
// ===========================================================================
describe("runMastermind serial 零回归（无 execution / execution=serial 均串行累积）", () => {
  function serialDeps(firstMessages: string[]) {
    const fakeRun = (async (args: { firstMessage: string }) => {
      firstMessages.push(args.firstMessage);
      return {
        sessionId: "s" + firstMessages.length,
        output: "out" + firstMessages.length,
        reason: "completed",
        artifactIds: ["a" + firstMessages.length],
        createdContent: "CONTENT" + firstMessages.length,
      };
    }) as never;
    return {
      registry,
      runStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: (async () => {}) as unknown as typeof acquireSlot,
      setOwner: vi.fn(),
      evictSession: vi.fn(async () => {}) as unknown as typeof evictSession,
      registerInnerSession: throwingRegister,
    };
  }

  it("无 execution 字段 → 串行执行，stage2 firstMessage 含 stage1 累积产物", async () => {
    const run = makeRun(2); // 无 execution
    const firstMessages: string[] = [];
    const result = await runMastermind(run, serialDeps(firstMessages));
    expect(result.status).toBe("done");
    // 串行累积：第 2 阶段首条消息含上游产物段 + 第 1 阶段产物正文
    expect(firstMessages[1]).toContain("## 上游产物（累积）");
    expect(firstMessages[1]).toContain("CONTENT1");
  });

  it("execution='serial' → 与无字段行为一致（串行累积）", async () => {
    const run = makeRun(2);
    run.plan.execution = "serial";
    const firstMessages: string[] = [];
    const result = await runMastermind(run, serialDeps(firstMessages));
    expect(result.status).toBe("done");
    expect(firstMessages[1]).toContain("## 上游产物（累积）");
    expect(firstMessages[1]).toContain("CONTENT1");
  });
});
