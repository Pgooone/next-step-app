/**
 * artifact-service 领域单测：落盘布局、版本自增（两计数语义）、listVersions 升序、
 * rollback 复制语义、乐观锁 409、原子写无残留、NOT_FOUND（含 findArtifact 跨项目定位）。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactService, ArtifactError } from "./artifact-service";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let service: ArtifactService;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-d1-artifact-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  service = new ArtifactService(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 断言领域错误的 .code 字段（仿 dispatch 测的 expectCode）。 */
function expectCode(fn: () => unknown, code: ArtifactError["code"]) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ArtifactError);
    expect((e as ArtifactError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛 ArtifactError(${code})，但没抛`);
}

/** 该 artifact 的 managed 目录（项目 root 即临时 dir）。 */
function managedArtifactDir(id: string): string {
  return join(dir, ".pi", "artifacts", "managed", id);
}

describe("ArtifactService.createArtifact", () => {
  it("kind / title 为空 → INVALID", () => {
    expectCode(() => service.createArtifact(projectId, { kind: " ", title: "t", content: "" }), "INVALID");
    expectCode(() => service.createArtifact(projectId, { kind: "k", title: " ", content: "" }), "INVALID");
  });

  it("落盘布局：managed/<id>/artifact.json + versions/1.json，currentVersion=1/version=1/draft", () => {
    const a = service.createArtifact(projectId, {
      kind: "crd",
      title: "需求文档",
      content: "首版内容",
      author: "user",
    });
    expect(a.currentVersion).toBe(1);
    expect(a.version).toBe(1);
    expect(a.status).toBe("draft");

    const root = managedArtifactDir(a.id);
    expect(existsSync(join(root, "artifact.json"))).toBe(true);
    expect(existsSync(join(root, "versions", "1.json"))).toBe(true);

    const onDisk = JSON.parse(readFileSync(join(root, "artifact.json"), "utf-8"));
    expect(onDisk.id).toBe(a.id);
    expect(onDisk.currentVersion).toBe(1);
    expect(onDisk.version).toBe(1);

    // getArtifact 回读 content = 首版
    const got = service.getArtifact(projectId, a.id);
    expect(got.content).toBe("首版内容");
  });

  it("extra 透传落盘", () => {
    const a = service.createArtifact(projectId, {
      kind: "crd",
      title: "t",
      content: "",
      extra: { references: ["m1"] },
    });
    expect(a.extra).toEqual({ references: ["m1"] });
    const reread = service.findArtifact(a.id).artifact;
    expect(reread.extra).toEqual({ references: ["m1"] });
  });
});

describe("ArtifactService.submitVersion 版本自增", () => {
  it("连续两次：currentVersion 1→2→3、version 同步 1→3、versions/2、3.json 存在、content=最后内容", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });

    const a2 = service.submitVersion(projectId, a.id, { content: "v2" });
    expect(a2.currentVersion).toBe(2);
    expect(a2.version).toBe(2);

    const a3 = service.submitVersion(projectId, a.id, { content: "v3" });
    expect(a3.currentVersion).toBe(3);
    expect(a3.version).toBe(3);

    const root = managedArtifactDir(a.id);
    expect(existsSync(join(root, "versions", "2.json"))).toBe(true);
    expect(existsSync(join(root, "versions", "3.json"))).toBe(true);

    expect(service.getArtifact(projectId, a.id).content).toBe("v3");
    expect(service.readCurrentContent(projectId, a.id)).toBe("v3");
  });

  it("content 缺失 → INVALID", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    expectCode(
      () => service.submitVersion(projectId, a.id, { content: undefined as unknown as string }),
      "INVALID",
    );
  });
});

describe("ArtifactService.listVersions", () => {
  it("按 version 升序、长度 = 提交次数", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    service.submitVersion(projectId, a.id, { content: "v2" });
    service.submitVersion(projectId, a.id, { content: "v3" });

    const versions = service.listVersions(projectId, a.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions).toHaveLength(3);
    expect(versions[2].content).toBe("v3");
  });

  it("artifact 不存在 → NOT_FOUND", () => {
    expectCode(() => service.listVersions(projectId, "ghost"), "NOT_FOUND");
  });
});

describe("ArtifactService.rollback", () => {
  it("回滚到 v1 生成 v4（不删 v1-3）、v4.content==v1.content、note 含 rollback to v1、currentVersion=4", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "内容1" });
    service.submitVersion(projectId, a.id, { content: "内容2" });
    service.submitVersion(projectId, a.id, { content: "内容3" });

    const rolled = service.rollback(projectId, a.id, { version: 1 });
    expect(rolled.currentVersion).toBe(4);
    expect(rolled.version).toBe(4);

    const root = managedArtifactDir(a.id);
    // 旧版全部保留
    for (const v of [1, 2, 3, 4]) {
      expect(existsSync(join(root, "versions", `${v}.json`))).toBe(true);
    }

    // v4 内容 == v1 内容
    expect(service.getArtifact(projectId, a.id).content).toBe("内容1");
    const versions = service.listVersions(projectId, a.id);
    const v4 = versions.find((v) => v.version === 4)!;
    expect(v4.content).toBe("内容1");
    expect(v4.note).toBe("rollback to v1");
  });

  it("回滚目标版不存在 → NOT_FOUND", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    expectCode(() => service.rollback(projectId, a.id, { version: 99 }), "NOT_FOUND");
  });

  it("回滚 version 非整数 / 缺失 → INVALID（路由层 422 的语义真相源）", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    expectCode(() => service.rollback(projectId, a.id, { version: 1.5 }), "INVALID");
    expectCode(
      () => service.rollback(projectId, a.id, { version: undefined as unknown as number }),
      "INVALID",
    );
  });
});

describe("ArtifactService 乐观锁（version 计数 + If-Match）", () => {
  it("submitVersion：正确 ifMatch 通过 → 旧 ifMatch 再提交 → VERSION_CONFLICT；undefined 放行", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    expect(a.version).toBe(1);

    // 用当前 version=1 提交成功 → version→2
    const a2 = service.submitVersion(projectId, a.id, { content: "v2", ifMatch: 1 });
    expect(a2.version).toBe(2);

    // 再用旧 ifMatch=1 提交 → 冲突
    expectCode(() => service.submitVersion(projectId, a.id, { content: "v3", ifMatch: 1 }), "VERSION_CONFLICT");

    // ifMatch=undefined 放行（不校验）
    const a3 = service.submitVersion(projectId, a.id, { content: "v3" });
    expect(a3.version).toBe(3);
  });

  it("rollback：旧 ifMatch → VERSION_CONFLICT", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    service.submitVersion(projectId, a.id, { content: "v2" }); // version→2
    expectCode(() => service.rollback(projectId, a.id, { version: 1, ifMatch: 1 }), "VERSION_CONFLICT");
  });
});

describe("ArtifactService 原子写 / 跨项目定位 / NOT_FOUND", () => {
  it("原子写不留半成品：managed/<id> 下无 *.tmp-* 残留", () => {
    const a = service.createArtifact(projectId, { kind: "k", title: "t", content: "v1" });
    service.submitVersion(projectId, a.id, { content: "v2" });
    service.rollback(projectId, a.id, { version: 1 });

    const root = managedArtifactDir(a.id);
    const stray: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.includes(".tmp-")) stray.push(e.name);
      }
    };
    walk(root);
    expect(stray).toEqual([]);
  });

  it("getArtifact / project 不存在 → NOT_FOUND", () => {
    expectCode(() => service.getArtifact(projectId, "ghost"), "NOT_FOUND");
    // findArtifact 跨项目未命中
    expectCode(() => service.findArtifact("ghost"), "NOT_FOUND");
  });

  it("project 不存在 → registry 抛 ProjectError，但 .code 仍为 NOT_FOUND（HTTP 映射一致）", () => {
    // 领域层不包裹 registry 错误（同 dispatch-store）；domainErrorResponse 按 .code 映射，
    // 故 ProjectError(NOT_FOUND) 与 ArtifactError(NOT_FOUND) 对外行为一致。
    let caught: unknown;
    try {
      service.getArtifact("no-such-project", "x");
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe("NOT_FOUND");
  });

  it("findArtifact 跨项目定位：第二个项目下建 artifact，仅凭 id 能找到", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-d1-artifact2-"));
    try {
      const p2 = registry.create({ name: "proj2", root: dir2 }).id;
      const a = service.createArtifact(p2, { kind: "k", title: "t", content: "v1" });

      const found = service.findArtifact(a.id);
      expect(found.projectId).toBe(p2);
      expect(found.artifact.id).toBe(a.id);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("findArtifact 不会误命中 Iter C 的 <dispatchId>/ 产物", () => {
    // 在同项目下伪造一个 Iter C 风格的派发产物目录（非 managed/）
    const fakeDispatchId = "dispatch-abc";
    const fakeDir = join(dir, ".pi", "artifacts", fakeDispatchId);
    mkdirSync(fakeDir, { recursive: true });
    // 用与 artifactId 同名的 dispatchId 也不该被 findArtifact 当成 managed artifact
    expectCode(() => service.findArtifact(fakeDispatchId), "NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// listArtifacts（供 ArtifactPanel 极简打开入口，D3）
// ---------------------------------------------------------------------------
describe("ArtifactService.listArtifacts", () => {
  it("managed 目录不存在（项目无 artifact）→ 空数组", () => {
    expect(service.listArtifacts(projectId)).toEqual([]);
  });

  it("列出该项目所有 artifact 元数据，按 title 升序", () => {
    // 用 ASCII 前缀让 localeCompare 排序与环境 locale 无关、断言确定
    service.createArtifact(projectId, { kind: "k", title: "B-乙文档", content: "" });
    service.createArtifact(projectId, { kind: "k", title: "A-甲文档", content: "" });
    const list = service.listArtifacts(projectId);
    expect(list.map((a) => a.title)).toEqual(["A-甲文档", "B-乙文档"]);
  });

  it("不含 content，但带 currentVersion / version / status", () => {
    service.createArtifact(projectId, { kind: "crd", title: "t", content: "正文" });
    const [a] = service.listArtifacts(projectId);
    expect(a).not.toHaveProperty("content");
    expect(a.currentVersion).toBe(1);
    expect(a.version).toBe(1);
    expect(a.status).toBe("draft");
  });

  it("跳过坏掉的 artifact.json，不拖垮整列表", () => {
    const good = service.createArtifact(projectId, { kind: "k", title: "好", content: "" });
    const badDir = join(dir, ".pi", "artifacts", "managed", "broken-artifact");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "artifact.json"), "{ not json", "utf-8");

    const list = service.listArtifacts(projectId);
    expect(list.map((a) => a.id)).toEqual([good.id]);
  });

  it("不串其它项目的 artifact", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ns-d3-list2-"));
    try {
      const p2 = registry.create({ name: "proj2", root: dir2 }).id;
      service.createArtifact(projectId, { kind: "k", title: "属 p1", content: "" });
      service.createArtifact(p2, { kind: "k", title: "属 p2", content: "" });
      expect(service.listArtifacts(projectId).map((a) => a.title)).toEqual(["属 p1"]);
      expect(service.listArtifacts(p2).map((a) => a.title)).toEqual(["属 p2"]);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
