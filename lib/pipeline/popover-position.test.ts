import { describe, it, expect } from "vitest";
import { computeFixedPopover } from "./popover-position";

/**
 * T2·N2 浮层边界感知定位纯函数的逻辑层单测（独立 verifier，非实现者自跑）。
 * 覆盖：默认下方展开 / 下方不足翻上方 / 右侧不足左收 / 左边越界钳制 / maxHeight 按可用空间钳。
 * 视口尺寸用 opts 注入，断言确定（不依赖 window）。
 */
const VP = { viewportW: 1000, viewportH: 800 }; // gap 默认 6、margin 默认 8

describe("computeFixedPopover", () => {
  it("锚靠上：下方空间更大 → 向下展开（above=false），top=锚底+gap、左对齐锚", () => {
    const p = computeFixedPopover({ top: 100, bottom: 140, left: 50 }, 330, 330, VP);
    expect(p.above).toBe(false);
    expect(p.top).toBe(146); // 140 + gap6
    expect(p.bottom).toBeNull(); // below 用 top 锚
    expect(p.left).toBe(50);
    expect(p.maxHeight).toBe(330); // min(cap330, spaceBelow=800-140-6-8=646)
  });

  it("锚靠下：下方不足 → 翻上方（above=true），用 bottom 锚（底边钉锚上沿）、top 为 null", () => {
    const p = computeFixedPopover({ top: 700, bottom: 740, left: 50 }, 330, 330, VP);
    expect(p.above).toBe(true);
    // spaceBelow=46 < spaceAbove=686 → 翻上；maxHeight=min(330,686)=330；bottom=viewportH-(anchor.top-gap)=800-694=106
    expect(p.maxHeight).toBe(330);
    expect(p.top).toBeNull();
    expect(p.bottom).toBe(106);
  });

  it("右侧放不下 → 左收到 viewportW-margin-width", () => {
    const p = computeFixedPopover({ top: 100, bottom: 140, left: 900 }, 330, 330, VP);
    // 900+330=1230 > 1000-8=992 → left=1000-8-330=662
    expect(p.left).toBe(662);
  });

  it("左收后仍越左边界 → 钳到 margin", () => {
    const p = computeFixedPopover({ top: 100, bottom: 140, left: 900 }, 330, 330, {
      viewportW: 300,
      viewportH: 800,
    });
    // 300-8-330=-38 < 8 → 钳到 8
    expect(p.left).toBe(8);
  });

  it("可用空间 < cap → maxHeight 钳到该侧可用空间", () => {
    const p = computeFixedPopover({ top: 50, bottom: 90, left: 0 }, 330, 330, {
      viewportW: 1000,
      viewportH: 200,
    });
    // spaceBelow=200-90-6-8=96 > spaceAbove=50-6-8=36 → 下方；maxHeight=min(330,96)=96
    expect(p.above).toBe(false);
    expect(p.maxHeight).toBe(96);
  });

  it("可用空间为负 → maxHeight 钳到 0（不出现负高度）", () => {
    const p = computeFixedPopover({ top: 4, bottom: 798, left: 0 }, 330, 330, VP);
    // 上下都几乎无空间：spaceBelow=-12 < spaceAbove=-10 → above=true，avail=max(0,-10)=0 → maxHeight 钳 0
    expect(p.maxHeight).toBe(0);
  });
});
