/**
 * degrade 单测（AC④）：pending 块数 > INLINE_HL_LIMIT(25) 时降级为并排 Diff；
 * countPendingBlocks 只数 state==="pending" 的块。
 */
import { describe, expect, it } from "vitest";
import { INLINE_HL_LIMIT, shouldDegradeToDiff, countPendingBlocks } from "./degrade";
import type { DiffBlock } from "@/lib/domain/pending-change-service";

function mkBlocks(states: DiffBlock["state"][]): DiffBlock[] {
  return states.map((state, i) => ({ id: `b${i}`, kind: "add", lines: ["x"], state }));
}

describe("INLINE_HL_LIMIT", () => {
  it("阈值为 25（与 sf-mini 对齐）", () => {
    expect(INLINE_HL_LIMIT).toBe(25);
  });
});

describe("shouldDegradeToDiff", () => {
  it("等于阈值不降级（> 而非 >=）", () => {
    expect(shouldDegradeToDiff(25)).toBe(false);
  });

  it("超过阈值降级", () => {
    expect(shouldDegradeToDiff(26)).toBe(true);
  });

  it("0 块不降级", () => {
    expect(shouldDegradeToDiff(0)).toBe(false);
  });
});

describe("countPendingBlocks", () => {
  it("只统计 state==='pending'", () => {
    const blocks = mkBlocks(["pending", "confirmed", "pending", "rejected"]);
    expect(countPendingBlocks(blocks)).toBe(2);
  });

  it("空数组 → 0", () => {
    expect(countPendingBlocks([])).toBe(0);
  });
});
