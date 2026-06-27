/**
 * pipeline-store 领域单测：create 校验（名称/阶段数 >=1/字段非空/order={1..N} 连续无重无缺/整数）、
 * 落盘归一与读取、get/list（含跳坏文件）/update/delete（历史 run 保留）/findBlueprint 跨项目。
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PipelineStore, PipelineError } from "./pipeline-store";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let store: PipelineStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r7-pipeline-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new PipelineStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 合法阶段工厂，覆盖默认值便于单测局部改写。 */
function stage(order: number, over: Partial<{ agentId: string; subTaskTemplate: string }> = {}) {
  return { order, agentId: over.agentId ?? "a", subTaskTemplate: over.subTaskTemplate ?? "t" };
}

describe("PipelineStore.create 校验", () => {
  it("name 空 → INVALID（/名称/）", () => {
    expect(() => store.create(projectId, { name: "  ", stages: [stage(1)] })).toThrow(PipelineError);
    expect(() => store.create(projectId, { name: "  ", stages: [stage(1)] })).toThrow(/名称/);
  });

  it("stages=[]（0 阶段）→ INVALID（/>=1/）", () => {
    expect(() => store.create(projectId, { name: "p", stages: [] })).toThrow(/>=1|阶段数/);
  });

  it("空 agentId → INVALID（/agentId/）", () => {
    expect(() =>
      store.create(projectId, { name: "p", stages: [stage(1, { agentId: " " })] }),
    ).toThrow(/agentId/);
  });

  it("空 subTaskTemplate → INVALID（/subTaskTemplate/）", () => {
    expect(() =>
      store.create(projectId, { name: "p", stages: [stage(1, { subTaskTemplate: " " })] }),
    ).toThrow(/subTaskTemplate/);
  });

  it("order 重复 → INVALID", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(1), stage(1)] })).toThrow(
      /order/,
    );
  });

  it("order 缺号 [1,3] → INVALID", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(1), stage(3)] })).toThrow(
      /order/,
    );
  });

  it("order 非 1 起 [2,3] → INVALID", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(2), stage(3)] })).toThrow(
      /order/,
    );
  });

  it("order 含 0 [0,1] → INVALID", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(0), stage(1)] })).toThrow(
      /order/,
    );
  });

  it("order 含负 [-1,1] → INVALID", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(-1), stage(1)] })).toThrow(
      /order/,
    );
  });

  it("order 小数 [1.5,2] → INVALID（/整数|order/）", () => {
    expect(() => store.create(projectId, { name: "p", stages: [stage(1.5), stage(2)] })).toThrow(
      /整数|order/,
    );
  });
});

describe("PipelineStore.create 落盘", () => {
  it("合法乱序 order → 归一升序 + 落盘 + 回读", () => {
    const bp = store.create(projectId, {
      name: "流水线",
      stages: [stage(2, { agentId: "b" }), stage(1, { agentId: "a" })],
    });
    expect(bp.stages[0].order).toBe(1);
    expect(bp.stages[1].order).toBe(2);
    expect(bp.stages[0].agentId).toBe("a"); // 归一后第一位是原 order=1 的那条

    const path = join(dir, ".pi", "factory", "pipelines", `${bp.id}.json`);
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.id).toBe(bp.id);
    expect(onDisk.stages[0].order).toBe(1);
  });

  it("trim 生效（agentId/subTaskTemplate）", () => {
    const bp = store.create(projectId, {
      name: "p",
      stages: [{ order: 1, agentId: " a ", subTaskTemplate: " t " }],
    });
    expect(bp.stages[0].agentId).toBe("a");
    expect(bp.stages[0].subTaskTemplate).toBe("t");
  });

  it("createdAt/updatedAt 初次相等且为 ISO 串", () => {
    const bp = store.create(projectId, { name: "p", stages: [stage(1)] });
    expect(bp.createdAt).toBe(bp.updatedAt);
    expect(new Date(bp.createdAt).toISOString()).toBe(bp.createdAt);
  });
});

