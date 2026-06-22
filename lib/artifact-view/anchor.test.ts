/**
 * anchor 单测：buildLineDiffSegments 按 PendingChange 的 LCS ops（oldContent→newContent）
 * 真实顺序产出渲染段。用真实流程造数据（computeReplaceDiffBlocks → buildLineDiffSegments），
 * 覆盖 mod/add/del/合并成 mod/改开头，断言 change 段携带与 blocks 同序同 id 的块、无 unaligned 损耗。
 */
import { describe, expect, it } from "vitest";
import { buildLineDiffSegments } from "./anchor";
import type { DiffBlock } from "@/lib/domain/pending-change-service";
import { computeReplaceDiffBlocks } from "../domain/pending-change-service";

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
