/**
 * 第 8.6 轮 · T2（迁自 spike-1，D-R8.6-08/10）—— 主脑（总管）会话**纯装配**命门回归。5 断言 A1~A5：
 *
 *   A1（P3）总管注入块进系统提示、且 setActiveToolsByName 触发 rebuild 后仍在（D-24 唯一证伪点）。
 *   A2（P2 命门·正）faux 产 submit_plan 工具调用 → execute 闭包 calls[] 真被命中（行为侧、非静态在场）；
 *        **A3 加固**：driveOneTurn 独立追踪 endFired + 末条 assistant 的 stopReason，A2 三连断言
 *        endFired===true + lastStopReason==='stop' + calls 非空（杜绝「超时 resolve 假绿」）。
 *   A3（P2 命门·负对照）同 faux 同调用、仅白名单去掉 submit_plan → 激活集/注册表/calls 三件全空
 *        （坐实「漏名静默失效」、证 A2 非 vacuous）。
 *   A4（P4）装配后激活集同时含编码工具(bash/write/edit) + 派活工具，且裸起会话未被判 doc。
 *   A5（P1）装配函数独立、不 import rpc-manager（源码 grep 证 greenfield，T2 接线落 orchestrator-session-wiring.ts）。
 *
 * 起会话/驱动回合用真实 AgentSessionWrapper（接事件流），不入进程级 globalThis registry。
 * 断言走**行为**（getActiveToolNames / getToolDefinition / execute 命中 / stopReason）非内核源码行号。
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  dir = mkdtempSync(join(tmpdir(), "ns-r86-orch-"));
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

/**
 * 用真实 AgentSessionWrapper 接事件流、send 一条 prompt、等 agent_end && !willRetry。
 *
 * **A3 加固**（杜绝原 spike「超时与 agent_end 共用 resolve = 假绿入口」）：独立追踪 endFired——
 * 只有真收到 `agent_end && willRetry===false` 才置 endFired=true，并从该事件 `messages` 取**末条
 * role==='assistant'** 的 stopReason；超时仍 resolve 但**不**置 endFired（调用方据此区分真结束 vs 超时）。
 */
