/**
 * B4 —— startProfileSession 组合逻辑的 faux 集成单测。
 *
 * 复用 agent-profile-session.test.ts 的 faux 装配（Tier 2：registerFauxProvider →
 * 捕获 streamSimple → inMemory registry），用 faux SessionManager / model 起会话，
 * 验证「装配注入 → createAgentSession → applyProfileRuntime → registerInnerSession →
 * 发首条 message」整链：
 *   - 返回真实 sessionId（pi 生成）与诊断；
 *   - 注入块进了 systemPrompt（AC②）；
 *   - 档案 model 命中则切换、查不到则 modelFallback=true（AC③）；
 *   - registerInnerSession 收到内核 inner、首条 message 经其 send 发出（D-B4-3 顺序）。
 *
 * registerInnerSession 用 faux 注入（不碰进程级 globalThis registry），与 rpc-manager
 * 的真实实现的契约单测分开（见 lib/rpc-manager.test.ts）。
 */

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { ArtifactService } from "../domain/artifact-service";
import { PendingChangeStore, type PendingChange } from "../domain/pending-change-service";
import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
import { DOC_SESSION_TOOLS } from "./doc-session";
import { startProfileSession, type RegisterInnerSession } from "./profile-session-wiring";

// ---------------------------------------------------------------------------
// 夹具：临时项目 + 档案存储（同 agent-profile-session.test.ts）
// ---------------------------------------------------------------------------
let dir: string;
let registry: ProjectRegistry;
let store: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-b4-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function projectRoot(): string {
  return registry.get(projectId).root;
}

function writeDocs(profile: AgentProfile, agentMd: string, memoryMd: string): void {
  writeFileSync(join(projectRoot(), profile.agentMdPath), agentMd, "utf-8");
  writeFileSync(join(projectRoot(), profile.memoryPath), memoryMd, "utf-8");
}

function makeSkillDir(skillNames: string[]): string {
  const skillsRoot = mkdtempSync(join(tmpdir(), "ns-b4-skills-"));
  for (const name of skillNames) {
    const d = join(skillsRoot, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `---\nname: ${name}\ndescription: skill ${name}\n---\n\n# ${name}\n`, "utf-8");
  }
  return skillsRoot;
}

// ---------------------------------------------------------------------------
// faux 装配：复刻 B2 harness Tier 2
// ---------------------------------------------------------------------------
type FauxBundle = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: NonNullable<ReturnType<ModelRegistry["find"]>>;
  unregister: () => void;
};

