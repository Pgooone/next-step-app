// 从主脑（总管）assistant 消息里派生「submit_plan → runId」映射（纯函数、零 import、客户端安全）。
//
// 为何在此就地派生而非独立 store（待设计点 A 终裁）：runId 由 submit_plan 的 **toolResult** JSON
// `{planId,runId,status}` 携带（orchestrator-session.ts:170，randomUUID 运行期生成、**不在** toolCall.input），
// 每次渲染可从 transcript 重算——独立 entryId→runId store 是冗余真相源（多 run/revise/刷新易失配）。
// 卡片主键用 runId、绝不用 entryIds[idx]（live turn 期 entryIds 比 messages 短、会 undefined）。
//
// 依赖 @/lib/types 的**类型**（import type 编译期擦除），不引任何值符号，故可被客户端安全消费。
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";

/** 一条 submit_plan 派生结果：runId 已从对应 toolResult 解析出、或 pending（结果尚在流式窗口未到）。 */
export interface DerivedPlanRef {
  /** submit_plan 这次调用的 toolCallId（稳定主键，用于 React key，即便 runId 尚未到）。 */
  toolCallId: string;
  /** 解析出的 runId；toolResult 未到 / 解析失败 → null（UI 渲 loading 占位、不崩）。 */
  runId: string | null;
}

/**
 * 从一条 assistant 消息里抽出全部 submit_plan 调用及其 runId。
 * **禁 find**：一条 assistant 消息可能含多个 submit_plan（主脑一轮提交多计划）→ 逐个 filter。
 * @param message  某条 assistant 消息（含 content 块）。
 * @param toolResults  toolCallId → ToolResultMessage 的映射（ChatWindow 已构好，见 :363-369）。
 */
export function derivePlanRefsFromMessage(
  message: AssistantMessage,
  toolResults: Map<string, ToolResultMessage>,
): DerivedPlanRef[] {
  const refs: DerivedPlanRef[] = [];
  for (const block of message.content) {
    if (block.type !== "toolCall" || block.toolName !== "submit_plan") continue;
    const result = toolResults.get(block.toolCallId);
    refs.push({ toolCallId: block.toolCallId, runId: parseRunId(result) });
  }
  return refs;
}

/**
 * 从一条 submit_plan 的 toolResult 里解析 runId。
 * toolResult 的 text content 是 execute 返回的 JSON（jsonResult，见 orchestrator-session.ts:108）：
 * `{"planId":"...","runId":"...","status":"awaiting_plan_approval"}`。
 * 缺 result / 非 text / JSON 坏 / 无 runId 字段 → 返回 null（调用方渲 loading、绝不崩）。
 */
export function parseRunId(result: ToolResultMessage | undefined): string | null {
  if (!result || result.isError) return null;
  const textBlock = result.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  try {
    const parsed = JSON.parse(textBlock.text) as { runId?: unknown };
    return typeof parsed.runId === "string" && parsed.runId ? parsed.runId : null;
  } catch {
    return null;
  }
}

/** 类型守卫：窄化 AgentMessage 到 AssistantMessage（供 ChatWindow.map 内使用）。 */
export function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
  return msg.role === "assistant";
}
