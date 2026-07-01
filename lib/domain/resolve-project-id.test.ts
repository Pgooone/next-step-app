/**
 * 第 8.6 轮 · T3 —— resolveProjectIdByCwd 单测（cwd→projectId 反查）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectRegistry } from "./project-registry";
import { resolveProjectIdByCwd } from "./resolve-project-id";

let dir: string;
let registry: ProjectRegistry;
let projectId: string;
let root: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r86-resolvepid-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  const created = registry.create({ name: "proj", root: dir });
  projectId = created.id;
  root = created.root;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveProjectIdByCwd", () => {
  it("cwd 命中已注册项目根 → 返回 projectId", () => {
    expect(resolveProjectIdByCwd(root, registry)).toBe(projectId);
  });

  it("cwd 不在任何注册项目下 → null", () => {
    const other = mkdtempSync(join(tmpdir(), "ns-r86-other-"));
    try {
      expect(resolveProjectIdByCwd(other, registry)).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("空 registry → null（不抛）", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ns-r86-empty-"));
    try {
      const empty = new ProjectRegistry(join(emptyDir, "projects.json"));
      expect(resolveProjectIdByCwd(root, empty)).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