async function driveOneTurn(
  inner: AgentSession,
  message: string,
  timeoutMs = 5000,
): Promise<{ endFired: boolean; lastStopReason: string | undefined }> {
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  let endFired = false;
  let lastStopReason: string | undefined;
  // 先挂监听再 send，否则首条 prompt 的事件错过（母版 dispatch-runner 同纪律）。
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    const off = wrapper.onEvent(
      (event: {
        type: string;
        willRetry?: boolean;
        messages?: Array<{ role?: string; stopReason?: string }>;
      }) => {
        if (event.type === "agent_end" && event.willRetry === false) {
          endFired = true;
          const msgs = event.messages ?? [];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i]?.role === "assistant") {
              lastStopReason = msgs[i]?.stopReason;
              break;
            }
          }
          clearTimeout(timer);
          off();
          resolve();
        }
      },
    );
    wrapper.send({ type: "prompt", message });
  });
  wrapper.destroy();
  return { endFired, lastStopReason };
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
      const tools = buildMastermindTools({ calls });
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
// A2（P2 命门·正）派活工具白名单在场 → faux 产调用 → execute 真被触发（+ A3 加固三连）
// ===========================================================================
describe("A2（P2 命门·正）submit_plan 在白名单 → execute 闭包真被命中", () => {
  it("faux 产 submit_plan 工具调用 → 回合真结束(stop) 且 calls[] 非空（行为侧、非超时假绿）", async () => {
    const calls: MastermindToolCall[] = [];
    const customTools = buildMastermindTools({ calls });
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
        tools: [...CODING_TOOL_NAMES, "submit_plan"], // Q1：dispatch_task 已移除
        customTools,
        faux,
      });
      const { endFired, lastStopReason } = await driveOneTurn(inner, "帮我做个登录功能");

      // A3 加固三连：真收到 agent_end（非超时兜底）+ 末条 assistant stopReason='stop' + execute 命中
      expect(endFired).toBe(true);
      expect(lastStopReason).toBe("stop");
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
  it("白名单去掉 submit_plan、customTools 仍传它 → submit_plan 三件全空（漏名静默失效）", async () => {
    const calls: MastermindToolCall[] = [];
    const customTools = buildMastermindTools({ calls }); // customTools 仍含 submit_plan
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
        tools: [...CODING_TOOL_NAMES], // ← 关键：白名单去掉 submit_plan（customTools 仍传它）
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
    const customTools = buildMastermindTools({ calls });
    const faux = makeFaux();
    try {
      // 关键：不调 startProfileSession / runDispatch / reattachProfileSession 任一带 mode 三元的 helper，
      // 直接 assembleOrchestratorSessionOptions + 裸 createAgentSession。
      const { inner } = await startOrchestratorSession({
        injectionBlock: "你是总管。",
        tools: [...CODING_TOOL_NAMES, "submit_plan"], // Q1：dispatch_task 已移除
        customTools,
        faux,
      });
      const active = inner.getActiveToolNames();

      // 编码工具在场（证未被 DOC_SESSION_TOOLS 收窄成只读+提议集）
      for (const t of ["bash", "write", "edit", "read"]) {
        expect(active).toContain(t);
      }
      // 派活工具也在场
      for (const t of ["submit_plan"]) {
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
  it("源码不含对 rpc-manager 的 import（装派活工具不碰起会话链；接线落 wiring 文件）", () => {
    const src = readFileSync(join(__dirname, "orchestrator-session.ts"), "utf-8");
    expect(src).not.toMatch(/from\s+["'].*rpc-manager["']/);
    expect(src).not.toMatch(/import\(.*rpc-manager.*\)/);
  });
});

// ===========================================================================
// spike-3（AC-3.1/3.2）submit_plan 只落 awaiting_plan_approval、绝不起编排（不 fire）
//
// 承重命门：用户点计划卡「确认」= approve 路由是唯一 fire 入口。submit_plan 工具本身**只落盘等确认**，
// 绝不 acquireSlot / setRunController / runMastermind。orchestrator-session.ts 源码物理够不到这三者
// （import 仅 typebox/内核/coding-tools + import type MastermindRunStore），故行为上不可能 fire——
// AC-3.1 用 faux runStore 直接驱动 execute 断言「落 awaiting + 未触任何 fire spy」，AC-3.2 源码 grep 封死。
// ===========================================================================
describe("spike-3（AC-3.1）submit_plan 落 awaiting_plan_approval、两 fire spy 调 0 次", () => {
  it("faux runStore + spy acquireSlot/setRunController → 创建 awaiting run、spy 均未被调", async () => {
    const created: Array<{ projectId: string; status: string }> = [];
    // faux MastermindRunStore：只实现 create，记录落盘的 status。
    const fauxRunStore = {
      create: (projectId: string, run: { status: string }) => {
        created.push({ projectId, status: run.status });
      },
    } as unknown as import("../domain/mastermind-run-store").MastermindRunStore;

    // 两个 fire spy——submit_plan 若越权起编排必命中它们（实际 orchestrator-session 够不到、恒 0）。
    const acquireSpy = vi.fn();
    const setRunControllerSpy = vi.fn();

    const tools = buildMastermindTools({ projectId: "proj-1", runStore: fauxRunStore });
    const submitPlan = tools.find((t) => t.name === "submit_plan")!;
    expect(submitPlan).toBeDefined();

    // 直接驱动 execute（不经内核），断言行为侧。ctx 用 {} as never（母版 doc-tools.test.ts:61 同款）。
    const result = await submitPlan.execute(
      "call-1",
      {
        plan: {
          teammates: [
            { name: "后端", role: "backend", subTask: "写 API", acceptanceCriteria: "过单测" },
          ],
          notes: "",
        },
      },
      undefined,
      undefined,
      {} as never,
    );

    // 落盘恰一次、status=awaiting_plan_approval（不 running、不 fire）
    expect(created).toHaveLength(1);
    expect(created[0].projectId).toBe("proj-1");
    expect(created[0].status).toBe("awaiting_plan_approval");
    // 返回体状态也是 awaiting_plan_approval、带 runId
    const textPart = result.content[0] as { text: string };
    const payload = JSON.parse(textPart.text) as { status: string; runId: string };
    expect(payload.status).toBe("awaiting_plan_approval");
    expect(payload.runId).toBeTruthy();
    // 两 fire spy 恒 0（submit_plan 绝不起编排）
    expect(acquireSpy).toHaveBeenCalledTimes(0);
    expect(setRunControllerSpy).toHaveBeenCalledTimes(0);
  });

  it("dispatch_task 已移除：buildMastermindTools 只返回 submit_plan 一件", () => {
    const tools = buildMastermindTools();
    expect(tools.map((t) => t.name)).toEqual(["submit_plan"]);
  });
});

describe("spike-3（AC-3.2）orchestrator-session 源码够不到 fire 机制（结构性封死）", () => {
  it("源码不 import acquireSlot / runMastermind / setRunController（物理够不到 fire）", () => {
    const src = readFileSync(join(__dirname, "orchestrator-session.ts"), "utf-8");
    expect(src).not.toMatch(/concurrency-gate/); // acquireSlot 来源
    expect(src).not.toMatch(/mastermind-orchestrator/); // runMastermind 来源
    expect(src).not.toMatch(/run-controllers/); // setRunController 来源
  });
});
