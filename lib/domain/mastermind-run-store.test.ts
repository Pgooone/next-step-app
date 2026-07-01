/**
 * 第 8.6 轮 · T3 —— MastermindRunStore 领域单测（仿 pipeline-run-store.test.ts）。
 *
 * 重点覆盖与 PipelineRunStore 的差异：落盘目录独立（mastermind-runs/）、6 态状态机、
 *   - reconcileOrphan 对 paused/awaiting_plan_approval 早退不翻 failed（AC-4.2/4.3 命门）；
 *   - pruneOld 终态判定含 partial、且不删 paused/awaiting（非终态保护）。
 */
import { existsSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MastermindRunStore, type MastermindRun } from "./mastermind-run-store";
import { PipelineError } from "./pipeline-store";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let store: MastermindRunStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r86-mmrun-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new MastermindRunStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function makeRun(over: Partial<MastermindRun> = {}): MastermindRun {
  seq += 1;
  return {
    id: over.id ?? `mrun-${seq}`,
    projectId: over.projectId ?? projectId,
    status: over.status ?? "running",
    plan: over.plan ?? { teammates: [], notes: "" },
    currentStageIndex: over.currentStageIndex ?? 0,
    createdAt: over.createdAt ?? new Date().toISOString(),
    finishedAt: over.finishedAt ?? null,
    cancelRequested: over.cancelRequested ?? false,
    failedReason: over.failedReason ?? null,
    stages: over.stages ?? [
      {
        order: 1,
        agentId: "a",
        agentName: "Agent A",
        subTask: "做事",
        status: "running",
        sessionId: "s1",
        artifactId: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        retryCount: 0,
      },
    ],
    ...(over.failedTeammate ? { failedTeammate: over.failedTeammate } : {}),
    ...(over.failureOptions ? { failureOptions: over.failureOptions } : {}),
  };
}

