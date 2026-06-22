/**
 * version-diff 单测（第二轮 T1）：computeVersionDiffBlocks 是 computeReplaceDiffBlocks 的
 * 客户端安全等价物。核心一致性测试对多对 (old,new) 断言两者产出的块序列
 * kind/lines/oldLines **完全一致**（id 不比——一方 randomUUID、一方确定性序号）。
 *
 * 测试在 node 环境跑，故 computeReplaceDiffBlocks（server-only、引 node:fs/crypto）可值导入；
 * 但被测的 computeVersionDiffBlocks 只导 lcs.ts，是生产里客户端唯一会拉到的那份。
 */
import { describe, expect, it } from "vitest";
import { computeVersionDiffBlocks } from "./version-diff";
import { computeReplaceDiffBlocks } from "../domain/pending-change-service";
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/**
 * 取块序列里参与一致性比对的字段：只比 kind/lines/oldLines。
 * id（一方 randomUUID、一方确定性序号）与 state（写盘端恒 pending、版本 diff 恒 confirmed，
 * D-R2-01 刻意不同）均排除。
 */
function structuralShape(blocks: DiffBlock[]): Array<Pick<DiffBlock, "kind" | "lines" | "oldLines">> {
  return blocks.map(({ kind, lines, oldLines }) => ({ kind, lines, oldLines }));
}

describe("computeVersionDiffBlocks", () => {
  describe("与 computeReplaceDiffBlocks 块序列一致（kind/lines/oldLines，id 与 state 除外）", () => {
    const cases: Array<{ name: string; old: string; next: string }> = [
      { name: "纯新增（空→非空）", old: "", next: "甲\n乙\n丙\n" },
      { name: "纯删除（非空→空）", old: "甲\n乙\n丙\n", next: "" },
      { name: "中间插入新行（纯 add 块）", old: "甲\n丙\n", next: "甲\n乙\n丙\n" },
      { name: "中间删除一行（纯 del 块）", old: "甲\n乙\n丙\n", next: "甲\n丙\n" },
      { name: "修改一行（mod 块：del+add 合并）", old: "甲\n乙\n丙\n", next: "甲\n改过的乙\n丙\n" },
      { name: "改开头一行", old: "甲\n乙\n丙\n", next: "新甲\n乙\n丙\n" },
      { name: "改结尾一行", old: "甲\n乙\n丙\n", next: "甲\n乙\n新丙\n" },
      {
        name: "多块混合（开头 mod + 中段 add + 结尾 del）",
        old: "甲\n乙\n丙\n丁\n戊\n",
        next: "新甲\n乙\n中插\n丙\n丁\n",
      },
      {
        name: "纯英文多块",
        old: "alpha\nbeta\ngamma\ndelta\n",
        next: "ALPHA\nbeta\ninserted\ngamma\n",
      },
      {
        name: "中文长文多段改动",
        old: "第一段保持\n第二段要改\n第三段保持\n第四段要删\n第五段保持\n",
        next: "第一段保持\n第二段已改\n第三段保持\n第五段保持\n新增末段\n",
      },
      { name: "整篇替换（无公共行）", old: "a\nb\nc\n", next: "x\ny\nz\n" },
      { name: "无末尾换行 vs 有末尾换行", old: "甲\n乙", next: "甲\n乙\n丙" },
    ];

    for (const { name, old, next } of cases) {
      it(name, () => {
        const got = computeVersionDiffBlocks(old, next);
        const want = computeReplaceDiffBlocks(old, next);
        expect(structuralShape(got)).toEqual(structuralShape(want));
      });
    }
  });

  describe("边界", () => {
    it("两侧皆空 → 空数组", () => {
      expect(computeVersionDiffBlocks("", "")).toEqual([]);
    });

    it("相同内容 → 空数组", () => {
      const content = "甲\n乙\n丙\n";
      expect(computeVersionDiffBlocks(content, content)).toEqual([]);
      // 与写盘端对齐：相同内容 computeReplaceDiffBlocks 也产出空。
      expect(computeReplaceDiffBlocks(content, content)).toEqual([]);
    });
  });

  describe("id 与 state 约定（D-R2-01）", () => {
    it("id 为确定性序号 v-${idx}、state 为 confirmed（非 pending）", () => {
      const blocks = computeVersionDiffBlocks("甲\n乙\n丙\n丁\n戊\n", "新甲\n乙\n中插\n丙\n丁\n");
      expect(blocks.length).toBeGreaterThan(1);
      blocks.forEach((b, idx) => {
        expect(b.id).toBe(`v-${idx}`);
        expect(b.state).toBe("confirmed");
      });
    });

    it("同一对 (old,new) 多次调用 id 稳定（确定性、非随机 UUID）", () => {
      const a = computeVersionDiffBlocks("甲\n乙\n", "甲\n丙\n");
      const b = computeVersionDiffBlocks("甲\n乙\n", "甲\n丙\n");
      expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    });
  });
});
