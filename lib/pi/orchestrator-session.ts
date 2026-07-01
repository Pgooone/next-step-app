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

import { randomUUID } from "node:crypto";
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
import type { MastermindRunStore } from "../domain/mastermind-run-store";

/**
 * 总管（主脑）系统提示——**模块级常量**，初建（{@link startOrchestratorSession}）与 idle 重建
 * （{@link reattachOrchestratorSession}）共用**同一份**注入块（D-R8.6-10⑤：防两端现算漂移）。
 * 内核不持久化 systemPrompt（每次构造期由 resourceLoader 现算），故 re-attach 必须用同一常量
 * 重注入，否则总管角色静默丢失。
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = [
  "你是本项目的总管（主脑）。你拥有完整的编码工具（bash / write / edit / read 等），既能亲自动手，也能拆活派人。",
  "",
  "处理用户需求的规矩：",
  "- 小任务（能自己直接完成、或仅需回答）：直接动手或回答，不必派人。",
  "- 大任务（需要多人协作）：调 `submit_plan` 工具提交一份多队员协作计划，",
  "  每个队员含 name（队员名）/ role（角色）/ subTask（子任务）/ acceptanceCriteria（验收标准）；",
  "  可按子任务性质给队员标 mode（`doc` 出文档 / `coding` 写代码，默认 `doc`）。",
  "  提交计划后**暂停等待用户在计划卡上确认放行**——由用户点确认后系统才起编排，你无需（也无法）自行放行执行。",
].join("\n");

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
// 派活工具 submit_plan 的 TypeBox schema
// （Q1：dispatch_task 已移除——放行执行由用户点计划卡「确认」= approve 路由唯一 fire 入口，
//   不给 LLM 越权放行的枪；连带白名单去名 + system prompt 去「调 dispatch_task」。）
// ---------------------------------------------------------------------------
const teammateSchema = Type.Object({
  name: Type.String(),
  role: Type.String(),
  subTask: Type.String(),
  acceptanceCriteria: Type.String(),
  // Q3：唯一 schema 扩展——主脑按子任务性质声明 mode（coding 队员真写代码、doc 队员受限省安全）；默认 doc。
  mode: Type.Optional(Type.Union([Type.Literal("doc"), Type.Literal("coding")])),
});
const submitPlanSchema = Type.Object({
  plan: Type.Object({
    teammates: Type.Array(teammateSchema),
    notes: Type.String(),
  }),
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
 */
export type MastermindToolCall = { tool: string; params: unknown };

/**
 * {@link buildMastermindTools} 的闭包注入依赖（T3 起 submit_plan 真落盘）：
 * - projectId + runStore 都在场 → submit_plan **真落** MastermindRun{awaiting_plan_approval}（等计划卡确认）；
 * - 缺任一（如 spike 纯装配测试）→ 退回**桩行为**（返固定 planId，不崩）；
 * - calls：可选记录数组，execute 闭包内 `calls?.push(...)`——测试断言「execute 行为侧真被调」（A2/A3 命门），
 *   生产不传。
 */
export interface BuildMastermindToolsDeps {
  projectId?: string;
  runStore?: MastermindRunStore;
  calls?: MastermindToolCall[];
}

/**
 * 用内核 `defineTool` 造派活工具集——**仅 submit_plan**（Q1：dispatch_task 已移除，放行走 approve 路由）。
 *
 * @param deps 闭包注入（见 {@link BuildMastermindToolsDeps}）；生产由 wiring 传 {projectId,runStore}。
 */
export function buildMastermindTools(deps?: BuildMastermindToolsDeps): MastermindToolDef[] {
  const submitPlan = defineTool({
    name: "submit_plan",
    label: "submit_plan",
    description:
      "提交一份多队员协作计划等用户在计划卡上确认放行（不立即执行）。" +
      "参数 plan.teammates=[{name,role,subTask,acceptanceCriteria,mode?}]（mode 可选 doc/coding，默认 doc）、plan.notes。" +
      "返回 runId；用户在计划卡点确认后系统才起编排，你无需自行放行。",
    parameters: submitPlanSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof submitPlanSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      deps?.calls?.push({ tool: "submit_plan", params });
      // 生产：deps 有 projectId+runStore → 真落 MastermindRun{awaiting_plan_approval}（stages 空，等 approve）。
      if (deps?.projectId && deps.runStore) {
        const id = randomUUID();
        deps.runStore.create(deps.projectId, {
          id,
          projectId: deps.projectId,
          status: "awaiting_plan_approval",
          plan: params.plan,
          stages: [],
          currentStageIndex: 0,
          createdAt: new Date().toISOString(),
          finishedAt: null,
          cancelRequested: false,
          failedReason: null,
        });
        return jsonResult({ planId: id, runId: id, status: "awaiting_plan_approval" });
      }
      // 桩：deps 缺 projectId/runStore（如 spike 纯装配测试）→ 返固定 planId，不崩。
      return jsonResult({ planId: "spike-plan-1", status: "awaiting_plan_approval" });
    },
  });

  return [submitPlan];
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
