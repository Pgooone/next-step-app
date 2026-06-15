/**
 * artifact-guard faux 端到端单测：在「完整工具集」真实会话下，验证守卫对受管 artifact 的拦截。
 *
 * faux 装配复刻 agent-profile-session.test.ts / spike harness Tier2：
 *   registerFauxProvider(+setResponses 在捕获 streamSimple 之前) → getApiProvider 捕获 →
 *   ModelRegistry.inMemory().registerProvider → find，扛 createAgentSession 内部 refresh 的 resetApiProviders。
 *
 * 覆盖 D2 验收：
 * - getActiveToolNames() 含完整 7 工具，write/edit 是内核实现（C 路线，非替身）。
 * - agent 发 write 到受管路径 → 磁盘 versions 文件不变 + PendingChange 落 pending/ + sourceActor 正确 + diffBlocks 非空。
 * - agent 发 edit 到受管路径 → 同样拦截、PendingChange 落盘、diffBlocks 反映改动。
 * - agent 发 write 到非受管路径 → 正常写盘。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthStorage, ModelRegistry, createAgentSession } from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { ArtifactService } from "../domain/artifact-service";
import { PendingChangeStore, type PendingChange } from "../domain/pending-change-service";
import { ProjectRegistry } from "../domain/project-registry";
import { assembleArtifactGuardOptions } from "./artifact-guard";

let dir: string;
let registry: ProjectRegistry;
let artifactService: ArtifactService;
let pendingStore: PendingChangeStore;
let projectId: string;
let projectRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-d2-guard-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  const root = join(dir, "proj");
  mkdirSync(root, { recursive: true });
  const p = registry.create({ name: "proj", root });
  projectId = p.id;
  projectRoot = p.root;
  artifactService = new ArtifactService(registry);
  pendingStore = new PendingChangeStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// faux 装配（responses 必须在捕获 streamSimple 之前设好）
// ---------------------------------------------------------------------------
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];
function makeFaux(responses?: FauxResponses) {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
  });
  if (responses) reg.setResponses(responses);
  const liveFaux = getApiProvider("faux") as { streamSimple?: unknown; stream?: unknown };
  const capturedStreamSimple = (liveFaux.streamSimple ?? liveFaux.stream) as never;
  const authStorage = AuthStorage.inMemory({ faux: { type: "api_key", key: "dummy-key" } });
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider("faux", {
    api: "faux",
    baseUrl: "http://localhost:0",
    apiKey: "dummy-key",
    streamSimple: capturedStreamSimple,
    models: [
      {
        id: "faux-1",
        name: "faux-1",
        baseUrl: "http://localhost:0",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/** 用守卫 options + faux 起一个完整工具集会话。 */
async function startGuardedSession(faux: ReturnType<typeof makeFaux>, sourceActor: string) {
  const { options } = assembleArtifactGuardOptions({
    sourceActor,
    cwd: projectRoot,
    registry,
    artifactService,
    pendingStore,
  });
  const { session } = await createAgentSession({
    ...options,
    cwd: projectRoot,
    model: faux.model,
    authStorage: faux.authStorage,
    modelRegistry: faux.modelRegistry,
  });
  return session;
}

/** 读某 artifact 的 pending/ 目录下全部 PendingChange。 */
function readPendingChanges(artifactId: string): PendingChange[] {
  const pendingDir = join(projectRoot, ".pi", "artifacts", "managed", artifactId, "pending");
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp"))
    .map((f) => JSON.parse(readFileSync(join(pendingDir, f), "utf-8")) as PendingChange);
}

describe("assembleArtifactGuardOptions 装配", () => {
  it("getActiveToolNames 含完整 7 工具，write/edit 是内核实现（非替身）", async () => {
    const faux = makeFaux();
    try {
      const session = await startGuardedSession(faux, "agent-a");
      const active = session.getActiveToolNames();
      for (const t of ["read", "bash", "grep", "find", "ls", "write", "edit"]) {
        expect(active).toContain(t);
      }
      // C 路线保留内核 write/edit 的 label（不是替身名）
      expect(session.getToolDefinition("write")?.label).toBe("write");
      expect(session.getToolDefinition("edit")?.label).toBe("edit");
    } finally {
      faux.unregister();
    }
  });
});

