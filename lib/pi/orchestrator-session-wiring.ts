/**
 * 第 8.6 轮 · T2（D-R8.6-10）—— 主脑（总管）会话的「服务端组合」逻辑。
 *
 * 把 M1 雏形（{@link buildOrchestratorResourceLoader} / {@link buildMastermindTools} /
 * {@link assembleOrchestratorSessionOptions}，见 orchestrator-session.ts）接进真实起会话链，端到端
 * 完成「装总管 prompt + 派活工具 → createAgentSession → 登记进 registry → 发首条 message」。
 *
 * 仿 {@link profile-session-wiring.ts} 写两个函数（D-R8.6-10①）：
 *   - {@link startOrchestratorSession}：新建主脑会话（/api/agent/new 主脑分支调）；
 *   - {@link reattachOrchestratorSession}：idle 销毁 / dev 重启 / SSE 重连后重建（resolver 主脑分支调）。
 *
 * ── 为何独立文件、不并进 orchestrator-session.ts ──────────────────────
 * orchestrator-session.ts 须保持「纯装配、绝不 import rpc-manager」（spike A5：正则 `/import\(.*
 * rpc-manager.*\)/` 连惰性 import 都命中）。本文件要 registerInnerSession（来自 rpc-manager），故
 * 拆出来；与 rpc-manager 的 import 走**惰性** `await import`（仿 profile-session-wiring.ts:289-294），
 * 避免静态导入环。
 *
 * ── 客户端安全（D-R7B-07）──────────────────────────────────────────
 * 本模块是服务端领域层。生产经惰性 import 拿 rpc-manager（含 node:fs 链）的 registerInnerSession——
 * 绝不让它进任何 "use client" 链的值导入。
 *
 * 红线：只「封装/组合」内核与既有封装，不 fork 内核、不碰 owner-map、不调 setActiveToolsByName
 * （绕开 startRpcSessionInner :362/:374/:380-382 三坑）。
 */

