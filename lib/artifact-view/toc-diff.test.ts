/**
 * toc-diff 单测（第三轮 T1 / D-R3-03/04）：把两版正文算成带 diff 标记的目录序列。
 * 覆盖：纯新增章 / 纯删除章 / 章内容改 / 标题未变 / 嵌套冒泡 / 改名 del+add / 真同名顺序配对 /
 * 首版(base 空) / 空白格式改动算改 / 去重后缀错位规避 / 合并序列 del 插入位置。
 */
import { describe, expect, it } from "vitest";
import { computeTocDiff, parseTocWithLines, type TocDiffItem } from "./toc-diff";

/** 取 (text,diffKind,side) 三元组便于断言（忽略 slug/line 细节）。 */
function shape(items: TocDiffItem[]) {
  return items.map((i) => ({ text: i.text, kind: i.diffKind, side: i.side }));
}

describe("parseTocWithLines", () => {
  it("逐行解析标题并带行号（行号 = splitLines 下标）", () => {
    const toc = parseTocWithLines("# 一\n正文\n## 二\n### 三");
    expect(toc).toEqual([
      { level: 1, text: "一", slug: "一", line: 0 },
      { level: 2, text: "二", slug: "二", line: 2 },
      { level: 3, text: "三", slug: "三", line: 3 },
    ]);
  });

  it("跳过围栏代码块内的 # 行（与 toc.ts 同源）", () => {
    const toc = parseTocWithLines("# 真\n```\n# 假\n```\n## 子");
    expect(toc.map((t) => t.text)).toEqual(["真", "子"]);
    // “## 子”在第 4 行（0-based）。
    expect(toc[1].line).toBe(4);
  });

  it("同名标题 slug 去重加后缀（与 toc.ts 同源）", () => {
    const toc = parseTocWithLines("# 概述\n# 概述");
    expect(toc.map((t) => t.slug)).toEqual(["概述", "概述-1"]);
  });
});

