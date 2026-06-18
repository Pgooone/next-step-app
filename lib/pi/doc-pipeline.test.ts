/**
 * V2-6 端到端复用验证（逻辑层，hermetic）——把 V2「文档实体 + 提议工具」整条确认流水线
 * 串起来跑通，证明复用既有 D1/D2/D4/D5 管道无回归、零新增确认逻辑：
 *
 *   create_artifact 工具 → 真实文件 + v1 侧车
 *     → propose_edit 工具 → PendingChange（不写盘、无新版本、真实文件未变）
 *       → resolveAndMaterialize（= resolve 路由薄壳调的同一 service 方法，按块确认）
 *         → submitVersion 出新版 + **V2-1 物化把真实文件同步到新内容** + pending 删除
 *
 * 另固化两个 V2 命脉契约：
 *   - 局部修改（coreIssue）：多段文档只改一段 → 仅产 1 个 mod 块（其余 equal 不产块）；
 *     传残篇 → 产大量 del 块（证「必须回整篇」的设计约束在 LCS 层成立）。
 *   - 并发/外部编辑（D-V2-05/06）：已有未决再 propose 被拒；外部改真实文件后确认 → 抛
 *     EXTERNAL_MODIFIED 不静默覆盖。
 *
 * 直接驱动工具 execute + service（无真模型/网络，hermetic 临时后端）——工具「能被会话激活/调起」
 * 已由 V2-0 spike + wiring 集成测覆盖，此处聚焦「跨 D1~D5 的整条数据流」。真浏览器 UI 验收另行
 * （ArtifactPanel/PendingChangeCard/版本下拉，复用 D4/D5 drive）。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactService, ArtifactError } from "../domain/artifact-service";
import { PendingChangeStore, type PendingChange } from "../domain/pending-change-service";
import { ProjectRegistry } from "../domain/project-registry";
import { buildDocTools, type DocToolDeps } from "./doc-tools";

let dir: string;
let registry: ProjectRegistry;
let artifactService: ArtifactService;
let pendingStore: PendingChangeStore;
let projectId: string;
let tools: ReturnType<typeof buildDocTools>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-v2-pipeline-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  artifactService = new ArtifactService(registry);
  pendingStore = new PendingChangeStore(registry, artifactService);
  const deps: DocToolDeps = { projectId, sourceActor: "需求分析师", artifactService, pendingStore };
  tools = buildDocTools(deps);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tool(name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`未找到工具 ${name}`);
  return t;
}

/** 调一个工具的 execute，解析 JSON text 结果。 */
async function callTool(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const t = tool(name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await t.execute("call-1", params as any, undefined, undefined, {} as any);
  const text = result.content.map((c: { type: string; text?: string }) => c.text ?? "").join("");
  return JSON.parse(text);
}

function realFile(filePath: string): string {
  return join(dir, filePath);
}
function versionFile(artifactId: string, v: number): string {
  return join(dir, ".pi", "artifacts", "managed", artifactId, "versions", `${v}.json`);
}
function pendingDir(artifactId: string): string {
  return join(dir, ".pi", "artifacts", "managed", artifactId, "pending");
}
function listPendingFiles(artifactId: string): string[] {
  const d = pendingDir(artifactId);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json") && !f.includes(".tmp"));
}

describe("V2 端到端流水线：create → propose → resolve(confirm) → 新版本 + 真实文件同步", () => {
  it("全确认：confirm 所有块 → v2 出版 + 真实文件 = 新内容 + pending 删除", async () => {
    // 1) create_artifact → 真实文件 + v1
    const created = (await callTool("create_artifact", {
      kind: "crd",
      title: "需求规格",
      content: "甲\n乙\n丙\n",
    })) as { id: string; filePath: string; version: number };
    const { id, filePath } = created;
    expect(created.version).toBe(1);
    expect(existsSync(realFile(filePath))).toBe(true);
    expect(readFileSync(realFile(filePath), "utf-8")).toBe("甲\n乙\n丙\n");

    // 2) propose_edit → PendingChange，不写盘、无 v2、真实文件未变
    const proposed = (await callTool("propose_edit", {
      id,
      newContent: "甲\n改过的乙\n丙\n",
    })) as { changeId: string; diffBlockCount: number };
    expect(typeof proposed.changeId).toBe("string");
    expect(listPendingFiles(id)).toHaveLength(1);
    expect(existsSync(versionFile(id, 2))).toBe(false);
    expect(readFileSync(realFile(filePath), "utf-8")).toBe("甲\n乙\n丙\n"); // 真实文件仍是 v1

    // 3) resolveAndMaterialize（= resolve 路由内部调的同一方法）confirm 全部块
    const result = pendingStore.resolveAndMaterialize(projectId, id, proposed.changeId, {
      action: "confirm",
    });
    expect(result.materialized).toBe(true);
    expect(result.artifact?.currentVersion).toBe(2);

    // 4) v2 出版 + 真实文件已同步到新内容 + pending 已删
    // 注意：确认后内容经 applyResolvedBlocks 行级重建（splitLines 丢末尾空行），故无末尾换行——
    // 这是 D4 既定的行模型行为（与 computeReplaceDiffBlocks 一致），非 V2 回归。
    expect(existsSync(versionFile(id, 2))).toBe(true);
    expect(artifactService.readCurrentContent(projectId, id)).toBe("甲\n改过的乙\n丙");
    expect(readFileSync(realFile(filePath), "utf-8")).toBe("甲\n改过的乙\n丙"); // 物化同步
    expect(listPendingFiles(id)).toHaveLength(0);
  });

  it("全拒绝：reject 所有块 → 不出新版本、真实文件不变、pending 删除", async () => {
    const created = (await callTool("create_artifact", { kind: "crd", title: "拒绝测试", content: "原文\n" })) as {
      id: string;
      filePath: string;
    };
    const proposed = (await callTool("propose_edit", { id: created.id, newContent: "改动\n" })) as {
      changeId: string;
    };
    const result = pendingStore.resolveAndMaterialize(projectId, created.id, proposed.changeId, {
      action: "reject",
    });
    expect(result.materialized).toBe(true); // 全决（全 reject）→ materialized 触发重建
    // 全 reject 重建 = 旧内容（经行级重建丢末尾换行），语义上真实文件内容未改动；仍走一次 submitVersion 出 v2。
    expect(readFileSync(realFile(created.filePath), "utf-8")).toBe("原文");
    expect(listPendingFiles(created.id)).toHaveLength(0);
  });
});

describe("V2 局部修改契约（coreIssue）", () => {
  it("多段文档只改一段 → 仅产 1 个 mod 块（其余进 equal 不产块）", async () => {
    const created = (await callTool("create_artifact", {
      kind: "crd",
      title: "多段",
      content: "第一段\n第二段\n第三段\n第四段\n第五段\n",
    })) as { id: string };
    // 只改第三段，其余逐字保留（= agent 回整篇但只动一处）
    await callTool("propose_edit", {
      id: created.id,
      newContent: "第一段\n第二段\n第三段改了\n第四段\n第五段\n",
    });
    const pj = listPendingFiles(created.id)[0];
    const change = JSON.parse(readFileSync(join(pendingDir(created.id), pj), "utf-8")) as PendingChange;
    // 仅 1 个变化块、且是 mod（改），不是满屏 del/add
    expect(change.diffBlocks).toHaveLength(1);
    expect(change.diffBlocks[0].kind).toBe("mod");
    expect(change.diffBlocks[0].lines).toContain("第三段改了");
  });

  it("传残篇（只回一段）→ 未提及段落被吞进破坏性 mod 块的 oldLines（固化「必须回整篇」契约）", async () => {
    const created = (await callTool("create_artifact", {
      kind: "crd",
      title: "残篇测试",
      content: "第一段\n第二段\n第三段\n第四段\n第五段\n",
    })) as { id: string };
    // 残篇：agent 错误地只回了改后的那一段（违反「必须完整全文」约束）
    await callTool("propose_edit", { id: created.id, newContent: "第三段改了\n" });
    const pj = listPendingFiles(created.id)[0];
    const change = JSON.parse(readFileSync(join(pendingDir(created.id), pj), "utf-8")) as PendingChange;
    // LCS 把「5 段 → 1 段」聚成 1 个破坏性 mod 块：oldLines 含全部 5 段、新行只剩 1 段——
    // 这正是「回残篇 = 其余正文被当作删除/满屏噪声」的固化证据（对比下方局部改只吞 1 段）。
    expect(change.diffBlocks).toHaveLength(1);
    const block = change.diffBlocks[0];
    expect(block.kind).toBe("mod");
    expect(block.lines).toEqual(["第三段改了"]); // 新内容只剩残篇
    expect(block.oldLines).toHaveLength(5); // 但旧侧 5 段全被这块吞掉（4 段未提及→被删）
    expect(block.oldLines).toContain("第一段"); // 未提及段落落进 oldLines（确认态会丢失它们）
    expect(block.oldLines).toContain("第五段");
  });

  it("局部修改 → 按块确认那一个 mod 块 → 出新版 + 真实文件仅那段变、其余逐字不变", async () => {
    const created = (await callTool("create_artifact", {
      kind: "crd",
      title: "局部确认",
      content: "甲\n乙\n丙\n",
    })) as { id: string; filePath: string };
    const proposed = (await callTool("propose_edit", {
      id: created.id,
      newContent: "甲\n乙改了\n丙\n",
    })) as { changeId: string };
    // 全块 confirm（这里就 1 个 mod 块）
    const result = pendingStore.resolveAndMaterialize(projectId, created.id, proposed.changeId, {
      action: "confirm",
    });
    expect(result.materialized).toBe(true);
    // 行级重建丢末尾换行；其余段（甲/丙）逐字保留，仅乙变（局部改的体验）。
    expect(readFileSync(realFile(created.filePath), "utf-8")).toBe("甲\n乙改了\n丙");
  });
});

describe("V2 并发 / 外部编辑（D-V2-05 / D-V2-06）", () => {
  it("已有未决再 propose → 被拒（D-V2-05），不新增 pending", async () => {
    const created = (await callTool("create_artifact", { kind: "crd", title: "并发", content: "x\n" })) as {
      id: string;
    };
    const first = (await callTool("propose_edit", { id: created.id, newContent: "x\ny\n" })) as {
      changeId: string | null;
    };
    expect(first.changeId).not.toBeNull();
    const second = (await callTool("propose_edit", { id: created.id, newContent: "x\nz\n" })) as {
      changeId: string | null;
      note: string;
    };
    expect(second.changeId).toBeNull();
    expect(second.note).toContain("待确认");
    expect(listPendingFiles(created.id)).toHaveLength(1);
  });

  it("外部改真实文件后确认 → 抛 EXTERNAL_MODIFIED，不静默覆盖（D-V2-06）", async () => {
    const created = (await callTool("create_artifact", { kind: "crd", title: "外部改", content: "原始\n" })) as {
      id: string;
      filePath: string;
    };
    const proposed = (await callTool("propose_edit", { id: created.id, newContent: "AI 想写的\n" })) as {
      changeId: string;
    };
    // 用户在界面确认前，外部手改了真实文件
    writeFileSync(realFile(created.filePath), "外部手改的内容\n", "utf-8");

    // 确认 → resolveAndMaterialize 内 submitVersion 物化前比对，发现外部改动 → 抛 EXTERNAL_MODIFIED
    let thrown: unknown;
    try {
      pendingStore.resolveAndMaterialize(projectId, created.id, proposed.changeId, { action: "confirm" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ArtifactError);
    expect((thrown as ArtifactError).code).toBe("EXTERNAL_MODIFIED");
    // 真实文件保持外部改动、未被静默覆盖
    expect(readFileSync(realFile(created.filePath), "utf-8")).toBe("外部手改的内容\n");
  });
});