describe("MastermindRunStore 读写", () => {
  it("create 后 get 回读全字段一致；文件落 mastermind-runs/<id>.json（独立目录）", () => {
    const run = makeRun({
      id: "r-read",
      status: "awaiting_plan_approval",
      plan: {
        teammates: [
          { name: "后端", role: "backend", subTask: "写 API", acceptanceCriteria: "过单测", mode: "coding" },
        ],
        notes: "备注",
      },
      stages: [],
    });
    store.create(projectId, run);
    const path = join(dir, ".pi", "factory", "mastermind-runs", "r-read.json");
    expect(existsSync(path)).toBe(true);
    // 与流水线 runs/ 目录物理隔离
    expect(existsSync(join(dir, ".pi", "factory", "runs", "r-read.json"))).toBe(false);
    expect(store.get(projectId, "r-read")).toEqual(run);
  });

  it("write 读-改-写：改 status/currentStageIndex 后 write → get 回读最新", () => {
    const run = makeRun({ id: "r-write", status: "awaiting_plan_approval", stages: [] });
    store.create(projectId, run);
    run.status = "running";
    run.currentStageIndex = 2;
    store.write(projectId, run);
    const got = store.get(projectId, "r-write");
    expect(got.status).toBe("running");
    expect(got.currentStageIndex).toBe(2);
  });

  it("get 不存在 → NOT_FOUND", () => {
    expect(() => store.get(projectId, "nope")).toThrow(PipelineError);
    expect(() => store.get(projectId, "nope")).toThrow(/不存在/);
  });

  it("findRun 跨项目：返回 {projectId, run}；找不到 NOT_FOUND", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-r86-mmrun2-"));
    try {
      const p2 = registry.create({ name: "proj2", root: dir2 }).id;
      const run = makeRun({ id: "r-cross", projectId: p2 });
      store.create(p2, run);
      const found = store.findRun("r-cross");
      expect(found.projectId).toBe(p2);
      expect(found.run.id).toBe("r-cross");
      expect(() => store.findRun("ghost")).toThrow(PipelineError);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe("MastermindRunStore.reconcileOrphan（AC-4.2/4.3 命门：paused/awaiting 早退不翻 failed）", () => {
  it("AC-4.3 awaiting_plan_approval（无活会话）→ early-return 原样、未写盘", () => {
    const run = makeRun({ id: "rc-await", status: "awaiting_plan_approval", stages: [] });
    store.create(projectId, run);
    const path = join(dir, ".pi", "factory", "mastermind-runs", "rc-await.json");
    const mtimeBefore = statSync(path).mtimeMs;
    const out = store.reconcileOrphan(projectId, run, new Set()); // 空活集
    expect(out.status).toBe("awaiting_plan_approval"); // 不因无会话翻 failed
    expect(statSync(path).mtimeMs).toBe(mtimeBefore); // 未写盘
  });

  it("AC-4.2 paused（失败暂停、无活会话）→ early-return 原样、未写盘", () => {
    const run = makeRun({
      id: "rc-paused",
      status: "paused",
      failedTeammate: { order: 1, agentId: "a", reason: "阶段超时" },
      failureOptions: ["retry", "reassign", "skip", "abort"],
      stages: [
        {
          order: 1,
          agentId: "a",
          agentName: "A",
          subTask: "t",
          status: "failed",
          sessionId: "s-dead",
          artifactId: null,
          startedAt: null,
          finishedAt: null,
          retryCount: 1,
        },
      ],
    });
    store.create(projectId, run);
    const path = join(dir, ".pi", "factory", "mastermind-runs", "rc-paused.json");
    const mtimeBefore = statSync(path).mtimeMs;
    const out = store.reconcileOrphan(projectId, run, new Set()); // 空活集：s-dead 不在
    expect(out.status).toBe("paused"); // 绝不翻 failed
    expect(statSync(path).mtimeMs).toBe(mtimeBefore);
  });

  it("running 且当前阶段会话已死 → failed + 文案 + 阶段翻 + 回写", () => {
    const run = makeRun({ id: "rc-dead", status: "running" }); // stages[0].sessionId="s1"
    store.create(projectId, run);
    const out = store.reconcileOrphan(projectId, run, new Set());
    expect(out.status).toBe("failed");
    expect(out.failedReason).toBe("进程重启,运行已中断");
    expect(out.stages[0].status).toBe("failed");
    expect(store.get(projectId, "rc-dead").status).toBe("failed");
  });

  it("running 且当前阶段会话仍在活集 → 不变", () => {
    const run = makeRun({ id: "rc-live", status: "running" });
    const out = store.reconcileOrphan(projectId, run, new Set(["s1"]));
    expect(out.status).toBe("running");
  });

  it("终态 done → 原样返回", () => {
    const run = makeRun({ id: "rc-done", status: "done" });
    const out = store.reconcileOrphan(projectId, run, new Set());
    expect(out.status).toBe("done");
  });
});

describe("MastermindRunStore.pruneOld（终态含 partial、保护 paused/awaiting）", () => {
  function ts(i: number): string {
    return `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
  }

  it("52 个终态（done/partial 混）→ 盘上保留 50，最旧两个被删", () => {
    for (let i = 0; i < 52; i++) {
      const status = i % 2 === 0 ? "done" : "partial";
      store.create(projectId, makeRun({ id: `t-${i}`, status, createdAt: ts(i) }));
    }
    const rdir = join(dir, ".pi", "factory", "mastermind-runs");
    expect(readdirSync(rdir).filter((f) => f.endsWith(".json"))).toHaveLength(50);
    expect(existsSync(join(rdir, "t-0.json"))).toBe(false);
    expect(existsSync(join(rdir, "t-1.json"))).toBe(false);
    expect(existsSync(join(rdir, "t-2.json"))).toBe(true);
  });

  it("保护非终态：2 paused + 1 awaiting + 49 done（共 52 > M）→ 只删终态最旧、非终态全保留", () => {
    // 非终态（createdAt 最早，若误删会先删它们）
    store.create(projectId, makeRun({ id: "paused-0", status: "paused", createdAt: ts(0) }));
    store.create(projectId, makeRun({ id: "paused-1", status: "paused", createdAt: ts(1) }));
    store.create(projectId, makeRun({ id: "await-0", status: "awaiting_plan_approval", createdAt: ts(2), stages: [] }));
    for (let i = 0; i < 49; i++) {
      store.create(projectId, makeRun({ id: `done-${i}`, status: "done", createdAt: ts(10 + i) }));
    }
    const rdir = join(dir, ".pi", "factory", "mastermind-runs");
    // 3 个非终态必须都还在（overflow=2 只能从终态删）
    expect(existsSync(join(rdir, "paused-0.json"))).toBe(true);
    expect(existsSync(join(rdir, "paused-1.json"))).toBe(true);
    expect(existsSync(join(rdir, "await-0.json"))).toBe(true);
    // 终态最旧两个被删
    expect(existsSync(join(rdir, "done-0.json"))).toBe(false);
    expect(existsSync(join(rdir, "done-1.json"))).toBe(false);
    expect(readdirSync(rdir).filter((f) => f.endsWith(".json"))).toHaveLength(50);
  });
});
