import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectError, ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let registryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-proj-"));
  registryPath = join(dir, "projects.json");
  registry = new ProjectRegistry(registryPath);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** try 调用、catch 断言抛出的是 ProjectError 且 code 匹配；未抛出则 fail。 */
function expectCode(fn: () => unknown, code: "NOT_FOUND" | "INVALID"): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectError);
    expect((error as ProjectError).code).toBe(code);
    return;
  }
  expect.fail(`期望抛出 ProjectError(${code})，但没有抛出异常`);
}

describe("ProjectRegistry", () => {
  it("文件不存在时 list() 返回 [] 且不创建文件", () => {
    expect(registry.list()).toEqual([]);
    expect(existsSync(registryPath)).toBe(false);
  });

  it("create() 返回合法项目并落盘", () => {
    const project = registry.create({ name: "demo", root: dir });
    expect(project.id).toHaveLength(36);
    expect(project.name).toBe("demo");
    expect(project.root).toBe(dir);
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
    expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);

    expect(existsSync(registryPath)).toBe(true);
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(project);
  });

  it("create() 空/空白 name 抛 INVALID", () => {
    expectCode(() => registry.create({ name: "", root: dir }), "INVALID");
    expectCode(() => registry.create({ name: "   ", root: dir }), "INVALID");
  });

  it("create() root 不存在抛 INVALID", () => {
    expectCode(() => registry.create({ name: "demo", root: join(dir, "nope") }), "INVALID");
  });

  it("create() 重名抛 INVALID", () => {
    registry.create({ name: "demo", root: dir });
    expectCode(() => registry.create({ name: "demo", root: dir }), "INVALID");
  });

  it("get() 命中返回；未知 id 抛 NOT_FOUND", () => {
    const project = registry.create({ name: "demo", root: dir });
    expect(registry.get(project.id)).toEqual(project);
    expectCode(() => registry.get("unknown-id"), "NOT_FOUND");
  });

  it("update() 改名生效并持久化；未知 id 抛 NOT_FOUND；改成已存在的名字抛 INVALID", () => {
    const a = registry.create({ name: "alpha", root: dir });
    registry.create({ name: "beta", root: dir });

    const updated = registry.update(a.id, { name: "alpha2" });
    expect(updated.name).toBe("alpha2");
    expect(registry.get(a.id).name).toBe("alpha2");

    expectCode(() => registry.update("unknown-id", { name: "x" }), "NOT_FOUND");
    expectCode(() => registry.update(a.id, { name: "beta" }), "INVALID");
  });

  it("remove() 后 list() 为空，但磁盘 root 目录仍存在；再次 remove 抛 NOT_FOUND", () => {
    const project = registry.create({ name: "demo", root: dir });
    registry.remove(project.id);

    expect(registry.list()).toEqual([]);
    // 关键 AC：删项目只移注册项，绝不删磁盘目录
    expect(existsSync(dir)).toBe(true);

    expectCode(() => registry.remove(project.id), "NOT_FOUND");
  });

  it("list() 遇损坏内容抛 INVALID", () => {
    writeFileSync(registryPath, "{ bad json", "utf-8");
    expectCode(() => registry.list(), "INVALID");
  });
});
