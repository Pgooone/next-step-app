/**
 * 第 8.6 轮 · T2（D-R8.6-10）—— orchestrator-session-wiring 的 faux 集成单测。
 *
 * 验「装总管 prompt + 派活工具 → createAgentSession →（应用 model/thinking）→ register → 发首条
 * message」整链（{@link startOrchestratorSession}）与 idle 重建（{@link reattachOrchestratorSession}，
 * 三差异：open 而非 create / 不发首条 message / 不调 applyProfileRuntime）。
 *
 * 全 hermetic：faux SessionManager / model / register（不碰进程级 globalThis registry）。断言走**行为**
 * （getActiveToolNames / systemPrompt 标记 / register.sends），非内核源码行号。
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

import {
  reattachOrchestratorSession,
  startOrchestratorSession,
} from "./orchestrator-session-wiring";

// ---------------------------------------------------------------------------
// faux 装配（Tier-2，复刻 profile-session-wiring.test.ts / orchestrator-session.test.ts）。
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
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
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
      {
        id: "faux-1",
        name: "faux-1",
        baseUrl: "http://localhost:0",
        reasoning: true,
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

/**
 * faux 版 register：不碰进程级 registry，捕获内核 inner 与 send 调用，prompt 命令接上 inner.prompt
 * （驱动 faux 流），返回带 send 的轻量包装 + 真实 sessionId（仿 profile-session-wiring.test.ts:131-156）。
 */
function makeFauxRegister(): {
  register: (inner: AgentSession) => {
    session: { send(c: Record<string, unknown>): Promise<unknown> };
    realSessionId: string;
  };
  captured: { inner: AgentSession | null; sends: Record<string, unknown>[] };
} {
  const captured: { inner: AgentSession | null; sends: Record<string, unknown>[] } = {
    inner: null,
    sends: [],
  };
  const register = (inner: AgentSession) => {
    captured.inner = inner;
    return {
      realSessionId: inner.sessionId,
      session: {
        send: async (command: Record<string, unknown>) => {
          captured.sends.push(command);
          if (command.type === "prompt") inner.prompt(command.message as string).catch(() => {});
          return null;
        },
      },
    };
  };
  return { register, captured };
}

/**
 * 造一个**已落盘**的持久化会话文件（reattach 需要可被 open 读回历史）。
 * 内核只在出现 assistant 消息时刷盘（session-manager.js:640-650）——故必须 append user + assistant。
 * （仿 profile-session-wiring.test.ts:549-574。）
 */
function makePersistedSessionFile(cwd: string, sessionDir: string): string {
  const sm = SessionManager.create(cwd, sessionDir);
  sm.appendMessage({ role: "user", content: "首轮用户消息", timestamp: Date.now() });
  sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "首轮助手回复" }],
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const file = sm.getSessionFile();
  if (!file || !existsSync(file)) {
    throw new Error("fixture 未落盘：期望 create+user+assistant 后磁盘有 jsonl 文件");
  }
  return file;
}

let cwd: string;
let sessionDir: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "ns-r86-wiring-"));
  sessionDir = mkdtempSync(join(tmpdir(), "ns-r86-wiring-sessions-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
});

