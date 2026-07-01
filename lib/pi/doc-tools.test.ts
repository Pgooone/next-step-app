/**
 * V2-2 提议工具单测：直接驱动 buildDocTools 返回的三个工具的 execute（hermetic 临时后端注入，
 * 无真模型/网络），断言业务逻辑——
 *   - create_artifact → 落 v1 侧车 + 物化真实文件 + 返回 {id,filePath,version}
 *   - propose_edit → 落 PendingChange（pending JSON 存在、无新版本、真实文件未变）
 *   - 已有未决再 propose → 被拒（不新增 pending）
 *   - 空/无变化 propose → 不 save（changeId:null）
 *   - list_artifacts → 含 id 的清单
 *
 * 为何直接调 execute 而非经 faux 会话：本工具逻辑全在 execute（纯闭包 over deps），
 * 工具「能被会话激活/调起」已由 V2-0 spike（spike/v2-tools）双向实证；此处聚焦 execute 业务逻辑。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactService } from "../domain/artifact-service";
import { PendingChangeStore } from "../domain/pending-change-service";
import { ProjectRegistry } from "../domain/project-registry";
import { buildDocTools, type DocToolDeps } from "./doc-tools";

let dir: string;
let registry: ProjectRegistry;
let artifactService: ArtifactService;
let pendingStore: PendingChangeStore;
let projectId: string;
let tools: ReturnType<typeof buildDocTools>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-v2-doctools-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  artifactService = new ArtifactService(registry);
  pendingStore = new PendingChangeStore(registry, artifactService);
  const deps: DocToolDeps = {
    projectId,
    sourceActor: "需求分析师",
    artifactService,
    pendingStore,
  };
  tools = buildDocTools(deps);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 按 name 取工具（buildDocTools 返回的是裸 ToolDefinition，name/execute/description 均在顶层）。 */
function tool(name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`未找到工具 ${name}`);
  return t;
}

/** 调一个工具的 execute（补齐 5 参的占位），解析其 JSON text 结果。 */
async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  const t = tool(name);
  // execute(toolCallId, params, signal, onUpdate, ctx)；本工具不用后 3 个，传占位。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await t.execute("call-1", params as any, undefined, undefined, {} as any);
  const text = result.content.map((c: { type: string; text?: string }) => c.text ?? "").join("");
  return JSON.parse(text);
}

function pendingDir(artifactId: string): string {
  return join(dir, ".pi", "artifacts", "managed", artifactId, "pending");
}
function countPending(artifactId: string): number {
  const d = pendingDir(artifactId);
  if (!existsSync(d)) return 0;
  return readdirSync(d).filter((f) => f.endsWith(".json") && !f.includes(".tmp")).length;
}
function versionPath(artifactId: string, v: number): string {
  return join(dir, ".pi", "artifacts", "managed", artifactId, "versions", `${v}.json`);
}

describe("buildDocTools 工具集形态", () => {
  it("返回且仅返回 create_artifact / propose_edit / list_artifacts 三个工具", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["create_artifact", "list_artifacts", "propose_edit"]);
  });

  it("propose_edit 的 description 含「完整新全文」硬约束（模型唯一真读通道）", () => {
    const desc = tool("propose_edit").description;
    expect(desc).toContain("完整");
    expect(desc).toContain("逐字保留");
  });
});

describe("create_artifact", () => {
  it("落 v1 侧车 + 物化真实文件 + 返回 {id,filePath,version:1}", async () => {
    const out = (await callTool("create_artifact", {
      kind: "crd",
      title: "需求规格",
      content: "首版正文\n",
    })) as { id: string; filePath: string; version: number };

    expect(typeof out.id).toBe("string");
    expect(out.filePath).toBe("需求规格.md");
    expect(out.version).toBe(1);
    // v1 侧车
    expect(existsSync(versionPath(out.id, 1))).toBe(true);
    // 物化真实文件（projectRoot = dir）
    expect(readFileSync(join(dir, "需求规格.md"), "utf-8")).toBe("首版正文\n");
    // author = sourceActor
    const v1 = JSON.parse(readFileSync(versionPath(out.id, 1), "utf-8"));
    expect(v1.author).toBe("需求分析师");
  });

  it("空 kind/title → 返回错误文本、不抛（与 propose 错误路径对称）", async () => {
    const out = (await callTool("create_artifact", { kind: "", title: "x", content: "y" })) as {
      error?: string;
    };
    expect(typeof out.error).toBe("string");
    expect(out.error).toContain("失败");
  });
});

