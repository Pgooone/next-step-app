/**
 * dispatch-runner 单测：聚焦「执行超时 + abort 该会话」这条兜底路径（lead 约束 2）。
 *
 * 用 faux 起真实会话（满足 runWorker 内 createAgentSession/applyProfileRuntime），但注入一个
 * **不发 agent_end** 的 SessionHandle 桩——于是 runWorker 必然走超时分支：返回 reason="timeout"、
 * 产物为空，并向会话发过一条 "abort" 命令（释放并发槽）。
 *
 * happy-path（completed + 取产物）已在 orchestrator.test.ts 用真实 runWorker 端到端覆盖，这里不重复。
 */
import { mkdtempSync, rmSync } from "node:fs";
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
} from "@earendil-works/pi-ai";

import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
import { AgentSessionWrapper } from "../rpc-manager";
import { runWorker, type RegisterInnerSession, type SessionHandle } from "./dispatch-runner";

let dir: string;
let registry: ProjectRegistry;
let store: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-c1-runner-"));
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

function makeFaux() {
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
      { id: "faux-1", name: "faux-1", baseUrl: "http://localhost:0", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { reg, authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/** register 桩：用真实 inner.sessionId，但返回一个**不发 agent_end** 的句柄，并记录 send 命令。 */
function makeSilentRegister(): { register: RegisterInnerSession; sends: Record<string, unknown>[] } {
  const sends: Record<string, unknown>[] = [];
  const register: RegisterInnerSession = (inner: AgentSession) => {
    const session: SessionHandle = {
      onEvent: () => () => {}, // 永不触发 agent_end
      send: async (command) => {
        sends.push(command);
        return null;
      },
    };
    return { session, realSessionId: inner.sessionId };
  };
  return { register, sends };
}

function makeProfile(): AgentProfile {
  return store.create(projectId, { name: "w" });
}

describe("runWorker 执行超时兜底", () => {
  it("无 agent_end → reason=timeout、产物为空、并对会话发过 abort", async () => {
    const faux = makeFaux();
    const { register, sends } = makeSilentRegister();
    const profile = makeProfile(); // store.create 已自动写 agent.md/memory.md 骨架

    try {
      const result = await runWorker({
        projectRoot: projectRoot(),
        projectId,
        profile,
        cwd: projectRoot(),
        firstMessage: "干活",
        registerInnerSession: register,
        timeoutMs: 30, // 极短超时
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
      });

      expect(result.reason).toBe("timeout");
      expect(result.output).toBe("");
      // 发过 prompt + abort 两条命令
      expect(sends.some((c) => c.type === "prompt")).toBe(true);
      expect(sends.some((c) => c.type === "abort")).toBe(true);
    } finally {
      faux.unregister();
    }
  });

  it("abort 信号已置位 → reason=aborted、并对会话发过 abort", async () => {
    const faux = makeFaux();
    const { register, sends } = makeSilentRegister();
    const profile = makeProfile();
    const ac = new AbortController();
    ac.abort(); // 起前即取消

    try {
      const result = await runWorker({
        projectRoot: projectRoot(),
        projectId,
        profile,
        cwd: projectRoot(),
        firstMessage: "干活",
        registerInnerSession: register,
        timeoutMs: 5000,
        sessionManager: SessionManager.inMemory(),
        createOptionsOverride: {
          model: faux.model,
          authStorage: faux.authStorage,
          modelRegistry: faux.modelRegistry,
        },
        signal: ac.signal,
      });

      expect(result.reason).toBe("aborted");
      expect(sends.some((c) => c.type === "abort")).toBe(true);
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// T2：派发 worker 受限工具集（按 profile.mode 合并 dispatch doc 子集 / coding 不套受限集）
//
// 用真实 AgentSessionWrapper 提供 onEvent/send 的真实事件接线（runWorker 的 waitForTurnEnd 才能正常
// resolve），但不入进程级 globalThis registry；并捕获内核 inner 以读 getActiveToolNames()（激活集
// 由会话构造期 _refreshToolRegistry 按白名单确定）。faux 给一条 "ok" 文本让回合正常结束。
// ===========================================================================

/** 带 responses 的 faux（setResponses 必须在捕获 streamSimple 之前），让 worker 一回合正常结束。 */
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];
function makeFauxWithResponses(responses: FauxResponses) {
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
      { id: "faux-1", name: "faux-1", baseUrl: "http://localhost:0", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/** 捕获内核 inner 的 register（真实 AgentSessionWrapper 接事件流，不入进程级 registry）。 */
function makeCapturingRegister(): {
  register: RegisterInnerSession;
  captured: { inner: AgentSession | null };
} {
  const captured: { inner: AgentSession | null } = { inner: null };
  const register: RegisterInnerSession = (inner: AgentSession) => {
    captured.inner = inner;
    const wrapper = new AgentSessionWrapper(inner);
    wrapper.start();
    return { session: wrapper, realSessionId: inner.sessionId };
  };
  return { register, captured };
}

/** 起一个 dispatch worker、跑完一回合、返回捕获的内核 inner（读激活工具集）。 */
async function runAndCapture(
  profile: AgentProfile,
  faux: ReturnType<typeof makeFauxWithResponses>,
): Promise<AgentSession> {
  const { register, captured } = makeCapturingRegister();
  await runWorker({
    projectRoot: projectRoot(),
    projectId,
    profile,
    cwd: projectRoot(),
    firstMessage: "开始",
    registerInnerSession: register,
    timeoutMs: 5000,
    sessionManager: SessionManager.inMemory(),
    createOptionsOverride: {
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
    },
  });
  if (!captured.inner) throw new Error("register 未捕获到内核 inner");
  return captured.inner;
}

describe("runWorker 派发受限工具集（T2）", () => {
  it("mode=doc（默认）：工具集恰为 read/grep/find/ls/create_artifact/list_artifacts 六项，不含 propose_edit/write/edit/bash", async () => {
    const profile = store.create(projectId, { name: "派发文档员", tools: ["read"] }); // mode 默认 doc
    expect(profile.mode).toBe("doc");
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const inner = await runAndCapture(profile, faux);
      const active = inner.getActiveToolNames().slice().sort();
      expect(active).toEqual(
        ["create_artifact", "find", "grep", "list_artifacts", "ls", "read"].sort(),
      );
      for (const f of ["propose_edit", "write", "edit", "bash"]) {
        expect(active).not.toContain(f);
      }
    } finally {
      faux.unregister();
    }
  });

  it("mode=coding 且 tools 空 → 退回全套编码工具（含 bash），不套 doc 受限集（无提议工具）", async () => {
    const profile = store.create(projectId, { name: "编码空", tools: [], mode: "coding" });
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const inner = await runAndCapture(profile, faux);
      const active = inner.getActiveToolNames();
      for (const t of ["read", "bash", "edit", "write"]) expect(active).toContain(t);
      for (const t of ["create_artifact", "list_artifacts", "propose_edit"]) {
        expect(active).not.toContain(t);
      }
    } finally {
      faux.unregister();
    }
  });

  it("mode=coding 且 tools=['read'] → 工具集恰为 ['read']（不被 doc 子集污染、不退回全集）", async () => {
    const profile = store.create(projectId, { name: "编码只读", tools: ["read"], mode: "coding" });
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const inner = await runAndCapture(profile, faux);
      const active = inner.getActiveToolNames();
      expect(active).toEqual(["read"]);
      for (const t of ["bash", "create_artifact", "list_artifacts"]) {
        expect(active).not.toContain(t);
      }
    } finally {
      faux.unregister();
    }
  });

  it("泄漏对照：mode=doc + profile.tools 含 write/edit/bash → 经合并后仍被受限集覆盖剔除", async () => {
    const profile = store.create(projectId, {
      name: "想越权",
      tools: ["read", "write", "edit", "bash"],
    }); // mode 默认 doc
    const faux = makeFauxWithResponses([() => fauxAssistantMessage([fauxText("ok")])]);
    try {
      const inner = await runAndCapture(profile, faux);
      const active = inner.getActiveToolNames().slice().sort();
      expect(active).toEqual(
        ["create_artifact", "find", "grep", "list_artifacts", "ls", "read"].sort(),
      );
      for (const f of ["write", "edit", "bash", "propose_edit"]) {
        expect(active).not.toContain(f);
      }
    } finally {
      faux.unregister();
    }
  });
});
