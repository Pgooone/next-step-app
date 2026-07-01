import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectMastermindNeedsPolling,
  useMastermindStore,
} from "./useMastermindStore";
import type { MastermindRun, MastermindRunStatus } from "@/lib/domain/mastermind-run-store";

function makeRun(overrides: Partial<MastermindRun> = {}): MastermindRun {
  return {
    id: "run-1",
    projectId: "proj",
    status: "awaiting_plan_approval",
    plan: {
      teammates: [
        { name: "研究员-a1b2c3d4", role: "研究员", subTask: "调研", acceptanceCriteria: "有报告" },
        { name: "撰稿人-e5f6a7b8", role: "撰稿人", subTask: "撰写", acceptanceCriteria: "有文档" },
      ],
      notes: "先调研再撰写",
    },
    stages: [],
    currentStageIndex: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    finishedAt: null,
    cancelRequested: false,
    failedReason: null,
    ...overrides,
  };
}

/** mock 一个返回给定 run 的 fetch（Response 形态：ok/status/json）。 */
function okResponse(run: MastermindRun) {
  return { ok: true, status: 200, json: async () => run };
}
function errResponse(status: number, body: { error?: string; code?: string } = {}) {
  return { ok: false, status, json: async () => body };
}

beforeEach(() => {
  useMastermindStore.setState({ runs: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectMastermindNeedsPolling：仅 running 需轮询（6 态断言）", () => {
  const states: MastermindRunStatus[] = [
    "awaiting_plan_approval",
    "running",
    "done",
    "failed",
    "paused",
    "partial",
  ];
  it("只有 running → true，其余 5 态 → false", () => {
    for (const status of states) {
      expect(selectMastermindNeedsPolling(makeRun({ status }))).toBe(status === "running");
    }
  });
  it("null / undefined → false", () => {
    expect(selectMastermindNeedsPolling(null)).toBe(false);
    expect(selectMastermindNeedsPolling(undefined)).toBe(false);
  });
});

describe("ensureRun：幂等首拉写回 runs[runId]", () => {
  it("GET 成功 → 写进 runs（按 run.id 索引）", async () => {
    const run = makeRun();
    const fetchMock = vi.fn().mockResolvedValue(okResponse(run));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().ensureRun("run-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/mastermind-runs/run-1");
    expect(useMastermindStore.getState().runs["run-1"]).toEqual(run);
  });

  it("多 run ensureRun 两个不同 runId → runs 不互相覆盖", async () => {
    const runA = makeRun({ id: "run-A" });
    const runB = makeRun({ id: "run-B", status: "running" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(runA))
      .mockResolvedValueOnce(okResponse(runB));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().ensureRun("run-A");
    await useMastermindStore.getState().ensureRun("run-B");

    const { runs } = useMastermindStore.getState();
    expect(runs["run-A"]).toEqual(runA);
    expect(runs["run-B"]).toEqual(runB);
    expect(Object.keys(runs).sort()).toEqual(["run-A", "run-B"]);
  });
});

describe("approve：项目态动作乐观写回 + 正确 URL", () => {
  it("POST approve URL 正确、响应体乐观写回 runs", async () => {
    const running = makeRun({ status: "running" });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(running));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().approve("proj", "run-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/mastermind/runs/run-1/approve");
    expect(init.method).toBe("POST");
    expect(useMastermindStore.getState().runs["run-1"]).toEqual(running);
  });
});

describe("cancel：跨项目 URL（无 projectId）+ 乐观写回", () => {
  it("POST /api/mastermind-runs/[id]/cancel、响应体写回", async () => {
    const cancelled = makeRun({ status: "failed", failedReason: "已取消" });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(cancelled));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().cancel("run-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/mastermind-runs/run-1/cancel");
    expect(useMastermindStore.getState().runs["run-1"]).toEqual(cancelled);
  });
});

describe("resume：reassign 带 newAgentId、其它 action 只带 action", () => {
  it("reassign → body 含 action+newAgentId、URL 正确", async () => {
    const running = makeRun({ status: "running" });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(running));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().resume("proj", "run-1", "reassign", "agent-9");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/mastermind/runs/run-1/resume");
    expect(JSON.parse(init.body as string)).toEqual({ action: "reassign", newAgentId: "agent-9" });
  });

  it("retry → body 仅 action（无 newAgentId 键）", async () => {
    const running = makeRun({ status: "running" });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(running));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().resume("proj", "run-1", "retry");

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ action: "retry" });
  });
});

