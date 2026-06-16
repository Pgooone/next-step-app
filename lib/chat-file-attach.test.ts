/**
 * M2 单测：文本文件分流判断、<file> 拼装、软提示阈值、accept 串。
 * 纯逻辑，不涉及 DOM / FileReader（IO 留在组件层，行为由真浏览器 E2E 覆盖）。
 */
import { describe, expect, it } from "vitest";
import {
  classifyFile,
  isLargeFile,
  buildFileBlock,
  composeMessageWithFiles,
  FILE_INPUT_ACCEPT,
  TEXT_FILE_EXTENSIONS,
  LARGE_FILE_THRESHOLD,
} from "./chat-file-attach";

describe("classifyFile", () => {
  it("image/* 走图片通道", () => {
    expect(classifyFile("a.png", "image/png")).toBe("image");
    expect(classifyFile("photo.jpeg", "image/jpeg")).toBe("image");
  });

  it("白名单扩展名走文本通道（mime 为空也认）", () => {
    expect(classifyFile("readme.md", "text/markdown")).toBe("text");
    expect(classifyFile("data.json", "")).toBe("text");
    expect(classifyFile("script.sh", "application/octet-stream")).toBe("text");
  });

  it("扩展名大小写不敏感", () => {
    expect(classifyFile("NOTES.MD", "")).toBe("text");
    expect(classifyFile("Q.Sql", "")).toBe("text");
  });

  it("取最后一个点后的扩展名", () => {
    expect(classifyFile("a.b.tsx", "")).toBe("text");
  });

  it("非白名单 / 二进制 / 无扩展名都判为不支持", () => {
    expect(classifyFile("doc.pdf", "application/pdf")).toBe("unsupported");
    expect(classifyFile("sheet.xlsx", "")).toBe("unsupported");
    expect(classifyFile("Makefile", "")).toBe("unsupported");
    expect(classifyFile("archive.zip", "application/zip")).toBe("unsupported");
  });

  it("image/* 优先于扩展名（理论上的 .json 图片也归图片）", () => {
    expect(classifyFile("weird.json", "image/png")).toBe("image");
  });
});

describe("isLargeFile", () => {
  it("阈值 = 256KB，等于不触发，超过才触发", () => {
    expect(LARGE_FILE_THRESHOLD).toBe(262144);
    expect(isLargeFile(LARGE_FILE_THRESHOLD)).toBe(false);
    expect(isLargeFile(LARGE_FILE_THRESHOLD + 1)).toBe(true);
    expect(isLargeFile(0)).toBe(false);
  });
});

describe("buildFileBlock", () => {
  it("拼成内核官方 <file> 格式（前后各一换行）", () => {
    expect(buildFileBlock("a.txt", "hello")).toBe('<file name="a.txt">\nhello\n</file>');
  });

  it("多行内容原样保留", () => {
    expect(buildFileBlock("x.py", "line1\nline2")).toBe(
      '<file name="x.py">\nline1\nline2\n</file>',
    );
  });
});

describe("composeMessageWithFiles", () => {
  it("无附件原样返回正文", () => {
    expect(composeMessageWithFiles("hi", [])).toBe("hi");
  });

  it("正文 + 单附件：正文在前，空行隔开 <file>", () => {
    expect(composeMessageWithFiles("看这个", [{ name: "a.txt", content: "C" }])).toBe(
      '看这个\n\n<file name="a.txt">\nC\n</file>',
    );
  });

  it("多附件按顺序换行拼接", () => {
    expect(
      composeMessageWithFiles("", [
        { name: "a.txt", content: "A" },
        { name: "b.md", content: "B" },
      ]),
    ).toBe('<file name="a.txt">\nA\n</file>\n<file name="b.md">\nB\n</file>');
  });

  it("正文为空只发 <file> 块（不带前导空行）", () => {
    expect(composeMessageWithFiles("", [{ name: "a.txt", content: "C" }])).toBe(
      '<file name="a.txt">\nC\n</file>',
    );
  });
});

describe("FILE_INPUT_ACCEPT", () => {
  it("含 image/* 与全部文本白名单扩展名", () => {
    expect(FILE_INPUT_ACCEPT.startsWith("image/*,")).toBe(true);
    for (const ext of TEXT_FILE_EXTENSIONS) {
      expect(FILE_INPUT_ACCEPT).toContain(ext);
    }
  });
});
