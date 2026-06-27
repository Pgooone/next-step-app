/**
 * T1-B 承重 spike（V1.2 第七轮「流水线与阶段看板」承重墙卡）。
 *
 * 【核心命门（两半）】一个被 evictAgentSessions **真实销毁过**、且 setOwner 写过归属的 dispatch
 * worker 会话，经 resolveOrReattachSession 能走 **reattach** 分支（非 generic）、重建受限 doc 工具集
 * （**7 项含 propose_edit**、不含 write/edit/bash）。两半分属两组断言、各写一组：
 *   第一半（owner-map 存活 + 路由分流）：真 setOwner/getOwner/sessionsForAgent + 真 evict + tmpdir map；
 *     reattach/startGeneric 用 spy 替身证「哪个分支被调」（路由层职责）。
 *   第二半（reattach 真装 7 工具含 propose_edit）：真实 reattachProfileSession + 真 createAgentSession
 *     + faux 模型，断言 getActiveToolNames() 恰=DOC_SESSION_TOOLS（7）。
 *
 * 【两半勿混】reattach 用 spy 替身（第一半 B3）证路由，spy 不进 createAgentSession 读不到
 * getActiveToolNames；工具集恰等断言（B5~B7）必须落在另一处用**真实** reattachProfileSession 的子测。
 *
 * 全 hermetic：第一半用 tmpdir 的 `<cwd>/.pi/ns-session-map.json`；第二半用 tmpdir 项目 + faux 模型
 * （AuthStorage.inMemory dummy-key，无凭证可跑）。所有 tmpdir 在 afterEach rmSync 清理；不触网。
 *
 * 真实函数 file:line：
 *   resolveOrReattachSession: session-reattach.ts:97-133（分流 :115-129，DI 缝 :73-88）；
 *   getOwner/setOwner/removeOwner/sessionsForAgent: session-agent-map.ts:75/94/102/87；
 *   evictAgentSessions: evict-agent-sessions.ts:33-50；
 *   reattachProfileSession: profile-session-wiring.ts:206-296（doc mode→DOC_SESSION_TOOLS）；
 *   DOC_SESSION_TOOLS(7)/DISPATCH_DOC_SESSION_TOOLS(6): doc-session.ts:28-36 / :44-51；
 *   faux 模型: profile-session-wiring.test.ts:103-112（registerFauxProvider + AuthStorage.inMemory）。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider, getApiProvider } from "@earendil-works/pi-ai";

import { ArtifactService } from "../domain/artifact-service";
import { PendingChangeStore } from "../domain/pending-change-service";
import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
import type { AgentSessionWrapper } from "../rpc-manager";
import {
  getOwner,
  removeOwner,
  setOwner,
  sessionsForAgent,
} from "../domain/session-agent-map";
import { evictAgentSessions } from "./evict-agent-sessions";
import { resolveOrReattachSession } from "./session-reattach";
import { reattachProfileSession } from "./profile-session-wiring";
import { DOC_SESSION_TOOLS } from "./doc-session";

// ===========================================================================
// 第一半：owner-map 存活 + 路由分流（真 getOwner/setOwner/sessionsForAgent、真 evict、tmpdir map）
// ===========================================================================

describe("T1-B 第一半：evict 真销毁后 owner-map 仍在、resolve 走 reattach 分支（路由层）", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ns-t1b-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // 复用 T1-A 同形 faux worker（destroy 删 fauxMap）——生产 acquireSlot 数 Map.size、destroy 须真删。
  const fauxMap = new Map<string, AgentSessionWrapper>();
  afterEach(() => {
    fauxMap.clear();
  });
  function makeFauxWorker(sid: string) {
    let alive = true;
    const w = {
      isAlive: () => alive,
      inner: { isStreaming: false },
      send: async () => null,
      destroy: () => {
        alive = false;
        fauxMap.delete(sid);
      },
    };
    return w as unknown as AgentSessionWrapper;
  }

  it("B1：setOwner 后 getOwner 真读 tmpdir map 命中", () => {
    setOwner(root, "sid-w1", "agent-A");
    expect(getOwner(root, "sid-w1")).toBe("agent-A");
  });

  it("B2：真 evict 销毁会话后——返回 [sid]、fauxMap 删除、owner-map 仍在（坐实 evict 不碰 bySession，D-V1.2-41）", async () => {
    setOwner(root, "sid-w1", "agent-A");
    fauxMap.set("sid-w1", makeFauxWorker("sid-w1"));

    // sessionsForAgent 用**真实** import 读 tmpdir map（非桩）；getSession 读同一 fauxMap。
    const evicted = await evictAgentSessions(root, "agent-A", {
      sessionsForAgent,
      getSession: (s) => fauxMap.get(s),
    });

    expect(evicted).toEqual(["sid-w1"]); // ① 精确命中
    expect(fauxMap.get("sid-w1")).toBeUndefined(); // ② registry（fauxMap）已删
    expect(getOwner(root, "sid-w1")).toBe("agent-A"); // ③ evict 后 owner map 仍在（红线：不碰 bySession）
  });

  it("B3：正向路由——bySession 有归属且 profile 在 → 走 reattach，不走 generic（getOwner 用真实 import）", async () => {
    setOwner(root, "sid-w1", "agent-A");
    const reattach = vi.fn(async () => ({
      session: {} as AgentSessionWrapper,
      realSessionId: "r",
    }));
    const startGeneric = vi.fn(async () => ({
      session: {} as AgentSessionWrapper,
      realSessionId: "g",
    }));

    await resolveOrReattachSession("sid-w1", "/f.jsonl", root, {
      getOwner, // 真实 import，不桩
      lookupProfile: () => ({
        projectId: "p1",
        profile: { name: "doc" } as AgentProfile,
      }),
      reattach,
      startGeneric,
      registry: new Map(),
      locks: new Map(),
    });

    expect(reattach).toHaveBeenCalledTimes(1);
    expect(startGeneric).not.toHaveBeenCalled();
  });

  it("B4：负对照——removeOwner 后 bySession 无该归属 → 走 generic，不走 reattach（其余全真、仅切归属有无）", async () => {
    setOwner(root, "sid-w1", "agent-A");
    removeOwner(root, "sid-w1"); // 切除归属（对称于 B3 仅有无 bySession 该项）
    expect(getOwner(root, "sid-w1")).toBeNull();

    const reattach = vi.fn(async () => ({
      session: {} as AgentSessionWrapper,
      realSessionId: "r",
    }));
    const startGeneric = vi.fn(async () => ({
      session: {} as AgentSessionWrapper,
      realSessionId: "g",
    }));

    await resolveOrReattachSession("sid-w1", "/f.jsonl", root, {
      getOwner, // 真实 import，不桩
      lookupProfile: () => ({
        projectId: "p1",
        profile: { name: "doc" } as AgentProfile,
      }),
      reattach,
      startGeneric,
      registry: new Map(),
      locks: new Map(),
    });

    expect(startGeneric).toHaveBeenCalledTimes(1);
    expect(reattach).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 第二半：reattach 真装 7 项工具含 propose_edit（真 createAgentSession + faux 模型）
//
// 复用 profile-session-wiring.test.ts 的 helper（模块级私有、未 export，故复制进本文件）：
//   makeFaux（:103-112）/ makeFauxReattachRegister（:531-541）/ makePersistedSessionFile（:549-574）/
//   reattach 套路（:576-636）+ 项目夹具（:63-72 dir/registry/store/projectId + :74-81 projectRoot/writeDocs）。
// ===========================================================================

// ---- 项目夹具（复制自 profile-session-wiring.test.ts:63-81） ----
let dir: string;
let registry: ProjectRegistry;
let store: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-t1b-r-"));
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

// ---- faux 模型装配（复制自 profile-session-wiring.test.ts:96-125） ----
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

// ---- reattach 专用 faux 登记口（复制自 profile-session-wiring.test.ts:531-541） ----
function makeFauxReattachRegister(): {
  register: (inner: AgentSession) => { session: AgentSession; realSessionId: string };
  captured: { inner: AgentSession | null };
} {
  const captured: { inner: AgentSession | null } = { inner: null };
  const register = (inner: AgentSession) => {
    captured.inner = inner;
    return { session: inner, realSessionId: inner.sessionId };
  };
  return { register, captured };
}

/** 造已落盘的持久化会话文件（复制自 profile-session-wiring.test.ts:549-574）。 */
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