describe("错误处置：任意非 2xx → re-fetch GET 覆盖本地（吸收 approve 409 / reject-revise-resume 422 不对称）", () => {
  it("approve 返 409{CONFLICT} → 触发 GET re-fetch 覆盖 + 不抛", async () => {
    const fresh = makeRun({ status: "running" });
    // 第一次 POST approve → 409；第二次 GET → 权威态。
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(409, { error: "状态冲突", code: "CONFLICT" }))
      .mockResolvedValueOnce(okResponse(fresh));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useMastermindStore.getState().approve("proj", "run-1")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/proj/mastermind/runs/run-1/approve");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/mastermind-runs/run-1"); // GET re-fetch
    expect(useMastermindStore.getState().runs["run-1"]).toEqual(fresh);
  });

  it("revise 返 422（INVALID）→ 同样 GET re-fetch 覆盖", async () => {
    const fresh = makeRun({ status: "failed", failedReason: "用户打回" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(422, { error: "不可打回" }))
      .mockResolvedValueOnce(okResponse(fresh));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().revise("proj", "run-1");

    expect(fetchMock.mock.calls[1][0]).toBe("/api/mastermind-runs/run-1");
    expect(useMastermindStore.getState().runs["run-1"]).toEqual(fresh);
  });

  it("非 2xx 且 re-fetch 也失败（404 已删）→ 不抛、保留本地态", async () => {
    useMastermindStore.setState({ runs: { "run-1": makeRun() } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(422, { error: "非法" }))
      .mockResolvedValueOnce(errResponse(404, { error: "不存在" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useMastermindStore.getState().reject("proj", "run-1")).resolves.toBeUndefined();
    // 本地态保留（未被 undefined 覆盖）。
    expect(useMastermindStore.getState().runs["run-1"].status).toBe("awaiting_plan_approval");
  });
});

describe("pollRunning：只 GET running 子集、写回各自", () => {
  it("两 run（一 running 一 done）→ 只对 running 那条发 GET", async () => {
    const runRunning = makeRun({ id: "run-R", status: "running" });
    const runDone = makeRun({ id: "run-D", status: "done" });
    useMastermindStore.setState({ runs: { "run-R": runRunning, "run-D": runDone } });

    const updated = makeRun({ id: "run-R", status: "done" });
    const fetchMock = vi.fn().mockResolvedValue(okResponse(updated));
    vi.stubGlobal("fetch", fetchMock);

    await useMastermindStore.getState().pollRunning();

    // 只对 running 的 run-R 发一次 GET。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mastermind-runs/run-R");
    expect(useMastermindStore.getState().runs["run-R"]).toEqual(updated);
    // done 的那条不动。
    expect(useMastermindStore.getState().runs["run-D"]).toEqual(runDone);
  });

  it("单条轮询失败静默、不抛、不动其它", async () => {
    const runRunning = makeRun({ id: "run-R", status: "running" });
    useMastermindStore.setState({ runs: { "run-R": runRunning } });
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(useMastermindStore.getState().pollRunning()).resolves.toBeUndefined();
    expect(useMastermindStore.getState().runs["run-R"]).toEqual(runRunning);
  });
});

describe("成本信号 N：awaiting 态 stages 为空 → 数 plan.teammates.length（非 stages.length）", () => {
  it("awaiting run 的 stages=[] 但 teammates 有 2 个 → N 应取 2", () => {
    const run = makeRun({ status: "awaiting_plan_approval", stages: [] });
    // 计划卡的成本信号取 plan.teammates.length（Trap 6：取 stages.length 会恒得 0）。
    expect(run.stages.length).toBe(0);
    expect(run.plan.teammates.length).toBe(2);
  });
});