describe("受管 artifact 写拦截（write）", () => {
  it("agent 发 write 到受管路径 → 磁盘版本文件不变 + PendingChange 落盘 + sourceActor + diffBlocks", async () => {
    const a = artifactService.createArtifact(projectId, {
      kind: "crd",
      title: "需求",
      content: "第一行\n第二行\n",
    });
    const target = join(projectRoot, ".pi", "artifacts", "managed", a.id, "doc.md");
    const v1Path = join(projectRoot, ".pi", "artifacts", "managed", a.id, "versions", "1.json");
    const v1Before = readFileSync(v1Path, "utf-8");

    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("写入"),
          fauxToolCall("write", { path: target, content: "第一行\n改过的第二行\n第三行\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startGuardedSession(faux, "需求分析师");
      await session.prompt("更新文档");

      // 磁盘：目标文件未写、版本文件未变、未新增版本
      expect(existsSync(target)).toBe(false);
      expect(readFileSync(v1Path, "utf-8")).toBe(v1Before);
      expect(existsSync(join(projectRoot, ".pi", "artifacts", "managed", a.id, "versions", "2.json"))).toBe(false);

      // PendingChange 落盘
      const changes = readPendingChanges(a.id);
      expect(changes).toHaveLength(1);
      const pc = changes[0];
      expect(pc.op).toBe("replace");
      expect(pc.sourceActor).toBe("需求分析师");
      expect(pc.artifactId).toBe(a.id);
      expect(pc.diffBlocks.length).toBeGreaterThan(0);
      // diff 应包含「改过的第二行」与「第三行」
      const allLines = pc.diffBlocks.flatMap((b) => b.lines);
      expect(allLines).toContain("第三行");
    } finally {
      faux.unregister();
    }
  });
});

describe("受管 artifact 写拦截（edit）", () => {
  it("agent 发 edit 到受管路径 → 拦截 + PendingChange 落盘 + diffBlocks 反映改动（内核算 diff）", async () => {
    const a = artifactService.createArtifact(projectId, {
      kind: "prd",
      title: "PRD",
      content: "alpha\nOLD\nbeta\n",
    });
    const target = join(projectRoot, ".pi", "artifacts", "managed", a.id, "doc.md");

    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("编辑"),
          fauxToolCall("edit", { path: target, edits: [{ oldText: "OLD", newText: "NEW" }] }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startGuardedSession(faux, "编辑助手");
      await session.prompt("改一行");

      expect(existsSync(target)).toBe(false);
      const changes = readPendingChanges(a.id);
      expect(changes).toHaveLength(1);
      const pc = changes[0];
      expect(pc.sourceActor).toBe("编辑助手");
      expect(pc.diffBlocks.length).toBeGreaterThan(0);
      // 内核把 OLD→NEW 应用后切块：应有一个含 NEW 的块
      const allLines = pc.diffBlocks.flatMap((b) => b.lines);
      expect(allLines).toContain("NEW");
    } finally {
      faux.unregister();
    }
  });
});

describe("非受管路径放行（write）", () => {
  it("agent 发 write 到项目内普通文件 → 正常写盘、不产 PendingChange", async () => {
    const normal = join(projectRoot, "note.txt");
    const faux = makeFaux([
      () => fauxAssistantMessage([fauxText("写"), fauxToolCall("write", { path: normal, content: "普通文件内容\n" })]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startGuardedSession(faux, "agent-a");
      await session.prompt("写普通文件");
      expect(existsSync(normal)).toBe(true);
      expect(readFileSync(normal, "utf-8")).toBe("普通文件内容\n");
    } finally {
      faux.unregister();
    }
  });
});
