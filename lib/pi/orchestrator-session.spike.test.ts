/**
 * spike-1 命门验证（第 8.6 轮 · 详细设计 §1）——「给主会话装『总管 resourceLoader 注入 +
 * 派活 customTools』可行吗」。5 断言 A1~A5（全绿 = GO）：
 *
 *   A1（P3）总管注入块进系统提示、且 setActiveToolsByName 触发 rebuild 后仍在（D-24 唯一证伪点）。
 *   A2（P2 命门·正）faux 产 submit_plan 工具调用 → execute 闭包 calls[] 真被命中（行为侧、非静态在场）。
 *   A3（P2 命门·负对照）同 faux 同调用、仅白名单去掉 submit_plan → 激活集/注册表/calls 三件全空
 *        （坐实「漏名静默失效」、证 A2 非 vacuous）。
 *   A4（P4）装配后激活集同时含编码工具(bash/write/edit) + 派活工具，且裸起会话未被判 doc。
 *   A5（P1）装配函数独立、不 import rpc-manager（源码 grep 证 greenfield）。
 *
 * faux 范式照搬母版：dispatch-runner.test.ts:176-199（makeFauxWithResponses）+
 * agent-profile-session.test.ts:83-131（Tier-2 registerProvider，扛 createAgentSession 内部 refresh）。
 * 起会话/驱动回合用真实 AgentSessionWrapper（接事件流），不入进程级 globalThis registry。
 *
 * 断言走**行为**（getActiveToolNames / getToolDefinition / execute 命中）非内核源码行号（本机 0.79.10、会漂）。
 *
 * spike 后此文件保留：命门事实迁详细设计 + 永久回归迁正式单测（仿第八轮 evict-session.spike）。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { AgentSessionWrapper } from "../rpc-manager";
import { CODING_TOOL_NAMES } from "./coding-tools";
import {
  assembleOrchestratorSessionOptions,
  buildMastermindTools,
  buildOrchestratorResourceLoader,
  type MastermindToolCall,
} from "./orchestrator-session";

// ---------------------------------------------------------------------------
// faux 装配：Tier-2（registerProvider），扛 createAgentSession 内部 ModelRegistry.refresh()。
// setResponses 必须在捕获 streamSimple 之前（母版 makeFauxWithResponses 同序）。
// reasoning:true 否则 thinkingLevel 被夹 off（agent-profile-session.test.ts:107-109 坑）。
// ---------------------------------------------------------------------------
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];

// DefaultResourceLoader 的 cwd 必填（normalizePath 对 undefined 崩，B2 母版亦总传 cwd）。
// 用每用例临时目录作 hermetic cwd（无 .pi 内容 → 仅基座 + 我们的注入块）。
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-r86-spike-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

/** 起一个真实主脑会话（带总管注入 loader + 给定白名单/customTools）+ faux 模型。返回内核 inner。 */
async function startOrchestratorSession(args: {
  injectionBlock: string;
  tools: string[];
  customTools: ReturnType<typeof buildMastermindTools>;
  faux: ReturnType<typeof makeFaux>;
}): Promise<{ inner: AgentSession }> {
  const loader = await buildOrchestratorResourceLoader(args.injectionBlock, { cwd: dir });
  const { session } = await createAgentSession({
    agentDir: getAgentDir(),
    sessionManager: SessionManager.inMemory(),
    resourceLoader: loader,
    tools: args.tools,
    customTools: args.customTools,
    model: args.faux.model,
    authStorage: args.faux.authStorage,
    modelRegistry: args.faux.modelRegistry,
  });
  return { inner: session };
}

