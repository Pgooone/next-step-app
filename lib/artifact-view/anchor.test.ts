/**
 * anchor 单测（AC②③）：子序列查找 + 把 pending 块就近锚定到裸文本行切成有序渲染段。
 * 覆盖 add/del/mod 锚定、找不到收 unaligned、del 就近插入、空 needle、mod 旧行透出。
 */
import { describe, expect, it } from "vitest";
import { findSubsequence, buildSegments, buildLineDiffSegments } from "./anchor";
import type { DiffBlock } from "@/lib/domain/pending-change-service";
import { computeReplaceDiffBlocks } from "../domain/pending-change-service";

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

  it("changeIdByBlock：命中块的 hl 段带 changeId；不传时为 undefined（T2 承重墙）", () => {
    const content = "a\nNEW\nb";
    const b = block("add", ["NEW"]);
    // 传入映射 → hl 段携带 changeId
    const withMap = buildSegments(content, [b], new Map([[b.id, "chg-1"]]));
    const hl = withMap.segs.find((s) => s.type === "hl");
    expect(hl && hl.type === "hl" && hl.changeId).toBe("chg-1");
    // 不传第三参 → 向后兼容，changeId 为 undefined
    const noMap = buildSegments(content, [b]);
    const hl2 = noMap.segs.find((s) => s.type === "hl");
    expect(hl2 && hl2.type === "hl" && hl2.changeId).toBeUndefined();
  });
});

describe("buildLineDiffSegments", () => {
  // 用真实流程造数据：computeReplaceDiffBlocks(old, new) 得到 blocks（含真实 block.id），
  // 再 buildLineDiffSegments(old, new, blocks)。断言 change 段携带与 blocks 同序同 id 的块、
  // equal 段按 LCS 真实顺序穿插、不丢任何 block、不依赖 unaligned 概念。

  /** 取所有 change 段的 block（顺序 = 渲染顺序）。 */
  function changeBlocks(segs: ReturnType<typeof buildLineDiffSegments>): DiffBlock[] {
    return segs.flatMap((s) => (s.type === "change" ? [s.block] : []));
  }
  /** 取所有 equal 段文本（顺序 = 渲染顺序）。 */
  function equalTexts(segs: ReturnType<typeof buildLineDiffSegments>): string[] {
    return segs.flatMap((s) => (s.type === "equal" ? [s.text] : []));
  }

  it("mod 改一行：equal '甲' → change(mod) → equal '丙'，block.id 对齐", () => {
    const oldContent = "甲\n乙\n丙\n";
    const newContent = "甲\n改过的乙\n丙\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);

    expect(segs.map((s) => s.type)).toEqual(["equal", "change", "equal"]);
    expect(equalTexts(segs)).toEqual(["甲", "丙"]);
    const change = segs[1];
    expect(change.type === "change" && change.block.kind).toBe("mod");
    expect(change.type === "change" && change.block.id).toBe(blocks[0].id);
    // change 段携带的 block 与 blocks 同序同 id
    expect(changeBlocks(segs).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it("add 插一段：change(add) 落在前后正文之间、id ∈ blocks、顺序正确", () => {
    const oldContent = "标题\n第一段\n第二段\n";
    const newContent = "标题\n第一段\n新插入段\n第二段\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);

    // equal '标题\n第一段' → change(add) → equal '第二段'
    expect(segs.map((s) => s.type)).toEqual(["equal", "change", "equal"]);
    expect(equalTexts(segs)).toEqual(["标题\n第一段", "第二段"]);
    const change = segs[1];
    expect(change.type === "change" && change.block.kind).toBe("add");
    expect(change.type === "change" && change.block.lines).toEqual(["新插入段"]);
    // 该 change 的 block 确实来自 blocks（同序同 id）
    expect(changeBlocks(segs).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it("del 纯删：equal 'a' → change(del) → equal 'c'，block.id 对齐", () => {
    const oldContent = "a\nb\nc\n";
    const newContent = "a\nc\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);

    expect(segs.map((s) => s.type)).toEqual(["equal", "change", "equal"]);
    expect(equalTexts(segs)).toEqual(["a", "c"]);
    const change = segs[1];
    expect(change.type === "change" && change.block.kind).toBe("del");
    expect(change.type === "change" && change.block.id).toBe(blocks[0].id);
    expect(changeBlocks(segs).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it("del+add 合并成 mod：LCS 贪心并成 1 个 change(mod)（与 groupOpsToBlocks 一致）", () => {
    const oldContent = "旧的第一节\n要删除的第二节\n";
    const newContent = "新的第一节\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);

    // 全无公共行 → 一个编辑组（2 del + 1 add）→ 1 个 mod 块，无 equal 段
    expect(segs.length).toBe(1);
    expect(equalTexts(segs)).toEqual([]);
    const only = segs[0];
    expect(only.type === "change" && only.block.kind).toBe("mod");
    expect(changeBlocks(segs).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(blocks.length).toBe(1);
  });

  it("改开头两句：change 在前、equal '尾' 在后、顺序正确", () => {
    const oldContent = "句一\n句二\n尾\n";
    const newContent = "新句一\n新句二\n尾\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);

    // 开头两句被改 → change 在前；'尾' 是公共行 → equal 在后
    expect(segs.map((s) => s.type)).toEqual(["change", "equal"]);
    expect(equalTexts(segs)).toEqual(["尾"]);
    expect(changeBlocks(segs).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it("无任何 change 段被丢弃：change 段数 === blocks 数（不存在锚不到）", () => {
    const oldContent = "标题\n第一段\n第二段\n";
    const newContent = "标题\n第一段\n新插入段\n第二段\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks);
    // 每个 block 都对应一个 change 段，无 unaligned 损耗
    expect(changeBlocks(segs).length).toBe(blocks.length);
  });

  it("changeIdByBlock 注入：命中块的 change 段带 changeId", () => {
    const oldContent = "甲\n乙\n丙\n";
    const newContent = "甲\n改过的乙\n丙\n";
    const blocks = computeReplaceDiffBlocks(oldContent, newContent);
    const map = new Map([[blocks[0].id, "change-1"]]);
    const segs = buildLineDiffSegments(oldContent, newContent, blocks, map);
    const change = segs.find((s) => s.type === "change");
    expect(change && change.type === "change" && change.changeId).toBe("change-1");
    // 不传 Map → changeId 为 undefined
    const noMap = buildLineDiffSegments(oldContent, newContent, blocks);
    const change2 = noMap.find((s) => s.type === "change");
    expect(change2 && change2.type === "change" && change2.changeId).toBeUndefined();
  });
});