describe("T1-B 第二半：reattachProfileSession 真装 7 受限工具含 propose_edit（真 createAgentSession + faux 模型）", () => {
  let sessionDir: string;
  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "ns-t1b-sessions-"));
  });
  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  /** 用持久化 fixture 重开会话；docDepsOverride 指向本测临时后端，全 hermetic（复制自 :586-610 套路）。 */
  async function reattach(
    profile: AgentProfile,
    faux: FauxBundle,
    deps: { artifactService: ArtifactService; pendingStore: PendingChangeStore },
  ) {
    const filePath = makePersistedSessionFile(projectRoot(), sessionDir);
    const { register, captured } = makeFauxReattachRegister();
    const result = await reattachProfileSession({
      sessionId: "ignored-real-id-from-inner",
      filePath,
      projectId,
      projectRoot: projectRoot(),
      profile,
      sessionManager: SessionManager.open(filePath, undefined),
      createOptionsOverride: {
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
      },
      docDepsOverride: { artifactService: deps.artifactService, pendingStore: deps.pendingStore },
      registerInnerSession: register,
    });
    return { result, captured, filePath };
  }

  it("B5/B6/B7：reattach 后工具集恰=DOC_SESSION_TOOLS（7）、不含 write/edit/bash、含 propose_edit", async () => {
    const artifactService = new ArtifactService(registry);
    const pendingStore = new PendingChangeStore(registry, artifactService);
    // 故意含 write/edit/bash 作对抗输入；不传 mode（默认 doc，勿设 coding）。
    const profile = store.create(projectId, {
      name: "文档助手",
      tools: ["read", "write", "edit", "bash"],
    });
    writeDocs(profile, "我是 ROLE-X 角色", "");
    const faux = makeFaux();
    try {
      const { captured } = await reattach(profile, faux, { artifactService, pendingStore });
      expect(captured.inner).not.toBeNull();
      const active = captured.inner!.getActiveToolNames().slice().sort();

      // B5：恰=7 项（DOC_SESSION_TOOLS）
      expect(active).toEqual([...DOC_SESSION_TOOLS].sort());
      // B6：不含写盘/执行工具（红线②，对抗输入未泄漏）
      for (const f of ["write", "edit", "bash"]) {
        expect(active).not.toContain(f);
      }
      // B7：含 propose_edit（钉死区别于 6 项 headless dispatch 集 DISPATCH_DOC_SESSION_TOOLS）
      expect(active).toContain("propose_edit");
    } finally {
      faux.unregister();
    }
  });
});