describe("computeTocDiff", () => {
  it("纯新增章节 → add", () => {
    const oldC = "# A\n正文 a\n";
    const newC = "# A\n正文 a\n## B\n正文 b\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: null, side: "target" },
      { text: "B", kind: "add", side: "target" },
    ]);
  });

  it("纯删除章节 → del（side='base'，插在正确位置）", () => {
    const oldC = "# A\n正文 a\n## B\n正文 b\n";
    const newC = "# A\n正文 a\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: null, side: "target" },
      { text: "B", kind: "del", side: "base" },
    ]);
  });

  it("章节正文改动 → mod（标题本身不变）", () => {
    const oldC = "# A\n旧正文\n# B\nb 不变\n";
    const newC = "# A\n新正文\n# B\nb 不变\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: "mod", side: "target" },
      { text: "B", kind: null, side: "target" },
    ]);
  });

  it("标题与正文全未变 → null", () => {
    const same = "# A\n正文 a\n## B\n正文 b\n";
    expect(shape(computeTocDiff(same, same))).toEqual([
      { text: "A", kind: null, side: "target" },
      { text: "B", kind: null, side: "target" },
    ]);
  });

  it("嵌套：h3 子章节正文改动冒泡标父 h2 为 mod", () => {
    const oldC = "## 父\n父正文\n### 子\n旧子正文\n## 邻\n邻正文\n";
    const newC = "## 父\n父正文\n### 子\n新子正文\n## 邻\n邻正文\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "父", kind: "mod", side: "target" }, // 子区间被父区间包含 → 冒泡
      { text: "子", kind: "mod", side: "target" }, // 子自身区间也含改动行
      { text: "邻", kind: null, side: "target" }, // 邻章节未受影响
    ]);
  });

  it("标题改名 → 自然拆成 del + add 两条（不模糊匹配）", () => {
    const oldC = "# A\n正文\n## 背景\n背景正文\n";
    const newC = "# A\n正文\n## 项目背景\n背景正文\n";
    const result = shape(computeTocDiff(oldC, newC));
    // A 未变；“背景”被删、“项目背景”新增（del 挂在 A 之后、add 在 target 顺序里）。
    expect(result).toContainEqual({ text: "A", kind: null, side: "target" });
    expect(result).toContainEqual({ text: "项目背景", kind: "add", side: "target" });
    expect(result).toContainEqual({ text: "背景", kind: "del", side: "base" });
    expect(result.length).toBe(3);
  });

  it("真·同名同级章节按出现顺序配对（只标被改的那个）", () => {
    // 两个同名同级 “## 步骤”：第 1 个正文改、第 2 个正文不变。
    const oldC = "## 步骤\n旧步骤一\n## 步骤\n步骤二不变\n";
    const newC = "## 步骤\n新步骤一\n## 步骤\n步骤二不变\n";
    const result = computeTocDiff(oldC, newC);
    // 两条都叫“步骤”、side=target；按顺序：第 1 个 mod、第 2 个 null。
    expect(result.map((i) => ({ text: i.text, kind: i.diffKind }))).toEqual([
      { text: "步骤", kind: "mod" },
      { text: "步骤", kind: null },
    ]);
  });

  it("真·同名同级：删掉第一个，第二个仍存活（顺序配对不误判）", () => {
    const oldC = "## 步骤\n步骤一\n## 步骤\n步骤二\n";
    const newC = "## 步骤\n步骤二\n";
    // base 第 1 个“步骤”(占行 0-1) 被删；newC 唯一“步骤”应配 base 第 1 个（桶内序号 0），
    // 即 base 第 2 个“步骤”(占行 2-3) 落空成 del。
    const result = shape(computeTocDiff(oldC, newC));
    expect(result).toContainEqual({ text: "步骤", kind: "mod", side: "target" });
    expect(result.filter((i) => i.side === "base" && i.kind === "del").length).toBe(1);
    expect(result.length).toBe(2);
  });

  it("首版（base 为空）→ 全部 add", () => {
    const newC = "# A\n正文 a\n## B\n正文 b\n";
    expect(shape(computeTocDiff("", newC))).toEqual([
      { text: "A", kind: "add", side: "target" },
      { text: "B", kind: "add", side: "target" },
    ]);
  });

  it("整篇删空（target 为空）→ 全部 del", () => {
    const oldC = "# A\n正文 a\n## B\n正文 b\n";
    expect(shape(computeTocDiff(oldC, ""))).toEqual([
      { text: "A", kind: "del", side: "base" },
      { text: "B", kind: "del", side: "base" },
    ]);
  });

  it("空白行/格式改动也算章节改动 → mod", () => {
    // 仅在 A 章节正文里插一空行，标题与文字未动。
    const oldC = "# A\n正文 a\n# B\nb 不变\n";
    const newC = "# A\n正文 a\n\n# B\nb 不变\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: "mod", side: "target" },
      { text: "B", kind: null, side: "target" },
    ]);
  });

  it("去重后缀错位规避：在两个同名章节之间插新章节，原同名章节不被误判改动", () => {
    // 旧：概述 / 概述（slug 概述、概述-1）；
    // 新：概述 / 新章 / 概述（slug 概述、新章、概述-1，第二个概述 slug 不变但位置后移）。
    // 用 text+level 对齐（非 slug），两个“概述”都应配对成功、正文未变 → null；只“新章”是 add。
    const oldC = "# 概述\n概述一\n# 概述\n概述二\n";
    const newC = "# 概述\n概述一\n# 新章\n新章正文\n# 概述\n概述二\n";
    const result = computeTocDiff(oldC, newC);
    expect(result.map((i) => ({ text: i.text, kind: i.diffKind }))).toEqual([
      { text: "概述", kind: null },
      { text: "新章", kind: "add" },
      { text: "概述", kind: null },
    ]);
  });

  it("合并序列：del 插到其前一个存活标题之后（夹在中间的删除）", () => {
    // 旧：A / B / C；新：A / C（删 B）。B 的 del 应排在 A 之后、C 之前。
    const oldC = "# A\na\n# B\nb\n# C\nc\n";
    const newC = "# A\na\n# C\nc\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: null, side: "target" },
      { text: "B", kind: "del", side: "base" },
      { text: "C", kind: null, side: "target" },
    ]);
  });

  it("合并序列：首章被删 → del 插到序列开头", () => {
    const oldC = "# A\na\n# B\nb\n";
    const newC = "# B\nb\n";
    expect(shape(computeTocDiff(oldC, newC))).toEqual([
      { text: "A", kind: "del", side: "base" },
      { text: "B", kind: null, side: "target" },
    ]);
  });

  it("两版均无标题 → 空序列", () => {
    expect(computeTocDiff("纯正文\n没有标题\n", "改了的纯正文\n")).toEqual([]);
  });
});