describe("propose_edit", () => {
  it("对已存在文档提议修改 → 落 PendingChange（pending JSON 有、无新版本、真实文件未变）", async () => {
    const a = artifactService.createArtifact(projectId, { kind: "crd", title: "改文档", content: "甲\n乙\n" });
    const realBefore = readFileSync(join(dir, "改文档.md"), "utf-8");

    const out = (await callTool("propose_edit", {
      id: a.id,
      newContent: "甲\n改过的乙\n丙\n",
    })) as { changeId: string; diffBlockCount: number; note: string };

    expect(typeof out.changeId).toBe("string");
    expect(out.diffBlockCount).toBeGreaterThan(0);
    // pending JSON 落盘
    expect(countPending(a.id)).toBe(1);
    // 不写盘：无 v2、真实文件未变（提议态不物化）
    expect(existsSync(versionPath(a.id, 2))).toBe(false);
    expect(readFileSync(join(dir, "改文档.md"), "utf-8")).toBe(realBefore);
    // 落的 change op=replace、sourceActor=注入值、含新行
    const pj = readdirSync(pendingDir(a.id)).find((f) => f.endsWith(".json"))!;
    const change = JSON.parse(readFileSync(join(pendingDir(a.id), pj), "utf-8"));
    expect(change.op).toBe("replace");
    expect(change.sourceActor).toBe("需求分析师");
    expect(change.diffBlocks.flatMap((b: { lines: string[] }) => b.lines)).toContain("丙");
  });

  it("已有未决时再 propose → 被拒、不新增 pending（D-V2-05）", async () => {
    const a = artifactService.createArtifact(projectId, { kind: "crd", title: "并发", content: "x\n" });
    // 先制造一条未决
    const first = (await callTool("propose_edit", { id: a.id, newContent: "x\ny\n" })) as {
      changeId: string;
    };
    expect(first.changeId).not.toBeNull();
    expect(countPending(a.id)).toBe(1);

    // 再提议 → 拒绝、changeId=null、pending 数不变
    const second = (await callTool("propose_edit", { id: a.id, newContent: "x\nz\n" })) as {
      changeId: string | null;
      note: string;
    };
    expect(second.changeId).toBeNull();
    expect(second.note).toContain("待确认");
    expect(countPending(a.id)).toBe(1);
  });

  it("id 不存在 → 返回错误说明文本、不抛异常炸会话（优雅处理）", async () => {
    const out = (await callTool("propose_edit", {
      id: "不存在的-id",
      newContent: "随便",
    })) as { error?: string };
    expect(typeof out.error).toBe("string");
    expect(out.error).toContain("失败");
  });

  it("内容无变化 → 不 save、changeId:null、diffBlockCount:0、无幽灵版本", async () => {
    const a = artifactService.createArtifact(projectId, { kind: "crd", title: "无变化", content: "原样\n" });
    const out = (await callTool("propose_edit", { id: a.id, newContent: "原样\n" })) as {
      changeId: string | null;
      diffBlockCount: number;
    };
    expect(out.changeId).toBeNull();
    expect(out.diffBlockCount).toBe(0);
    expect(countPending(a.id)).toBe(0);
    expect(existsSync(versionPath(a.id, 2))).toBe(false);
  });
});

describe("list_artifacts", () => {
  it("返回含 id 的清单（id/title/kind/currentVersion/filePath）", async () => {
    const a1 = artifactService.createArtifact(projectId, { kind: "crd", title: "甲文档", content: "a" });
    const a2 = artifactService.createArtifact(projectId, { kind: "prd", title: "乙文档", content: "b" });
    artifactService.submitVersion(projectId, a2.id, { content: "b2" });

    const list = (await callTool("list_artifacts", {})) as {
      id: string;
      title: string;
      kind: string;
      currentVersion: number;
      filePath?: string;
    }[];

    expect(list).toHaveLength(2);
    const byId = new Map(list.map((x) => [x.id, x]));
    expect(byId.get(a1.id)).toMatchObject({ title: "甲文档", kind: "crd", currentVersion: 1 });
    expect(byId.get(a2.id)).toMatchObject({ title: "乙文档", kind: "prd", currentVersion: 2 });
    // T6：filePath（相对项目根）随每条返回，供主脑按需 read 上游产物正文做轻读汇总。
    expect(byId.get(a1.id)?.filePath).toBe("甲文档.md");
    expect(byId.get(a2.id)?.filePath).toBe("乙文档.md");
  });

  it("空项目 → 空数组", async () => {
    const list = (await callTool("list_artifacts", {})) as unknown[];
    expect(list).toEqual([]);
  });
});
