/**
 * anchor 单测（AC②③）：子序列查找 + 把 pending 块就近锚定到裸文本行切成有序渲染段。
 * 覆盖 add/del/mod 锚定、找不到收 unaligned、del 就近插入、空 needle、mod 旧行透出。
 */
import { describe, expect, it } from "vitest";
import { findSubsequence, buildSegments } from "./anchor";
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/** 造一个 DiffBlock fixture（默认 state=pending）。 */
function block(kind: DiffBlock["kind"], lines: string[], oldLines?: string[]): DiffBlock {
  return {
    id: `${kind}-${lines.join("|")}`,
    kind,
    lines,
    ...(oldLines !== undefined ? { oldLines } : {}),
    state: "pending",
  };
}

describe("findSubsequence", () => {
  it("命中：返回连续子序列起点", () => {
    expect(findSubsequence(["a", "b", "c", "d"], ["b", "c"], 0)).toBe(1);
  });

  it("从 from 之后才找（前面的命中被跳过）", () => {
    expect(findSubsequence(["x", "x", "x"], ["x"], 1)).toBe(1);
  });

  it("找不到返回 -1", () => {
    expect(findSubsequence(["a", "b"], ["c"], 0)).toBe(-1);
  });

  it("空 needle 返回 -1", () => {
    expect(findSubsequence(["a"], [], 0)).toBe(-1);
  });

  it("needle 越界（比剩余长）返回 -1", () => {
    expect(findSubsequence(["a", "b"], ["a", "b", "c"], 0)).toBe(-1);
  });
});

describe("buildSegments", () => {
  it("无 pending 块：整篇是一个 plain 段", () => {
    const { segs, unaligned } = buildSegments("l1\nl2\nl3", []);
    expect(unaligned).toEqual([]);
    expect(segs).toEqual([{ type: "plain", text: "l1\nl2\nl3" }]);
  });

  it("add 块命中：被锚定为 hl 段、前后切成 plain", () => {
    const content = "a\nNEW\nb";
    const { segs, unaligned } = buildSegments(content, [block("add", ["NEW"])]);
    expect(unaligned).toEqual([]);
    expect(segs.map((s) => s.type)).toEqual(["plain", "hl", "plain"]);
    const hl = segs[1];
    expect(hl.type === "hl" && hl.text).toBe("NEW");
    expect(hl.type === "hl" && hl.block.kind).toBe("add");
    expect(hl.type === "hl" && hl.removed).toEqual([]);
  });

  it("mod 块：lines 锚定到正文、oldLines 透出到 removed", () => {
    const content = "head\nNEWLINE\ntail";
    const { segs } = buildSegments(content, [block("mod", ["NEWLINE"], ["OLDLINE"])]);
    const hl = segs.find((s) => s.type === "hl");
    expect(hl && hl.type === "hl" && hl.text).toBe("NEWLINE");
    expect(hl && hl.type === "hl" && hl.removed).toEqual(["OLDLINE"]);
  });

  it("del 块：text 为空、removed = 自身 lines、按游标就近插入", () => {
    const content = "keep1\nkeep2";
    const { segs } = buildSegments(content, [block("del", ["GONE"])]);
    // del 在 cursor=0 插入 → 排在最前
    const first = segs[0];
    expect(first.type === "hl" && first.block.kind).toBe("del");
    expect(first.type === "hl" && first.text).toBe("");
    expect(first.type === "hl" && first.removed).toEqual(["GONE"]);
  });

  it("锚不到的 add 块进 unaligned，不污染正文", () => {
    const content = "a\nb";
    const b = block("add", ["NOT-IN-DOC"]);
    const { segs, unaligned } = buildSegments(content, [b]);
    expect(unaligned).toEqual([b]);
    expect(segs).toEqual([{ type: "plain", text: "a\nb" }]);
  });

  it("空 lines 的 add 块进 unaligned", () => {
    const { unaligned } = buildSegments("a", [block("add", [])]);
    expect(unaligned.length).toBe(1);
  });

  it("多块顺序锚定：游标单调前移，第二块只在第一块之后匹配", () => {
    const content = "x\nDUP\ny\nDUP\nz";
    const b1 = block("add", ["DUP"]);
    const b2 = block("add", ["DUP"]);
    const { segs } = buildSegments(content, [b1, b2]);
    const hlOwners = segs.filter((s) => s.type === "hl").map((s) => (s.type === "hl" ? s.block : null));
    // 两个 DUP 分别归属 b1、b2（游标前移避免都落到第一个 DUP）
    expect(hlOwners).toEqual([b1, b2]);
  });
});
