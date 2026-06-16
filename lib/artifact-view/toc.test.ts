/**
 * toc 单测（AC①）：从 Markdown 解析标题层级 + slug 去重 + 跳过代码块 + slugify 保中文。
 */
import { describe, expect, it } from "vitest";
import { parseToc, slugify } from "./toc";

describe("slugify", () => {
  it("空白转连字符、去符号、小写", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("保留中文，去掉标点", () => {
    expect(slugify("第一章：背景")).toBe("第一章背景");
  });

  it("折叠多余连字符与首尾连字符", () => {
    expect(slugify("  a -- b  ")).toBe("a-b");
  });

  it("纯符号 → 空串", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("parseToc", () => {
  it("解析多级 ATX 标题，带 level/text/slug", () => {
    const toc = parseToc("# 标题一\n正文\n## 子标题\n### 三级");
    expect(toc).toEqual([
      { level: 1, text: "标题一", slug: "标题一" },
      { level: 2, text: "子标题", slug: "子标题" },
      { level: 3, text: "三级", slug: "三级" },
    ]);
  });

  it("同名标题 slug 去重加后缀", () => {
    const toc = parseToc("# 概述\n# 概述\n# 概述");
    expect(toc.map((t) => t.slug)).toEqual(["概述", "概述-1", "概述-2"]);
  });

  it("跳过围栏代码块内的 # 行", () => {
    const toc = parseToc("# 真标题\n```\n# 这是代码注释不是标题\n```\n## 真子标题");
    expect(toc.map((t) => t.text)).toEqual(["真标题", "真子标题"]);
  });

  it("非标题行与空标题被忽略", () => {
    const toc = parseToc("普通段落\n#没有空格不算\n#   \n## 有效");
    expect(toc.map((t) => t.text)).toEqual(["有效"]);
  });

  it("去掉标题尾部的闭合 #", () => {
    const toc = parseToc("## 标题 ##");
    expect(toc).toEqual([{ level: 2, text: "标题", slug: "标题" }]);
  });

  it("超过 6 级的 # 不识别为标题", () => {
    expect(parseToc("####### 七级")).toEqual([]);
  });
});
