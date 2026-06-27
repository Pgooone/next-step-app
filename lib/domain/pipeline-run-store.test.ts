/**
 * pipeline-run-store 领域单测：create/get/write/findRun 读写、listRuns（倒序/pipelineId 过滤/跳坏文件/
 * N 截断）、pruneOld 保留上限 M（仅删终态、保护 running）、reconcileOrphan 五分支（注入自造 Set，不碰 globalThis）。
 */
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PipelineRunStore, type PipelineRun } from "./pipeline-run-store";
import { PipelineError } from "./pipeline-store";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let store: PipelineRunStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r7-run-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new PipelineRunStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
/** 造一个完整 PipelineRun 对象（全字段），overrides 局部改写。 */
function makeRun(over: Partial<PipelineRun> = {}): PipelineRun {
  seq += 1;
  return {
    id: over.id ?? `run-${seq}`,
    projectId: over.projectId ?? projectId,
    pipelineId: over.pipelineId ?? "P1",
    pipelineName: over.pipelineName ?? "流水线",
    status: over.status ?? "running",
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
      },
    ],
  };
}

describe("PipelineRunStore 读写", () => {
  it("create 后 get 回读全字段一致；文件落 runs/<id>.json", () => {
    const run = makeRun({ id: "r-read" });
    store.create(projectId, run);
    const path = join(dir, ".pi", "factory", "runs", "r-read.json");
    expect(existsSync(path)).toBe(true);
    const got = store.get(projectId, "r-read");
    expect(got).toEqual(run);
  });

  it("write 读-改-写：改 status/currentStageIndex 后 write → get 回读最新", () => {
    const run = makeRun({ id: "r-write" });
    store.create(projectId, run);
    run.status = "done";
    run.currentStageIndex = 1;
    store.write(projectId, run);
    const got = store.get(projectId, "r-write");
    expect(got.status).toBe("done");
    expect(got.currentStageIndex).toBe(1);
  });

  it("get 不存在 → NOT_FOUND", () => {
    expect(() => store.get(projectId, "nope")).toThrow(PipelineError);
    expect(() => store.get(projectId, "nope")).toThrow(/不存在/);
  });

  it("findRun 跨项目：返回 {projectId, run}（非裸 run）；找不到 NOT_FOUND", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-r7-run2-"));
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

describe("PipelineRunStore.listRuns", () => {
  it("倒序：最新 createdAt 在前", () => {
    store.create(projectId, makeRun({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }));
    store.create(projectId, makeRun({ id: "mid", createdAt: "2026-02-01T00:00:00.000Z" }));
    store.create(projectId, makeRun({ id: "new", createdAt: "2026-03-01T00:00:00.000Z" }));
    const list = store.listRuns(projectId, "P1");
    expect(list.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("pipelineId 过滤：只返回该蓝图的 run", () => {
    store.create(projectId, makeRun({ id: "p1-a", pipelineId: "P1" }));
    store.create(projectId, makeRun({ id: "p1-b", pipelineId: "P1" }));
    store.create(projectId, makeRun({ id: "p2-a", pipelineId: "P2" }));
    const list = store.listRuns(projectId, "P1");
    expect(list).toHaveLength(2);
    expect(list.every((r) => r.pipelineId === "P1")).toBe(true);
  });

  it("目录不存在（从未起 run）→ []", () => {
    expect(store.listRuns(projectId, "P1")).toEqual([]);
  });

  it("跳坏文件：坏 json 不抛、只返回正常 run", () => {
    store.create(projectId, makeRun({ id: "ok" }));
    const rdir = join(dir, ".pi", "factory", "runs");
    writeFileSync(join(rdir, "bad.json"), "{ not json", "utf-8");
    const list = store.listRuns(projectId, "P1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("ok");
  });

  it("N 截断：22 个同 pipelineId run → 只返回 20", () => {
    for (let i = 0; i < 22; i++) {
      // createdAt 递增确保排序稳定（i 补零防字典序错乱）
      const ts = `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
      store.create(projectId, makeRun({ id: `r-${i}`, createdAt: ts }));
    }
    expect(store.listRuns(projectId, "P1")).toHaveLength(20);
  });
});

describe("PipelineRunStore.pruneOld（经 create 触发）", () => {
  function ts(i: number): string {
    return `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
  }

  it("52 个终态 run → 盘上保留 50，最旧两个被删", () => {
    for (let i = 0; i < 52; i++) {
      store.create(projectId, makeRun({ id: `done-${i}`, status: "done", createdAt: ts(i) }));
    }
    const rdir = join(dir, ".pi", "factory", "runs");
    const files = readdirSync(rdir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(50);
    // 最旧两个（done-0/done-1）应被删
    expect(existsSync(join(rdir, "done-0.json"))).toBe(false);
    expect(existsSync(join(rdir, "done-1.json"))).toBe(false);
    expect(existsSync(join(rdir, "done-2.json"))).toBe(true);
  });

  it("保护非终态：49 终态 + 3 running（共 52 > M）→ 只删终态最旧、running 全保留", () => {
    // 先写 3 个 running（createdAt 最早，若误删会先删它们）
    for (let i = 0; i < 3; i++) {
      store.create(projectId, makeRun({ id: `run-${i}`, status: "running", createdAt: ts(i) }));
    }
    // 再写 49 个终态
    for (let i = 0; i < 49; i++) {
      store.create(projectId, makeRun({ id: `done-${i}`, status: "done", createdAt: ts(10 + i) }));
    }
    const rdir = join(dir, ".pi", "factory", "runs");
    // 3 running 必须都还在（overflow=2 只能从终态里删）
    expect(existsSync(join(rdir, "run-0.json"))).toBe(true);
    expect(existsSync(join(rdir, "run-1.json"))).toBe(true);
    expect(existsSync(join(rdir, "run-2.json"))).toBe(true);
    // 终态最旧两个被删
    expect(existsSync(join(rdir, "done-0.json"))).toBe(false);
    expect(existsSync(join(rdir, "done-1.json"))).toBe(false);
    // 总数 = 52 - 2 = 50
    expect(readdirSync(rdir).filter((f) => f.endsWith(".json"))).toHaveLength(50);
  });
});

describe("PipelineRunStore.reconcileOrphan（注入自造 Set，不碰 globalThis）", () => {
  it("① 终态 done → 原样返回且未写盘", () => {
    const run = makeRun({ id: "rc-done", status: "done" });
    store.create(projectId, run);
    const path = join(dir, ".pi", "factory", "runs", "rc-done.json");
    const mtimeBefore = statSync(path).mtimeMs;
    const out = store.reconcileOrphan(projectId, run, new Set());
    expect(out.status).toBe("done");
    expect(statSync(path).mtimeMs).toBe(mtimeBefore); // 未写盘
  });

  it("② running 且当前阶段会话在活集 → 不变", () => {
    const run = makeRun({ id: "rc-live", status: "running" }); // 默认 stages[0].sessionId="s1"
    const out = store.reconcileOrphan(projectId, run, new Set(["s1"]));
    expect(out.status).toBe("running");
  });

  it("③ running 且当前阶段会话已死 → failed + 文案精确 + 当前阶段翻 + 回写磁盘", () => {
    const run = makeRun({ id: "rc-dead", status: "running" }); // stages[0].sessionId="s1", status="running"
    store.create(projectId, run);
    const out = store.reconcileOrphan(projectId, run, new Set()); // 空活集 → s1 已死
    expect(out.status).toBe("failed");
    expect(out.failedReason).toBe("进程重启,运行已中断");
    expect(out.stages[0].status).toBe("failed");
    expect(out.finishedAt).not.toBeNull();
    // 磁盘回写验证（内部 write 副作用）
    expect(store.get(projectId, "rc-dead").status).toBe("failed");
  });

  it("④ pending 阶段（cur.sessionId=null，status running）→ 不动", () => {
    const run = makeRun({
      id: "rc-pending",
      status: "running",
      currentStageIndex: 0,
      stages: [
        {
          order: 1,
          agentId: "a",
          agentName: "A",
          subTask: "t",
          status: "pending",
          sessionId: null, // 未起 worker
          artifactId: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    const out = store.reconcileOrphan(projectId, run, new Set());
    expect(out.status).toBe("running"); // cur?.sessionId 为 null falsy 短路，不翻
  });

  it("⑤ currentStageIndex 越界（=99）→ cur 为 undefined，?. 短路，不抛、原样 running", () => {
    const run = makeRun({ id: "rc-oob", status: "running", currentStageIndex: 99 });
    expect(() => store.reconcileOrphan(projectId, run, new Set())).not.toThrow();
    expect(run.status).toBe("running");
  });

  it("⑤b stages=[]（空）+ running → cur undefined，不抛、原样 running", () => {
    const run = makeRun({ id: "rc-empty", status: "running", currentStageIndex: 0, stages: [] });
    expect(() => store.reconcileOrphan(projectId, run, new Set())).not.toThrow();
    expect(run.status).toBe("running");
  });
});
