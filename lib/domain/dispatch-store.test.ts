/**
 * dispatch-store 领域单测：create 校验（goal/数量 2–3/字段非空）、落盘与读取、
 * get/findTask 的 NOT_FOUND 与跨项目定位、原子写后状态可回读。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DispatchStore, DispatchError } from "./dispatch-store";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let store: DispatchStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-c1-store-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new DispatchStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DispatchStore.create 校验", () => {
  it("goal 为空 → INVALID", () => {
    expect(() => store.create(projectId, { goal: "  ", assignments: [] })).toThrow(DispatchError);
  });

  it("assignment 数量 <2 或 >3 → INVALID", () => {
    expect(() =>
      store.create(projectId, { goal: "g", assignments: [{ agentId: "a", subTask: "t" }] }),
    ).toThrow(/2–3/);
    expect(() =>
      store.create(projectId, {
        goal: "g",
        assignments: [
          { agentId: "a", subTask: "t" },
          { agentId: "b", subTask: "t" },
          { agentId: "c", subTask: "t" },
          { agentId: "d", subTask: "t" },
        ],
      }),
    ).toThrow(/2–3/);
  });

  it("assignment.agentId / subTask 为空 → INVALID", () => {
    expect(() =>
      store.create(projectId, {
        goal: "g",
        assignments: [
          { agentId: "", subTask: "t" },
          { agentId: "b", subTask: "t" },
        ],
      }),
    ).toThrow(/agentId/);
    expect(() =>
      store.create(projectId, {
        goal: "g",
        assignments: [
          { agentId: "a", subTask: " " },
          { agentId: "b", subTask: "t" },
        ],
      }),
    ).toThrow(/subTask/);
  });

  it("合法输入 → 落盘 pending 任务，各 assignment 同为 pending，文件存在", () => {
    const task = store.create(projectId, {
      goal: "做点东西",
      assignments: [
        { agentId: "a1", subTask: "子任务1" },
        { agentId: "a2", subTask: "子任务2" },
      ],
    });
    expect(task.status).toBe("pending");
    expect(task.assignments.every((a) => a.status === "pending")).toBe(true);
    expect(task.assignments).toHaveLength(2);

    const path = join(dir, ".pi", "dispatch", `${task.id}.json`);
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.id).toBe(task.id);
    expect(onDisk.goal).toBe("做点东西");
  });

  it("会 trim goal/agentId/subTask", () => {
    const task = store.create(projectId, {
      goal: "  g  ",
      assignments: [
        { agentId: " a ", subTask: " t " },
        { agentId: "b", subTask: "u" },
      ],
    });
    expect(task.goal).toBe("g");
    expect(task.assignments[0].agentId).toBe("a");
    expect(task.assignments[0].subTask).toBe("t");
  });
});

describe("DispatchStore.get / findTask / write", () => {
  it("get 不存在 → NOT_FOUND", () => {
    expect(() => store.get(projectId, "nope")).toThrow(DispatchError);
    expect(() => store.get(projectId, "nope")).toThrow(/不存在/);
  });

  it("write 后 get 回读到最新状态", () => {
    const task = store.create(projectId, {
      goal: "g",
      assignments: [
        { agentId: "a", subTask: "t" },
        { agentId: "b", subTask: "u" },
      ],
    });
    task.status = "running";
    task.assignments[0].status = "done";
    task.assignments[0].output = ".pi/artifacts/x/1-a.md";
    store.write(projectId, task);

    const reread = store.get(projectId, task.id);
    expect(reread.status).toBe("running");
    expect(reread.assignments[0].status).toBe("done");
    expect(reread.assignments[0].output).toBe(".pi/artifacts/x/1-a.md");
  });

  it("findTask 跨项目定位：只凭 taskId 在另一个项目下也能找到", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-c1-store2-"));
    try {
      const p2 = registry.create({ name: "proj2", root: dir2 }).id;
      const task = store.create(p2, {
        goal: "g2",
        assignments: [
          { agentId: "a", subTask: "t" },
          { agentId: "b", subTask: "u" },
        ],
      });
      // 不传 projectId，仅凭 taskId
      const found = store.findTask(task.id);
      expect(found.id).toBe(task.id);
      expect(found.projectId).toBe(p2);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("findTask 找不到 → NOT_FOUND", () => {
    expect(() => store.findTask("ghost")).toThrow(DispatchError);
  });
});
