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

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider, getApiProvider } from "@earendil-works/pi-ai";

import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
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