describe("PipelineStore CRUD", () => {
  it("get 不存在 → NOT_FOUND（/不存在/）", () => {
    expect(() => store.get(projectId, "nope")).toThrow(PipelineError);
    expect(() => store.get(projectId, "nope")).toThrow(/不存在/);
  });

  it("list 空目录 → []", () => {
    expect(store.list(projectId)).toEqual([]);
  });

  it("list 跳坏文件：坏 json 不抛、只返回正常蓝图", () => {
    const good = store.create(projectId, { name: "good", stages: [stage(1)] });
    const pdir = join(dir, ".pi", "factory", "pipelines");
    writeFileSync(join(pdir, "bad.json"), "{ not json", "utf-8");
    const list = store.list(projectId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(good.id);
  });

  it("list 按 updatedAt 倒序（最近改在前）", () => {
    const a = store.create(projectId, { name: "A", stages: [stage(1)] });
    const b = store.create(projectId, { name: "B", stages: [stage(1)] });
    // 改 a 使其 updatedAt 后于 b
    store.update(projectId, a.id, { name: "A2", stages: [stage(1)] });
    const list = store.list(projectId);
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it("update 改 name/stages → id/createdAt 不变、updatedAt 变、stages 替换并归一", () => {
    const bp = store.create(projectId, { name: "p", stages: [stage(1)] });
    const next = store.update(projectId, bp.id, {
      name: "p2",
      stages: [stage(2, { agentId: "y" }), stage(1, { agentId: "x" })],
    });
    expect(next.id).toBe(bp.id);
    expect(next.createdAt).toBe(bp.createdAt);
    expect(next.updatedAt >= bp.updatedAt).toBe(true);
    expect(next.name).toBe("p2");
    expect(next.stages[0].order).toBe(1);
    expect(next.stages[0].agentId).toBe("x");
    expect(next.stages).toHaveLength(2);
  });

  it("update 校验失败（0 阶段 / order 缺号）→ INVALID", () => {
    const bp = store.create(projectId, { name: "p", stages: [stage(1)] });
    expect(() => store.update(projectId, bp.id, { name: "p", stages: [] })).toThrow(PipelineError);
    expect(() =>
      store.update(projectId, bp.id, { name: "p", stages: [stage(1), stage(3)] }),
    ).toThrow(/order/);
  });

  it("update 不存在的 pipelineId → NOT_FOUND，且不写孤儿（目录无新文件）", () => {
    const pdir = join(dir, ".pi", "factory", "pipelines");
    expect(() => store.update(projectId, "ghost", { name: "p", stages: [stage(1)] })).toThrow(
      PipelineError,
    );
    // 校验在 get 之后，故不会写出 ghost.json（pipelines 目录可能根本不存在）
    expect(existsSync(join(pdir, "ghost.json"))).toBe(false);
  });

  it("delete 后 get → NOT_FOUND；同项目 runs/ 预置 run 仍在（历史保留）", () => {
    const bp = store.create(projectId, { name: "p", stages: [stage(1)] });
    // 预置一个 run 文件，验证 delete 蓝图不碰 runs/
    const rdir = join(dir, ".pi", "factory", "runs");
    mkdirSync(rdir, { recursive: true });
    const runFile = join(rdir, "run-1.json");
    writeFileSync(runFile, "{}", "utf-8");

    store.delete(projectId, bp.id);
    expect(() => store.get(projectId, bp.id)).toThrow(/不存在/);
    expect(existsSync(runFile)).toBe(true);
  });

  it("delete 不存在 → NOT_FOUND", () => {
    expect(() => store.delete(projectId, "nope")).toThrow(PipelineError);
  });

  it("findBlueprint 跨项目：在另一项目下命中返回 {projectId,blueprint}；找不到 NOT_FOUND", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-r7-pipeline2-"));
    try {
      const p2 = registry.create({ name: "proj2", root: dir2 }).id;
      const bp = store.create(p2, { name: "p2bp", stages: [stage(1)] });
      const found = store.findBlueprint(bp.id);
      expect(found.projectId).toBe(p2);
      expect(found.blueprint.id).toBe(bp.id);
      expect(() => store.findBlueprint("ghost")).toThrow(PipelineError);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
