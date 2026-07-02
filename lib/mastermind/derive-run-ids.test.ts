import { describe, expect, it } from "vitest";
import {
  derivePlanRefsFromMessage,
  deriveAllRunIds,
  isAssistantMessage,
  parseRunId,
} from "./derive-run-ids";
import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";

/** 造一条带 submit_plan toolCall 的 assistant 消息。 */
function assistantWithPlans(toolCallIds: string[]): AssistantMessage {
  return {
    role: "assistant",
    model: "m",
    provider: "p",
    content: toolCallIds.map((id) => ({
      type: "toolCall" as const,
      toolCallId: id,
      toolName: "submit_plan",
      input: {},
    })),
  };
}

/** 造一条 submit_plan 的 toolResult（text=JSON{runId}）。 */
function planResult(toolCallId: string, runId: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text: JSON.stringify({ planId: runId, runId, status: "awaiting_plan_approval" }) }],
  };
}

describe("parseRunId：从 submit_plan 的 toolResult 解析 runId", () => {
  it("正常 JSON → 取出 runId", () => {
    expect(parseRunId(planResult("tc1", "run-abc"))).toBe("run-abc");
  });

  it("result 缺失 → null（渲 loading）", () => {
    expect(parseRunId(undefined)).toBeNull();
  });

  it("result 是错误 → null", () => {
    const r: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc1",
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    expect(parseRunId(r)).toBeNull();
  });

  it("text 非 JSON → null（不崩）", () => {
    const r: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc1",
      content: [{ type: "text", text: "not json {" }],
    };
    expect(parseRunId(r)).toBeNull();
  });

  it("JSON 无 runId 字段 → null", () => {
    const r: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc1",
      content: [{ type: "text", text: JSON.stringify({ planId: "x", status: "ok" }) }],
    };
    expect(parseRunId(r)).toBeNull();
  });

  it("无 text content（仅 image）→ null", () => {
    const r: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc1",
      content: [{ type: "image", source: { type: "url", url: "x" } }],
    };
    expect(parseRunId(r)).toBeNull();
  });
});

describe("derivePlanRefsFromMessage：从 assistant 消息派生全部 submit_plan 的 runId", () => {
  it("单个 submit_plan + result 到 → 一个 ref 带 runId", () => {
    const msg = assistantWithPlans(["tc1"]);
    const results = new Map<string, ToolResultMessage>([["tc1", planResult("tc1", "run-1")]]);
    const refs = derivePlanRefsFromMessage(msg, results);
    expect(refs).toEqual([{ toolCallId: "tc1", runId: "run-1" }]);
  });

  it("多个 submit_plan → 各出一个 runId（禁 find、非只取第一个）", () => {
    const msg = assistantWithPlans(["tc1", "tc2"]);
    const results = new Map<string, ToolResultMessage>([
      ["tc1", planResult("tc1", "run-1")],
      ["tc2", planResult("tc2", "run-2")],
    ]);
    const refs = derivePlanRefsFromMessage(msg, results);
    expect(refs).toEqual([
      { toolCallId: "tc1", runId: "run-1" },
      { toolCallId: "tc2", runId: "run-2" },
    ]);
  });

  it("toolResult 缺失（流式窗口）→ ref 存在但 runId=null（渲 loading 信号）", () => {
    const msg = assistantWithPlans(["tc1"]);
    const refs = derivePlanRefsFromMessage(msg, new Map());
    expect(refs).toEqual([{ toolCallId: "tc1", runId: null }]);
  });

  it("忽略非 submit_plan 的 toolCall（如 write）", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [
        { type: "toolCall", toolCallId: "w1", toolName: "write", input: {} },
        { type: "text", text: "hi" },
        { type: "toolCall", toolCallId: "tc1", toolName: "submit_plan", input: {} },
      ],
    };
    const results = new Map<string, ToolResultMessage>([["tc1", planResult("tc1", "run-1")]]);
    const refs = derivePlanRefsFromMessage(msg, results);
    expect(refs).toEqual([{ toolCallId: "tc1", runId: "run-1" }]);
  });

  it("无 submit_plan → 空数组", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      model: "m",
      provider: "p",
      content: [{ type: "text", text: "just talking" }],
    };
    expect(derivePlanRefsFromMessage(msg, new Map())).toEqual([]);
  });
});

describe("isAssistantMessage 守卫", () => {
  it("assistant → true，其它 → false", () => {
    expect(isAssistantMessage({ role: "assistant", model: "m", provider: "p", content: [] })).toBe(true);
    expect(isAssistantMessage({ role: "user", content: "hi" })).toBe(false);
  });
});

describe("deriveAllRunIds：从整条 transcript 抽全部已解析 runId（去重、保序）", () => {
  it("多条 assistant、多 submit_plan → 去重按首现保序", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "go" },
      assistantWithPlans(["tc1", "tc2"]),
      planResult("tc1", "run-a"),
      planResult("tc2", "run-b"),
      { role: "user", content: "again" },
      assistantWithPlans(["tc3"]),
      planResult("tc3", "run-c"),
    ];
    expect(deriveAllRunIds(messages)).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("同一 runId 重复出现 → 只留一次（去重）", () => {
    const messages: AgentMessage[] = [
      assistantWithPlans(["tc1"]),
      planResult("tc1", "run-a"),
      assistantWithPlans(["tc2"]),
      planResult("tc2", "run-a"), // 同 runId
    ];
    expect(deriveAllRunIds(messages)).toEqual(["run-a"]);
  });

  it("runId 尚未到（toolResult 缺失）→ 略过、不进列表", () => {
    const messages: AgentMessage[] = [assistantWithPlans(["tc1"])];
    expect(deriveAllRunIds(messages)).toEqual([]);
  });

  it("无 submit_plan → 空数组", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "hello" }] },
    ];
    expect(deriveAllRunIds(messages)).toEqual([]);
  });
});
