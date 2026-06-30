/**
 * 第 8.6 轮 · M1 雏形 —— 主脑（总管）会话装配的内核封装。
 *
 * 路线 C（工具派活 + 计划确认）的地基：给**主会话（主对话）**装上
 *   1. 总管 system prompt 注入（经 `appendSystemPromptOverride`，与 B2 档案注入同机制）；
 *   2. 派活 customTools（`submit_plan` / `dispatch_task` …），让主脑 LLM 能**调用工具**拆活派人。
 *
 * 本模块只「封装」内核、不 fork 内核（红线），也**不 import `lib/rpc-manager`**——装配函数
 * 自包含、greenfield，spike-1 的承重前提 P1（普通主会话零改）靠「独立函数 + 不碰起会话链」
 * 来满足；真正接线到 `startRpcSessionInner` 留 T2。
 *
 * 注入持久化走内核原生 `DefaultResourceLoader` 覆盖钩子，绝不事后改
 * `session.state.systemPrompt`（D-24 红线：会被内核 `_rebuildSystemPrompt` 从 loader 重读覆盖）。
 *
 * ⚠️ 命门（spike-1 P2 / D-V2-04）：customTool 名必须同时进**白名单 `tools`**，否则内核
 * `_refreshToolRegistry` 按白名单名过滤掉它们——连注册都不到、faux 产该调用时 execute 静默不触发。
 */

import { type Static, Type } from "typebox";
import {
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  type AgentToolResult,
  type ResourceLoader,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { CODING_TOOL_NAMES } from "./coding-tools";

/**
 * 与 doc-tools 同因（异构具体 ToolDefinition 收数组会因 parameters 逆变方差报错）：
 * 本地等价 `ToolDefinition<any,any>`，`any` 限定在这一行。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MastermindToolDef = ToolDefinition<any, any>;

/**
 * 构造携带「总管 prompt 注入」的 {@link DefaultResourceLoader} 并完成首次加载。
 *
 * - injectionBlock 经 `appendSystemPromptOverride` 排到 append 段最前（与
 *   `agent-profile-session.ts:131-152` 完全同构）；空串则不挂钩子，保留内核默认 append 行为。
 * - **必须 `await loader.reload()`** 后才能交给 `createAgentSession`（内核 sdk 范式）。
 */
export async function buildOrchestratorResourceLoader(
  injectionBlock: string,
  args?: {
    cwd?: string;
    agentDir?: string;
    settingsManager?: SettingsManager;
  },
): Promise<ResourceLoader> {
  const loader = new DefaultResourceLoader({
    // cwd 内核必填（normalizePath 对 undefined 崩）；未给则退回 process.cwd()。
    cwd: args?.cwd ?? process.cwd(),
    agentDir: args?.agentDir ?? getAgentDir(),
    settingsManager: args?.settingsManager,
    // 注入块为空则不挂钩子（避免无谓改写内核默认 append）。
    ...(injectionBlock
      ? { appendSystemPromptOverride: (base: string[]) => [injectionBlock, ...base] }
      : {}),
  });
  await loader.reload();
  return loader;
}

// ---------------------------------------------------------------------------
// 派活工具（spike 最小集：submit_plan / dispatch_task）的 TypeBox schema
// ---------------------------------------------------------------------------
const teammateSchema = Type.Object({
  name: Type.String(),
  role: Type.String(),
  subTask: Type.String(),
  acceptanceCriteria: Type.String(),
});
const submitPlanSchema = Type.Object({
  plan: Type.Object({
    teammates: Type.Array(teammateSchema),
    notes: Type.String(),
  }),
});
const dispatchTaskSchema = Type.Object({
  planId: Type.String(),
});

/** AgentToolResult 成功返回：结果 JSON 化进 text content（模型唯一真读的通道）。details→undefined。 */
function jsonResult(payload: unknown): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: undefined,
  };
}

/**
 * 派活工具被调用时记一条到 `calls[]` 的最小记录（供 spike A2/A3 断言「execute 真被触发」）。
 * 生产实现（M3/M4：落 awaiting_plan_approval、approve 后 fire 编排器）留 T2~T4。
 */
export type MastermindToolCall = { tool: string; params: unknown };

/**
 * 用内核 `defineTool` 造派活工具集（spike 最小集）。
 *
 * @param calls 外部注入的记录数组——execute 闭包内 push，spike 断言它「行为侧真被调」（非静态在场）。
 */
export function buildMastermindTools(calls: MastermindToolCall[]): MastermindToolDef[] {
  const submitPlan = defineTool({
    name: "submit_plan",
    label: "submit_plan",
    description:
      "提交一份多队员协作计划等用户确认（不立即执行）。参数 plan.teammates=[{name,role,subTask,acceptanceCriteria}]、plan.notes。" +
      "返回 planId；用户确认后再调 dispatch_task 放行。",
    parameters: submitPlanSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof submitPlanSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      calls.push({ tool: "submit_plan", params });
      // spike 桩：返回一个固定 planId；生产落 MastermindRun{awaiting_plan_approval} 留 T3。
      return jsonResult({ planId: "spike-plan-1", status: "awaiting_approval" });
    },
  });

  const dispatchTask = defineTool({
    name: "dispatch_task",
    label: "dispatch_task",
    description:
      "在用户确认计划后放行执行：据 planId 起多队员编排。参数 planId（submit_plan 返回的）。返回 runId。",
    parameters: dispatchTaskSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof dispatchTaskSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      calls.push({ tool: "dispatch_task", params });
      return jsonResult({ runId: "spike-run-1", status: "dispatched" });
    },
  });

  return [submitPlan, dispatchTask];
}

/**
 * 装配可展开进 `createAgentSession(...)` 的主脑会话选项（不真正建会话）。
 *
 * 白名单 `tools` = 编码工具全集 ∪ 派活工具名（命门：派活名漏掉则内核按名过滤、调不到）。
 * customTools = 派活工具集。resourceLoader = 总管 prompt 注入 loader。
 *
 * 本函数**自包含、绝不 import `lib/rpc-manager`**（spike-1 A5：装派活工具是 greenfield 装配、
 * 不碰起会话链；普通主会话零影响）。
 */
export function assembleOrchestratorSessionOptions(deps: {
  resourceLoader: ResourceLoader;
  mastermindTools: MastermindToolDef[];
}): {
  tools: string[];
  customTools: MastermindToolDef[];
  resourceLoader: ResourceLoader;
} {
  const toolNames = deps.mastermindTools.map((t) => t.name);
  return {
    tools: [...CODING_TOOL_NAMES, ...toolNames],
    customTools: deps.mastermindTools,
    resourceLoader: deps.resourceLoader,
  };
}