function makeFaux(): FauxBundle {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux Test Model", contextWindow: 128000, maxTokens: 16384 }],
  });
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
      { id: "faux-1", name: "faux-1", baseUrl: "http://localhost:0", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
      { id: "faux-2", name: "faux-2", baseUrl: "http://localhost:0", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/**
 * faux 版 registerInnerSession：不碰进程级 registry，捕获内核 inner 与 send 调用，
 * 真的把 inner.prompt 接上（驱动 faux 流），返回带 send 的轻量包装 + 真实 sessionId。
 */
function makeFauxRegister(): {
  register: RegisterInnerSession;
  captured: { inner: AgentSession | null; sends: Record<string, unknown>[] };
} {
  const captured: { inner: AgentSession | null; sends: Record<string, unknown>[] } = {
    inner: null,
    sends: [],
  };
  const register: RegisterInnerSession = (inner) => {
    captured.inner = inner;
    return {
      realSessionId: inner.sessionId,
      session: {
        send: async (command) => {
          captured.sends.push(command);
          // 复刻 rpc-manager wrapper：prompt 命令 fire-and-forget 转 inner.prompt
          if (command.type === "prompt") {
            inner.prompt(command.message as string).catch(() => {});
          }
          return null;
        },
      },
    };
  };
  return { register, captured };
}

/** 用档案起会话（注入 faux SessionManager / model）；返回结果 + 捕获的 register 上下文。 */
async function start(profile: AgentProfile, faux: FauxBundle, extra?: { additionalSkillPaths?: string[] }) {
  const { register, captured } = makeFauxRegister();
  const result = await startProfileSession({
    projectId,
    projectRoot: projectRoot(),
    profile,
    cwd: projectRoot(),
    firstMessage: "你好，开始干活",
    registerInnerSession: register,
    additionalSkillPaths: extra?.additionalSkillPaths,
    sessionManager: SessionManager.inMemory(),
    createOptionsOverride: {
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
    },
  });
  return { result, captured };
}

// ---------------------------------------------------------------------------
// 组合整链
// ---------------------------------------------------------------------------
describe("startProfileSession 组合整链", () => {
  it("返回真实 sessionId；注入块进 systemPrompt；首条 message 经 register.send 发出（D-B4-3 顺序）", async () => {
    const profile = store.create(projectId, { name: "coder" });
    writeDocs(profile, "我是 ROLE-X 角色", "记住 MEM-Y 这条");

    const faux = makeFaux();
    try {
      const { result, captured } = await start(profile, faux);

      // 真实 sessionId == 内核 inner.sessionId
      expect(captured.inner).not.toBeNull();
      expect(result.sessionId).toBe(captured.inner!.sessionId);

      // 注入块进了 systemPrompt（AC②，与 B2 一致）
      const sp = captured.inner!.systemPrompt;
      expect(sp).toContain("ROLE-X");
      expect(sp).toContain("MEM-Y");
      expect(sp).toContain("<agent_profile>");

      // register 在发首条 message 之前调用（先接事件流再发）→ 捕获到恰一条 prompt
      expect(captured.sends).toHaveLength(1);
      expect(captured.sends[0]).toMatchObject({ type: "prompt", message: "你好，开始干活" });
    } finally {
      faux.unregister();
    }
  });

  it("档案 model 命中 registry → modelFallback=false 且会话切到该模型（AC③）", async () => {
    const profile = store.create(projectId, { name: "coder", model: "faux/faux-2" });

    const faux = makeFaux();
    try {
      const { result, captured } = await start(profile, faux);
      expect(result.diagnostics.modelFallback).toBe(false);
      expect(captured.inner!.model?.id).toBe("faux-2");
    } finally {
      faux.unregister();
    }
  });

  it("档案 model 查不到 → modelFallback=true 且仍是默认 faux-1（不抛，AC③）", async () => {
    const profile = store.create(projectId, { name: "coder", model: "anthropic/does-not-exist" });

    const faux = makeFaux();
    try {
      const { result, captured } = await start(profile, faux);
      expect(result.diagnostics.modelFallback).toBe(true);
      expect(captured.inner!.model?.id).toBe("faux-1");
    } finally {
      faux.unregister();
    }
  });

  it("档案声明缺失技能 → 不抛、diagnostics.missingSkills 含该技能（AC②）", async () => {
    const skillsRoot = makeSkillDir(["alpha"]); // 只有 alpha
    const profile = store.create(projectId, { name: "coder", skills: ["ghost"], tools: ["read"] });

    const faux = makeFaux();
    try {
      const { result } = await start(profile, faux, { additionalSkillPaths: [skillsRoot] });
      expect(result.diagnostics.missingSkills).toContain("ghost");
    } finally {
      faux.unregister();
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("编辑 agent.md 后再次起会话 → 新会话 systemPrompt 反映新内容（AC④，每次重读无缓存）", async () => {
    const profile = store.create(projectId, { name: "coder" });
    writeDocs(profile, "旧角色 OLD-ROLE", "");

    const faux = makeFaux();
    try {
      const first = await start(profile, faux);
      expect(first.captured.inner!.systemPrompt).toContain("OLD-ROLE");

      writeDocs(profile, "新角色 NEW-ROLE", "");

      const second = await start(profile, faux);
      expect(second.captured.inner!.systemPrompt).toContain("NEW-ROLE");
      expect(second.captured.inner!.systemPrompt).not.toContain("OLD-ROLE");
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// V2：profile 会话装「受限工具集」（替代 P0 的 artifact-guard）
//
// 复用上方 B4 fixture（registry/store/projectId，registry 指向临时 projects.json），
// 叠加「setResponses 必须在捕获 streamSimple 之前」的 faux 范式（见下方 makeFauxWithResponses）。
//
// 关键：提议工具默认会 `new ProjectRegistry()`（读默认 ~/.pi/projects.json），hermetic 测试里
// 看不到本测临时项目，故经 startProfileSession 的 docDepsOverride 注入指向同一临时 registry 的
// ArtifactService/PendingChangeStore（生产省略 → 提议工具用默认文件后端，wiring 不变）。
// ===========================================================================

/** 起会话即随首条 message 把 tool-call 跑完——故 send 直接 await inner.prompt（生产是 fire-and-forget）。 */
function makeAwaitingRegister(): {
  register: RegisterInnerSession;
  captured: { inner: AgentSession | null };
} {
  const captured: { inner: AgentSession | null } = { inner: null };
  const register: RegisterInnerSession = (inner) => {
    captured.inner = inner;
    return {
      realSessionId: inner.sessionId,
      session: {
        // await 让 startProfileSession 的 `await session.send(...)` 阻塞到工具回合结束，
        // 测试在 startProfileSession resolve 后即可断言 PendingChange / 磁盘状态。
        send: async (command) =>
          command.type === "prompt" ? inner.prompt(command.message as string) : null,
      },
    };
  };
  return { register, captured };
}

/** 带 responses 的 faux 装配：setResponses 必须在捕获 streamSimple 之前。 */
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];
function makeFauxWithResponses(responses: FauxResponses): FauxBundle {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
  });
  reg.setResponses(responses);
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

/** 读某 artifact 的 pending/ 目录下全部 PendingChange。 */
function readPendingChanges(artifactId: string): PendingChange[] {
  const pendingDir = join(projectRoot(), ".pi", "artifacts", "managed", artifactId, "pending");
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp"))
    .map((f) => JSON.parse(readFileSync(join(pendingDir, f), "utf-8")) as PendingChange);
}

describe("startProfileSession 装受限工具集（V2 doc-session）", () => {
  /** 起会话并把 docDepsOverride 指向本测临时后端；返回捕获的 inner。 */
  async function startDoc(
    profile: AgentProfile,
    faux: FauxBundle,
    deps: { artifactService: ArtifactService; pendingStore: PendingChangeStore },
    firstMessage = "开始",
  ) {
    const { register, captured } = makeAwaitingRegister();
    await startProfileSession({
      projectId,
      projectRoot: projectRoot(),
      profile,
      cwd: projectRoot(),
      firstMessage,
      registerInnerSession: register,
      sessionManager: SessionManager.inMemory(),
      createOptionsOverride: {
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
      },
      docDepsOverride: { artifactService: deps.artifactService, pendingStore: deps.pendingStore },
    });
    return captured;
  }

  it("会话工具集为受限集：含且仅含 7 名（read/grep/find/ls + 3 提议工具）、不含 write/edit/bash", async () => {
    const artifactService = new ArtifactService(registry);
    const pendingStore = new PendingChangeStore(registry, artifactService);
    const profile = store.create(projectId, { name: "文档助手", tools: ["read"] });
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const captured = await startDoc(profile, faux, { artifactService, pendingStore });
      const active = captured.inner!.getActiveToolNames().slice().sort();
      expect(active).toEqual([...DOC_SESSION_TOOLS].sort());
      for (const f of ["write", "edit", "bash"]) {
        expect(active).not.toContain(f);
      }
    } finally {
      faux.unregister();
    }
  });

  it("泄漏对照：profile.tools 含 write/edit/bash → 经装配后仍被受限集覆盖掉（docOptions 覆盖 profile.tools，D-V2-04/major4）", async () => {
    const artifactService = new ArtifactService(registry);
    const pendingStore = new PendingChangeStore(registry, artifactService);
    // 故意给一个「想要写盘工具」的档案——验证受限白名单把它覆盖掉、危险工具不泄漏。
    const profile = store.create(projectId, {
      name: "想越权的 agent",
      tools: ["read", "write", "edit", "bash"],
    });
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const captured = await startDoc(profile, faux, { artifactService, pendingStore });
      const active = captured.inner!.getActiveToolNames();
      // 受限集生效：active 恰为 7 受限名，profile.tools 的 write/edit/bash 未泄漏
      expect(active.slice().sort()).toEqual([...DOC_SESSION_TOOLS].sort());
      for (const f of ["write", "edit", "bash"]) {
        expect(active).not.toContain(f);
      }
    } finally {
      faux.unregister();
    }
  });

  it("闭环：agent 调 create_artifact → 落 v1 + 物化真实文件（author=profile.name）", async () => {
    const artifactService = new ArtifactService(registry);
    const pendingStore = new PendingChangeStore(registry, artifactService);
    const profile = store.create(projectId, { name: "需求分析师", tools: ["read"] });
    const faux = makeFauxWithResponses([
      () =>
        fauxAssistantMessage([
          fauxText("新建文档"),
          fauxToolCall("create_artifact", { kind: "crd", title: "需求规格", content: "首版正文\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      await startDoc(profile, faux, { artifactService, pendingStore }, "建个需求文档");
      const list = artifactService.listArtifacts(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("需求规格");
      // 物化真实文件 + v1 内容正确 + author = profile.name
      expect(existsSync(join(projectRoot(), "需求规格.md"))).toBe(true);
      expect(artifactService.readCurrentContent(projectId, list[0].id)).toBe("首版正文\n");
      const v1 = artifactService.getVersion(projectId, list[0].id, 1);
      expect(v1.author).toBe("需求分析师");
    } finally {
      faux.unregister();
    }
  });

  it("闭环：agent 调 propose_edit → 落 PendingChange（不写盘、无新版本、sourceActor=profile.name）", async () => {
    const artifactService = new ArtifactService(registry);
    const pendingStore = new PendingChangeStore(registry, artifactService);
    // 先建一份已存在文档（拿到已知 id 供 propose）
    const a = artifactService.createArtifact(projectId, { kind: "crd", title: "改我", content: "甲\n乙\n" });
    const realBefore = readFileSync(join(projectRoot(), a.filePath!), "utf-8");
    const profile = store.create(projectId, { name: "编辑助手", tools: ["read"] });
    const faux = makeFauxWithResponses([
      () =>
        fauxAssistantMessage([
          fauxText("提议修改"),
          fauxToolCall("propose_edit", { id: a.id, newContent: "甲\n改过的乙\n丙\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      await startDoc(profile, faux, { artifactService, pendingStore }, "改这份文档");
      // 落 PendingChange，不写盘（真实文件未变）、无新版本
      const changes = readPendingChanges(a.id);
      expect(changes).toHaveLength(1);
      const pc = changes[0];
      expect(pc.op).toBe("replace");
      expect(pc.sourceActor).toBe("编辑助手");
      expect(pc.diffBlocks.flatMap((b) => b.lines)).toContain("丙");
      expect(readFileSync(join(projectRoot(), a.filePath!), "utf-8")).toBe(realBefore);
      expect(
        existsSync(join(projectRoot(), ".pi", "artifacts", "managed", a.id, "versions", "2.json")),
      ).toBe(false);
    } finally {
      faux.unregister();
    }
  });
});
