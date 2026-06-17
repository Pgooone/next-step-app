/**
 * M8 · at-agent-transfer —— 主对话 @agent 转交载荷的纯逻辑。
 *
 * 把「主对话历史 + 文本附件」组装成投递给目标 agent 会话的首条消息（决策 D-V1.1-03）：
 * 历史序列化为 <context source="主对话">（保留角色标注 user/assistant/工具），
 * 附件复用 M2 的 <file> 内联格式。供 ChatInput 的转交 UI 调用。
 * 不碰内核、不涉 DOM（提取的输入是已在前端的 AgentMessage[]）。
 */
import { buildFileBlock, type TextAttachment } from "./chat-file-attach";
import type { AgentMessage } from "./types";

/** 转交历史项：从 AgentMessage 提取的角色标注视图。 */
export interface TransferHistoryItem {
  /** 角色：用户 / 助手 / 工具（工具调用与结果都归 tool）。 */
  role: "user" | "assistant" | "tool";
  /** 标注前缀（如「工具调用 Read」「工具结果 Read」）；缺省按 role 取默认中文标签。 */
  label?: string;
  /** 文本内容。 */
  text: string;
}

const ROLE_LABEL: Record<TransferHistoryItem["role"], string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
};

/** 把 content（string | block 数组）里的文本拼出来（只取 text 块，忽略图片）。 */
function textOf(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content.trim();
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

/**
 * 从主对话消息序列提取转交历史项，保留 user/assistant/工具调用/工具结果 的角色与次序。
 * - user：正文。
 * - assistant：正文 + 每个 toolCall 记一条「工具调用 <名>」。
 * - toolResult：「工具结果 <名>」+ 结果文本。
 * - custom / thinking / image：跳过（非对话正文）。空文本项丢弃。
 * 纯函数，便于单测。
 */
export function extractTransferHistory(messages: AgentMessage[]): TransferHistoryItem[] {
  const items: TransferHistoryItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = textOf(m.content);
      if (text) items.push({ role: "user", text });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) items.push({ role: "assistant", text });
      for (const b of m.content) {
        if (b.type === "toolCall") {
          items.push({ role: "tool", label: `工具调用 ${b.toolName}`, text: JSON.stringify(b.input) });
        }
      }
    } else if (m.role === "toolResult") {
      const text = textOf(m.content);
      if (text) items.push({ role: "tool", label: `工具结果${m.toolName ? " " + m.toolName : ""}`, text });
    }
    // custom 跳过
  }
  return items;
}

/** 序列化为带角色标注的纯文本（每项 [标注]\n正文，空行分隔）。保留次序与角色。纯函数。 */
export function serializeHistory(items: TransferHistoryItem[]): string {
  return items.map((it) => `[${it.label ?? ROLE_LABEL[it.role]}]\n${it.text}`).join("\n\n");
}

/** 勾选默认值：有历史默认勾历史、有附件默认勾附件。纯函数。 */
export function defaultTransferSelection(
  hasHistory: boolean,
  hasFiles: boolean,
): { includeHistory: boolean; includeFiles: boolean } {
  return { includeHistory: hasHistory, includeFiles: hasFiles };
}

/**
 * 组装转交载荷：勾选的历史包进 <context source="主对话">…</context>，
 * 勾选的附件依次拼 <file> 块（复用 M2 buildFileBlock）。两段间空行分隔。
 * 都不勾 / 都为空 → 返回空串（调用方据此禁用确认）。纯函数。
 */
export function buildTransferMessage(opts: {
  history: TransferHistoryItem[];
  attachments: TextAttachment[];
  includeHistory: boolean;
  includeFiles: boolean;
}): string {
  const parts: string[] = [];
  if (opts.includeHistory && opts.history.length > 0) {
    parts.push(`<context source="主对话">\n${serializeHistory(opts.history)}\n</context>`);
  }
  if (opts.includeFiles && opts.attachments.length > 0) {
    parts.push(opts.attachments.map((a) => buildFileBlock(a.name, a.content)).join("\n"));
  }
  return parts.join("\n\n");
}