/** 用真实 AgentSessionWrapper 接事件流、send 一条 prompt、等 agent_end && !willRetry（带超时兜底）。 */
async function driveOneTurn(inner: AgentSession, message: string, timeoutMs = 5000): Promise<void> {
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  // 先挂监听再 send，否则首条 prompt 的事件错过（母版 dispatch-runner 同纪律）。
  const ended = new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    const off = wrapper.onEvent((event: { type: string; willRetry?: boolean }) => {
      if (event.type === "agent_end" && event.willRetry === false) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
  await wrapper.send({ type: "prompt", message });
  await ended;
  wrapper.destroy();
}

// ===========================================================================
// A1（P3）总管注入不被 rebuild 覆盖
// ===========================================================================
describe("A1（P3）总管 prompt 注入进系统提示、扛 setActiveToolsByName rebuild", () => {
  it("起会话后 systemPrompt 含注入标记；setActiveToolsByName 后仍含（D-24 证伪点）", async () => {
    const marker = "<<<MM_INJECT_" + Math.random().toString(36).slice(2) + ">>>";
    const injectionBlock = marker + "\n你是总管：大任务才拆活派人、小事直接答。";
    const faux = makeFaux();
    try {
      const calls: MastermindToolCall[] = [];
      const tools = buildMastermindTools(calls);
      const opts = assembleOrchestratorSessionOptions({
        resourceLoader: await buildOrchestratorResourceLoader(injectionBlock, { cwd: dir }),
        mastermindTools: tools,
      });
      const { session } = await createAgentSession({
        agentDir: getAgentDir(),
        sessionManager: SessionManager.inMemory(),
        resourceLoader: opts.resourceLoader,
        tools: opts.tools,
        customTools: opts.customTools,
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
      });

      // ① 建会话后注入块在
      expect(session.systemPrompt).toContain(marker);
      // ② 触发 _rebuildSystemPrompt（内核从 loader 重读 appendSystemPrompt）后仍在
      session.setActiveToolsByName(["read"]);
      expect(session.systemPrompt).toContain(marker);
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// A2（P2 命门·正）派活工具白名单在场 → faux 产调用 → execute 真被触发
// ===========================================================================
describe("A2（P2 命门·正）submit_plan 在白名单 → execute 闭包真被命中", () => {
  it("faux 产 submit_plan 工具调用 → calls[] 非空（行为侧、非静态在场）", async () => {
    const calls: MastermindToolCall[] = [];
    const customTools = buildMastermindTools(calls);
    // 步1：产 submit_plan 调用（stopReason toolUse）；步2：收尾文本（stopReason stop）让回合结束。
    const faux = makeFaux([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("submit_plan", {
              plan: {
                teammates: [
                  { name: "后端", role: "backend", subTask: "写 API", acceptanceCriteria: "通过单测" },
                ],
                notes: "",
              },
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);
    try {
      const { inner } = await startOrchestratorSession({
        injectionBlock: "你是总管。",
        tools: [...CODING_TOOL_NAMES, "submit_plan", "dispatch_task"],
        customTools,
        faux,
      });
      await driveOneTurn(inner, "帮我做个登录功能");

      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.tool).toBe("submit_plan");
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// A3（P2 命门·负对照·证 A2 非 vacuous）同 faux 同调用、仅白名单去掉 submit_plan
// → 激活集无 / 注册表无 / calls 空（漏名静默失效）
// ===========================================================================
describe("A3（P2 命门·负对照）submit_plan 漏白名单 → 静默调不到", () => {
  it("白名单仅留 dispatch_task、customTools 仍传全部 → submit_plan 三件全空", async () => {
    const calls: MastermindToolCall[] = [];
    const customTools = buildMastermindTools(calls); // customTools 仍含 submit_plan + dispatch_task
    // 与 A2 完全相同的 faux（产同样 submit_plan 调用）。
    const faux = makeFaux([
      () =>
        fauxAssistantMessage(
          [
            fauxToolCall("submit_plan", {
              plan: {
                teammates: [
                  { name: "后端", role: "backend", subTask: "写 API", acceptanceCriteria: "通过单测" },
                ],
                notes: "",
              },
            }),
          ],
          { stopReason: "toolUse" },
        ),
      () => fauxAssistantMessage([fauxText("done")], { stopReason: "stop" }),
    ]);
    try {
      const { inner } = await startOrchestratorSession({
        injectionBlock: "你是总管。",
        tools: [...CODING_TOOL_NAMES, "dispatch_task"], // ← 关键：白名单去掉 submit_plan
        customTools,
        faux,
      });

      // (a) 激活集不含 submit_plan
      expect(inner.getActiveToolNames().includes("submit_plan")).toBe(false);
      // (b) 注册表查不到该工具定义
      expect(inner.getToolDefinition("submit_plan")).toBeUndefined();

      await driveOneTurn(inner, "帮我做个登录功能");

      // (c) faux 产了 submit_plan 调用，但漏名 → execute 静默不触发 → calls 空
      expect(calls.length).toBe(0);
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// A4（P4）编码工具 + 派活工具并存、且裸起会话未被判 doc
// ===========================================================================
describe("A4（P4）编码工具(bash/write/edit) + 派活工具并存、未套 doc 受限集", () => {
  it("裸 createAgentSession（不经任何带 profile.mode 三元的 helper）→ 激活集同时含两类", async () => {
    const calls: MastermindToolCall[] = [];
    const customTools = buildMastermindTools(calls);
    const faux = makeFaux();
    try {
      // 关键：不调 startProfileSession / runDispatch / reattachProfileSession 任一带 mode 三元的 helper，
      // 直接 assembleOrchestratorSessionOptions + 裸 createAgentSession。
      const { inner } = await startOrchestratorSession({
        injectionBlock: "你是总管。",
        tools: [...CODING_TOOL_NAMES, "submit_plan", "dispatch_task"],
        customTools,
        faux,
      });
      const active = inner.getActiveToolNames();

      // 编码工具在场（证未被 DOC_SESSION_TOOLS 收窄成只读+提议集）
      for (const t of ["bash", "write", "edit", "read"]) {
        expect(active).toContain(t);
      }
      // 派活工具也在场
      for (const t of ["submit_plan", "dispatch_task"]) {
        expect(active).toContain(t);
      }
      // 反向：未混入 doc 会话的提议工具
      for (const t of ["create_artifact", "propose_edit", "list_artifacts"]) {
        expect(active).not.toContain(t);
      }
    } finally {
      faux.unregister();
    }
  });
});

// ===========================================================================
// A5（P1）装配函数独立、不 import rpc-manager（greenfield）
// ===========================================================================
describe("A5（P1）orchestrator-session 装配自包含、不 import rpc-manager", () => {
  it("源码不含对 rpc-manager 的 import（装派活工具不碰起会话链）", () => {
    const src = readFileSync(
      join(__dirname, "orchestrator-session.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/from\s+["'].*rpc-manager["']/);
    expect(src).not.toMatch(/import\(.*rpc-manager.*\)/);
    // 注：startRpcSessionInner 普通分支零改的强变异验证留 T2；spike 未碰 rpc-manager。
  });
});
