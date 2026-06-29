import { describe, it, expect } from "vitest";
import { sliceByCodePoint, codePointLength } from "./code-point-slice";

describe("sliceByCodePoint", () => {
  it("slices plain ASCII by character count", () => {
    expect(sliceByCodePoint("hello", 0)).toBe("");
    expect(sliceByCodePoint("hello", 3)).toBe("hel");
    expect(sliceByCodePoint("hello", 99)).toBe("hello");
  });

  it("slices CJK by character (not byte)", () => {
    expect(sliceByCodePoint("派一次多 Agent 协作", 3)).toBe("派一次");
  });

  it("never splits a surrogate-pair emoji in half", () => {
    // "🚀文" = 1 emoji (2 UTF-16 code units) + 1 CJK char
    const s = "🚀文";
    // taking 1 code point must yield the whole emoji, never a lone surrogate
    expect(sliceByCodePoint(s, 1)).toBe("🚀");
    expect(sliceByCodePoint(s, 2)).toBe("🚀文");
    // a half-surrogate would have length 1 in UTF-16; assert we never produce that
    expect([...sliceByCodePoint(s, 1)].length).toBe(1);
  });

  it("treats negative count as empty", () => {
    expect(sliceByCodePoint("hello", -1)).toBe("");
  });
});

describe("codePointLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("hello")).toBe(5);
    expect(codePointLength("派一次")).toBe(3);
    expect(codePointLength("🚀文")).toBe(2); // emoji counts as 1
  });
});