import {
  createAgentSession,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

import {
  assembleOrchestratorSessionOptions,
  buildMastermindTools,
  buildOrchestratorResourceLoader,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "./orchestrator-session";

/**
 * 登记口（仿 profile-session-wiring.ts 的 ReattachInnerSession）：返回 `session` 用泛型 `S` 透传
 * 上层（生产是 rpc-manager 的 `AgentSessionWrapper`），而非窄到只剩 `send`。生产经惰性 `await
 * import("../rpc-manager")` 拿真实 `registerInnerSession`；测试注入 faux（不碰进程级 globalThis registry）。
 */
export type RegisterOrchestratorSession<S = unknown> = (
  inner: AgentSession,
) => { session: S; realSessionId: string } | Promise<{ session: S; realSessionId: string }>;

/** 首条 message 的图片附件（与 rpc-manager wrapper prompt 分支 :72-77 读的 command.images 同形）。 */
export type PromptImage = { type: "image"; data: string; mimeType: string };

/**
 * 新建一个主脑（总管）会话：装配总管注入 loader + 派活 customTools → createAgentSession →
 * （可选）应用预选 model/thinking → 登记进 registry（接事件流）→ 发首条 message（触发真落盘，
 * D-B4-3）→ 返回 `{ session, realSessionId }`。
 *
 * 与 {@link startProfileSession} 同结构：主脑**无 profile**，model/thinking 不来自档案而来自新建会话
 * UI 的预选（route 透传 provider/modelId/thinkingLevel）。与母版 `applyProfileRuntime` 同纪律——**在
 * 发首条 message 之前**应用，确保首轮就用预选模型（否则首轮用内核默认）。不套 doc 受限工具集（主脑要带
 * bash/write/edit 自己干活，A4 已验编码工具 + 派活工具并存）。
 *
 * 注意顺序：建会话 → 应用 model/thinking → registerInnerSession 接事件流 → 发首条 message。
 * register 必须在发首条 message 之前——否则首条 prompt 产生的流事件无人订阅。
 *
 * @param cwd 会话工作目录（route 从请求体 cwd 取，与普通主对话 /api/agent/new 同源）。
 * @param firstMessage 首条用户消息（不可为空——空则触发 D-B4-3 的幻影会话坑）。
 * @param images 首条 message 的图片附件（route 从请求体 images 透传）；与普通分支 `session.send(promptCommand)`
 *   带 images 对齐——`mastermind:true` 默认开后所有新会话走主脑分支，丢 images 会破「普通主会话零回归」。
 */
export async function startOrchestratorSession<S = unknown>(args: {
  cwd: string;
  firstMessage: string;
  /** 首条 message 的图片附件；省略/空数组则不带（与普通分支同语义）。 */
  images?: PromptImage[];
  /** 新建会话 UI 预选模型（route 从请求体 provider/modelId 透传）；省略则用内核默认。 */
  model?: { provider: string; modelId: string };
  /** 新建会话 UI 预选思考档（route 从请求体 thinkingLevel 透传）；省略则不改内核默认。 */
  thinkingLevel?: string;
  /** 测试注入 in-memory SessionManager 保持 hermetic；生产省略 → 真实落盘到 ~/.pi。 */
  sessionManager?: SessionManager;
  /** 测试注入 faux model/auth/modelRegistry，让无凭证环境也能起会话；生产省略 → 内核默认模型解析。 */
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  /**
   * 登记口：测试注入 faux（不碰进程级 registry）；生产省略 → 惰性 import rpc-manager 的真实
   * `registerInnerSession`（动态 import 避免静态导入环）。
   */
  registerInnerSession?: RegisterOrchestratorSession<S>;
}): Promise<{ session: S; realSessionId: string }> {
  const {
    cwd,
    firstMessage,
    images,
    model,
    thinkingLevel,
    sessionManager,
    createOptionsOverride,
    registerInnerSession,
  } = args;

  const agentDir = getAgentDir();
  const sm = sessionManager ?? SessionManager.create(cwd, undefined);

  // 总管 prompt 注入 loader + 派活工具（生产不传 calls；桩只回占位 planId/runId）。
  const resourceLoader = await buildOrchestratorResourceLoader(ORCHESTRATOR_SYSTEM_PROMPT, { cwd });
  const mastermindTools = buildMastermindTools();
  const opts = assembleOrchestratorSessionOptions({ resourceLoader, mastermindTools });

  // 白名单 tools = 编码全集 ∪ 派活工具名（命门 D-V2-04：派活名漏掉则内核按名过滤、调不到）。
  // 绝不调 setActiveToolsByName——装配期一步到位（A4 验编码 + 派活并存、未被判 doc）。
  const { session: inner } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager: sm,
    resourceLoader: opts.resourceLoader,
    tools: opts.tools,
    customTools: opts.customTools,
    ...createOptionsOverride,
  });

  // 在发首条 message 之前应用预选 model/thinking（与母版 applyProfileRuntime 同纪律，确保首轮即用）。
  if (model) {
    const found = inner.modelRegistry.find(model.provider, model.modelId);
    if (found) await inner.setModel(found); // 查不到则静默用内核默认（与 generic 主对话同语义）。
  }
  // thinkingLevel 来自请求体（string）；内核 setThinkingLevel 形参是 ThinkingLevel 联合——按内核
  // 自身参数类型收口（与 rpc-manager wrapper 的 `command.level as string` 同款运行时纪律）。
  if (thinkingLevel) inner.setThinkingLevel(thinkingLevel as Parameters<typeof inner.setThinkingLevel>[0]);

  // 登记进 registry 接事件流——必须在发首条 message 之前。生产经惰性 import 拿真实
  // registerInnerSession（避免与 rpc-manager 静态导入环）；测试注入 faux。
  const register = await resolveRegister(registerInnerSession);
  const { session, realSessionId } = await register(inner);

  // D-B4-3：带首条 message 触发真落盘（fire-and-forget，事件经 SSE 流出去）。images 透传（与普通分支对齐）。
  await sendFirstMessage(session, firstMessage, images);

  return { session, realSessionId };
}

