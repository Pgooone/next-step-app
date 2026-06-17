import { describe, it, expect } from "vitest";
import { composeQuotedMessage } from "./chat-quote";

describe("composeQuotedMessage", () => {
  it("引用在前、正文在后，用两个换行分隔", () => {
    expect(composeQuotedMessage("某段引用", "我的问题")).toBe("【引用：某段引用】\n\n我的问题");
  });

  it("引用为 undefined 时原样返回正文（跳过注入）", () => {
    expect(composeQuotedMessage(undefined, "我的问题")).toBe("我的问题");
  });

  it("引用为纯空白时跳过注入", () => {
    expect(composeQuotedMessage("   \n  ", "我的问题")).toBe("我的问题");
  });

  it("引用文本两端空白被 trim，正文原样不动", () => {
    expect(composeQuotedMessage("  引用  ", "  正文带空格  ")).toBe("【引用：引用】\n\n  正文带空格  ");
  });

  it("正文为空但有引用时只拼引用头（quote-only 由调用方拦截，函数本身不报错）", () => {
    expect(composeQuotedMessage("引用", "")).toBe("【引用：引用】\n\n");
  });

  it("正文含 <file> 附件块时引用拼在最前面，附件块顺序不变", () => {
    const withFile = '正文\n\n<file name="a.txt">\nC\n</file>';
    expect(composeQuotedMessage("引用", withFile)).toBe(`【引用：引用】\n\n${withFile}`);
  });
});
