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
import { registerFauxProvider, getApiProvider } from "@earendil-works/pi-ai";

import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
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