/**
 * idle 重建一个主脑会话（resolver 主脑分支调）。与 {@link startOrchestratorSession} **同源装配**
 * （同一 {@link ORCHESTRATOR_SYSTEM_PROMPT} + 同一派活工具集 + 同一白名单），**唯三差异**（仿
 * {@link reattachProfileSession}，D-R8.6-10⑤）：
 *   ① `SessionManager.open(filePath)` 重开既有会话（非 `create` 新建）；
 *   ② **不发首条 message**（reattach 的 jsonl 已存在、无幻影会话问题，重发会污染历史）；
 *   ③ **不调 applyProfileRuntime**——主脑无 profile.model，让内核默认（与现状 generic 主会话
 *      re-attach 字节等价、零回归；rpc-manager.ts:365-370 generic 本就不传 model）。
 *
 * systemPrompt 走「现算覆盖」：内核不持久化 systemPrompt，故 re-attach 必须照常用同一
 * ORCHESTRATOR_SYSTEM_PROMPT 走完整 loader——只装工具不重注入会让总管角色静默丢失。
 *
 * @returns `{ session, realSessionId }`——resolver 三分支统一解构，session 同型 AgentSessionWrapper（带 isAlive()）。
 */
export async function reattachOrchestratorSession<S = unknown>(args: {
  sessionId: string;
  filePath: string;
  cwd: string;
  /** 测试注入 in-memory/持久化 SessionManager 保持 hermetic；生产省略 → `SessionManager.open(filePath)`。 */
  sessionManager?: SessionManager;
  /** 测试注入 faux model/auth/modelRegistry，让无凭证环境也能起会话；生产省略。 */
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  /** 登记口：测试注入 faux；生产省略 → 惰性 import rpc-manager 的真实 `registerInnerSession`。 */
  registerInnerSession?: RegisterOrchestratorSession<S>;
}): Promise<{ session: S; realSessionId: string }> {
  // sessionId 不在本体消费（inner.sessionId 为准）——仅作 resolver 调用契约的语义参数，故不解构。
  const { filePath, cwd, sessionManager, createOptionsOverride, registerInnerSession } = args;

  const agentDir = getAgentDir();
  // 差异①：open 既有会话文件（非 create）。
  const sm = sessionManager ?? SessionManager.open(filePath, undefined);

  // 与 startOrchestratorSession 同源：同一 ORCHESTRATOR_SYSTEM_PROMPT + 同一派活工具 + 同一白名单。
  const resourceLoader = await buildOrchestratorResourceLoader(ORCHESTRATOR_SYSTEM_PROMPT, { cwd });
  const mastermindTools = buildMastermindTools();
  const opts = assembleOrchestratorSessionOptions({ resourceLoader, mastermindTools });

  const { session: inner } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager: sm,
    resourceLoader: opts.resourceLoader,
    tools: opts.tools,
    customTools: opts.customTools,
    ...createOptionsOverride,
  });

  // 差异③：不调 applyProfileRuntime（主脑无 model，让内核默认）。
  // 差异②：登记进 registry 接事件流，但**不发首条 message**。
  const register = await resolveRegister(registerInnerSession);
  return register(inner);
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/** 解析登记口：测试注入则用注入的；生产惰性 import rpc-manager 的真实 registerInnerSession（避静态环）。 */
async function resolveRegister<S>(
  injected?: RegisterOrchestratorSession<S>,
): Promise<RegisterOrchestratorSession<S>> {
  if (injected) return injected;
  const { registerInnerSession: real } = await import("../rpc-manager");
  return (inner: AgentSession) => real(inner) as { session: S; realSessionId: string };
}

/**
 * 经登记返回的 `session` 发首条 prompt（D-B4-3 落盘）。生产 session 是 AgentSessionWrapper（有 send）；
 * 测试 faux 同样回带 send 的物。窄到只读 `send` 一个方法，对 S 不作硬约束。
 * images 非空时随 prompt 命令带上（wrapper prompt 分支 :72-77 读 command.images）。
 */
async function sendFirstMessage(
  session: unknown,
  message: string,
  images?: PromptImage[],
): Promise<void> {
  await (session as { send(command: Record<string, unknown>): Promise<unknown> }).send({
    type: "prompt",
    message,
    ...(images?.length ? { images } : {}),
  });
}
