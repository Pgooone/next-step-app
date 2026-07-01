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