// ===========================================================================
// startOrchestratorSession：装配 + register + 发首条 message
// ===========================================================================
describe("startOrchestratorSession（新建主脑会话）", () => {
  it("激活集含派活工具 submit_plan + 编码工具(bash/write/edit/read)；systemPrompt 含总管标记；首条 message 经 register.send 发出", async () => {
    const faux = makeFaux();
    const { register, captured } = makeFauxRegister();
    try {
      const { session, realSessionId } = await startOrchestratorSession({
        cwd,
        firstMessage: "帮我做个登录功能",
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });

      expect(captured.inner).not.toBeNull();
      const active = captured.inner!.getActiveToolNames();
      // 派活工具在场（命门：白名单含派活名才注册得到）。Q1：dispatch_task 已移除，只 submit_plan。
      for (const t of ["submit_plan"]) {
        expect(active).toContain(t);
      }
      // 编码工具也在场（主脑要带 bash/write/edit 自己干活，A4 同款）
      for (const t of ["bash", "write", "edit", "read"]) {
        expect(active).toContain(t);
      }
      // 总管 prompt 注入进 systemPrompt
      expect(captured.inner!.systemPrompt).toContain("总管");

      // 返回 { session, realSessionId }；首条 message 经 register.send 发出（且仅一条 prompt）
      expect(realSessionId).toBe(captured.inner!.sessionId);
      const prompts = captured.sends.filter((c) => c.type === "prompt");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({ type: "prompt", message: "帮我做个登录功能" });
      // session 即 register 返回的包装（带 send）
      expect(typeof (session as { send?: unknown }).send).toBe("function");
    } finally {
      faux.unregister();
    }
  });

  it("首条 message 带 images → 透传进 register.send 的 prompt 命令（与普通分支零回归对齐）", async () => {
    const faux = makeFaux();
    const { register, captured } = makeFauxRegister();
    const images = [{ type: "image" as const, data: "BASE64DATA", mimeType: "image/png" }];
    try {
      await startOrchestratorSession({
        cwd,
        firstMessage: "看这张图",
        images,
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });
      const prompt = captured.sends.find((c) => c.type === "prompt");
      expect(prompt).toBeDefined();
      expect(prompt!.images).toEqual(images);
    } finally {
      faux.unregister();
    }
  });

  it("不传 images → prompt 命令不含 images 键（空数组/省略均不带，与普通分支同语义）", async () => {
    const faux = makeFaux();
    const { register, captured } = makeFauxRegister();
    try {
      await startOrchestratorSession({
        cwd,
        firstMessage: "纯文字",
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });
      const prompt = captured.sends.find((c) => c.type === "prompt");
      expect(prompt).toBeDefined();
      expect("images" in prompt!).toBe(false);
    } finally {
      faux.unregister();
    }
  });

  it("预选 model 命中 registry → 在发首条 message 前切到该模型（与母版 applyProfileRuntime 同纪律）", async () => {
    const faux = makeFaux();
    const { register, captured } = makeFauxRegister();
    try {
      await startOrchestratorSession({
        cwd,
        firstMessage: "你好",
        model: { provider: "faux", modelId: "faux-1" },
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });
      expect(captured.inner!.model?.id).toBe("faux-1");
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// reattachOrchestratorSession：open 既有会话 + 重装工具 + 不发 message
// ===========================================================================
describe("reattachOrchestratorSession（idle 重建主脑会话）", () => {
  it("重建后激活集含 submit_plan（反向防 generic：generic 激活集绝无此名）+ 编码工具；systemPrompt 含总管标记；不发首条 message", async () => {
    const faux = makeFaux();
    const filePath = makePersistedSessionFile(cwd, sessionDir);
    const { register, captured } = makeFauxRegister();
    try {
      const { session, realSessionId } = await reattachOrchestratorSession({
        sessionId: "ignored-real-id-from-inner",
        filePath,
        cwd,
        projectId: null, // hermetic：绕开真实 registry 反查（本用例只验工具集，不落盘）
        sessionManager: SessionManager.open(filePath, undefined),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });

      expect(captured.inner).not.toBeNull();
      const active = captured.inner!.getActiveToolNames();
      // 反向防 generic：generic（startRpcSessionInner）激活集 allCodingToolNames 绝无 submit_plan
      expect(active).toContain("submit_plan");
      for (const t of ["bash", "write", "edit", "read"]) {
        expect(active).toContain(t);
      }
      // 总管 prompt 重注入（systemPrompt 现算覆盖、内核不持久化——只装工具不重注会丢角色）
      expect(captured.inner!.systemPrompt).toContain("总管");

      // 差异②：不发首条 message（reattach 的 jsonl 已存在、重发污染历史）
      const prompts = captured.sends.filter((c) => c.type === "prompt");
      expect(prompts).toHaveLength(0);

      expect(realSessionId).toBe(captured.inner!.sessionId);
      expect(typeof (session as { send?: unknown }).send).toBe("function");
    } finally {
      faux.unregister();
    }
  });

  it("open 既有 jsonl 保留首轮历史（buildSessionContext().messages.length>0）", async () => {
    const faux = makeFaux();
    const filePath = makePersistedSessionFile(cwd, sessionDir);
    const { register, captured } = makeFauxRegister();
    try {
      await reattachOrchestratorSession({
        sessionId: "ignored",
        filePath,
        cwd,
        projectId: null, // hermetic：绕开真实 registry 反查
        sessionManager: SessionManager.open(filePath, undefined),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        registerInnerSession: register,
      });
      const messages = captured.inner!.sessionManager.buildSessionContext().messages;
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.role === "user")).toBe(true);
      expect(messages.some((m) => m.role === "assistant")).toBe(true);
    } finally {
      faux.unregister();
    }
  });
});
