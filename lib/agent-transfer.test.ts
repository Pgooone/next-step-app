import { describe, it, expect } from "vitest";
import {
  extractTransferHistory,
  serializeHistory,
  defaultTransferSelection,
  buildTransferMessage,
  type TransferHistoryItem,
} from "./agent-transfer";
import type { AgentMessage } from "./types";

describe("extractTransferHistory", () => {
  it("user 字符串 content → 一条 user 项", () => {
    const msgs: AgentMessage[] = [{ role: "user", content: "你好" }];
    expect(extractTransferHistory(msgs)).toEqual([{ role: "user", text: "你好" }]);
  });

  it("user 数组 content → 取 text 块、忽略 image", () => {
    const msgs: AgentMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image", source: { type: "base64", data: "x" } },
        ],
      },
    ];
    expect(extractTransferHistory(msgs)).toEqual([{ role: "user", text: "看图" }]);
  });

  it("assistant 正文 + toolCall → 助手项 + 工具调用项（次序保留）", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        model: "m",
        provider: "p",
        content: [
          { type: "text", text: "我来读文件" },
          { type: "toolCall", toolCallId: "c1", toolName: "Read", input: { path: "a.ts" } },
        ],
      },
    ];
    expect(extractTransferHistory(msgs)).toEqual([
      { role: "assistant", text: "我来读文件" },
      { role: "tool", label: "工具调用 Read", text: JSON.stringify({ path: "a.ts" }) },
    ]);
  });

  it("toolResult → 工具结果项带工具名", () => {
    const msgs: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "Read",
        content: [{ type: "text", text: "文件内容" }],
      },
    ];
    expect(extractTransferHistory(msgs)).toEqual([
      { role: "tool", label: "工具结果 Read", text: "文件内容" },
    ]);
  });

  it("custom / 纯 thinking / 空文本 → 跳过", () => {
    const msgs: AgentMessage[] = [
      { role: "custom", customType: "x", content: "系统提示", display: false },
      { role: "assistant", model: "m", provider: "p", content: [{ type: "thinking", thinking: "想一想" }] },
      { role: "user", content: "" },
    ];
    expect(extractTransferHistory(msgs)).toEqual([]);
  });

  it("保留完整对话次序 user→assistant→tool(call)→tool(result)→user", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "读 a.ts" },
      {
        role: "assistant",
        model: "m",
        provider: "p",
        content: [
          { type: "text", text: "好的" },
          { type: "toolCall", toolCallId: "c1", toolName: "Read", input: {} },
        ],
      },
      { role: "toolResult", toolCallId: "c1", toolName: "Read", content: [{ type: "text", text: "内容" }] },
      { role: "user", content: "谢谢" },
    ];
    expect(extractTransferHistory(msgs).map((i) => i.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
  });
});

describe("serializeHistory", () => {
  it("带角色标注、空行分隔、label 优先于默认中文标签", () => {
    const items: TransferHistoryItem[] = [
      { role: "user", text: "你好" },
      { role: "assistant", text: "在" },
      { role: "tool", label: "工具调用 Read", text: "{}" },
    ];
    expect(serializeHistory(items)).toBe("[用户]\n你好\n\n[助手]\n在\n\n[工具调用 Read]\n{}");
  });
});

describe("defaultTransferSelection", () => {
  it("按有无历史/附件给默认勾选", () => {
    expect(defaultTransferSelection(true, true)).toEqual({ includeHistory: true, includeFiles: true });
    expect(defaultTransferSelection(true, false)).toEqual({ includeHistory: true, includeFiles: false });
    expect(defaultTransferSelection(false, true)).toEqual({ includeHistory: false, includeFiles: true });
    expect(defaultTransferSelection(false, false)).toEqual({ includeHistory: false, includeFiles: false });
  });
});

describe("buildTransferMessage", () => {
  const history: TransferHistoryItem[] = [{ role: "user", text: "你好" }];
  const attachments = [{ name: "a.md", content: "正文" }];

  it("勾历史+勾附件 → context + file 都在", () => {
    const out = buildTransferMessage({ history, attachments, includeHistory: true, includeFiles: true });
    expect(out).toContain('<context source="主对话">');
    expect(out).toContain("[用户]\n你好");
    expect(out).toContain('<file name="a.md">');
    expect(out).toContain("正文");
  });

  it("只勾历史 → 只有 context", () => {
    const out = buildTransferMessage({ history, attachments, includeHistory: true, includeFiles: false });
    expect(out).toContain("<context");
    expect(out).not.toContain("<file");
  });

  it("只勾附件 → 只有 file", () => {
    const out = buildTransferMessage({ history, attachments, includeHistory: false, includeFiles: true });
    expect(out).not.toContain("<context");
    expect(out).toContain("<file");
  });

  it("都不勾 → 空串（调用方据此禁用确认）", () => {
    expect(
      buildTransferMessage({ history, attachments, includeHistory: false, includeFiles: false }),
    ).toBe("");
  });

  it("勾了但历史/附件为空 → 不产生空 context/file（空串）", () => {
    expect(
      buildTransferMessage({ history: [], attachments: [], includeHistory: true, includeFiles: true }),
    ).toBe("");
  });
});
