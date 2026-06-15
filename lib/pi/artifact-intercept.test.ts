/**
 * artifact-intercept 单测：resolveManagedTarget 运行时反查受管 artifact。
 * 覆盖：受管命中（含子路径/版本文件）、非受管放行(null)、含 `..` 归一、
 * 不误命中 Iter C 派发产物 <dispatchId>/、artifact.json 缺失的同名目录放行、跨项目定位。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactService } from "../domain/artifact-service";
import { ProjectRegistry } from "../domain/project-registry";
import { resolveManagedTarget } from "./artifact-intercept";

let dir: string;
let registry: ProjectRegistry;
let service: ArtifactService;
let projectId: string;
let projectRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-d2-intercept-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  // ProjectRegistry.create 校验 root 必须是已存在目录，故先建目录再注册
  const root = join(dir, "proj");
  mkdirSync(root, { recursive: true });
  const p = registry.create({ name: "proj", root });
  projectId = p.id;
  projectRoot = p.root;
  service = new ArtifactService(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function managedRoot(): string {
  return join(projectRoot, ".pi", "artifacts", "managed");
}

describe("resolveManagedTarget", () => {
  it("受管命中：managed/<id>/ 下的任意写盘路径 → 解出 (projectId, artifactId)", () => {
    const a = service.createArtifact(projectId, { kind: "crd", title: "需求", content: "x" });
    // agent 试图写 managed/<id>/versions/2.json（或任意子路径）
    const target = join(managedRoot(), a.id, "versions", "2.json");
    expect(resolveManagedTarget(target, registry)).toEqual({ projectId, artifactId: a.id });
  });

  it("受管命中：直接写 managed/<id>/foo.md 也命中", () => {
    const a = service.createArtifact(projectId, { kind: "prd", title: "t", content: "x" });
    expect(resolveManagedTarget(join(managedRoot(), a.id, "foo.md"), registry)).toEqual({
      projectId,
      artifactId: a.id,
    });
  });

  it("含 `..` 的路径先归一再判定 → 仍命中", () => {
    const a = service.createArtifact(projectId, { kind: "crd", title: "t", content: "x" });
    const messy = join(managedRoot(), a.id, "sub", "..", "real.md");
    expect(resolveManagedTarget(messy, registry)).toEqual({ projectId, artifactId: a.id });
  });

  it("非受管：项目内普通文件（非 managed 下）→ null（放行正常写）", () => {
    service.createArtifact(projectId, { kind: "crd", title: "t", content: "x" });
    expect(resolveManagedTarget(join(projectRoot, "src", "index.ts"), registry)).toBeNull();
  });

  it("不误命中 Iter C：派发产物 .pi/artifacts/<dispatchId>/<seq>.md → null", () => {
    service.createArtifact(projectId, { kind: "crd", title: "t", content: "x" });
    // Iter C 产物在 managed 的父级 artifacts/ 下
    const dispatchProduct = join(projectRoot, ".pi", "artifacts", "dispatch-abc", "1-agent.md");
    expect(resolveManagedTarget(dispatchProduct, registry)).toBeNull();
  });

  it("managed 下同名目录但无 artifact.json → null（不是受管 artifact）", () => {
    // 手造一个 managed/ghost/ 目录但不建 artifact.json
    const ghostDir = join(managedRoot(), "ghost-id");
    mkdirSync(ghostDir, { recursive: true });
    writeFileSync(join(ghostDir, "stray.md"), "noise", "utf-8");
    expect(resolveManagedTarget(join(ghostDir, "stray.md"), registry)).toBeNull();
  });

  it("跨项目定位：命中第二个项目的受管 artifact", () => {
    const root2 = join(dir, "proj2");
    mkdirSync(root2, { recursive: true });
    const p2 = registry.create({ name: "proj2", root: root2 });
    const a2 = service.createArtifact(p2.id, { kind: "crd", title: "t2", content: "y" });
    const target = join(p2.root, ".pi", "artifacts", "managed", a2.id, "foo.md");
    expect(resolveManagedTarget(target, registry)).toEqual({ projectId: p2.id, artifactId: a2.id });
  });

  it("完全无关的绝对路径（registry 外）→ null", () => {
    service.createArtifact(projectId, { kind: "crd", title: "t", content: "x" });
    expect(resolveManagedTarget("/tmp/somewhere/else.md", registry)).toBeNull();
  });
});
