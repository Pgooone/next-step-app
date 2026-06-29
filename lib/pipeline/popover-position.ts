/**
 * 浮层边界感知定位（N2）：两阶段浮层（StageHoverPreview / StageSessionMenu）都被
 * `PipelineModal:overflow:hidden` 裁切 → 改用 `position:fixed` 脱离裁切容器，
 * 锚父卡 `getBoundingClientRect`，下方放不下翻上方、右侧不足左收、钳制进视口。
 *
 * 纯函数（不碰 DOM），便于复用 + 单测；调用方在 `useLayoutEffect` 里测 rect 后调用。
 */

export interface FixedPopoverPlacement {
  /** fixed left（px，已钳制进视口）。 */
  left: number;
  /** below 时的 fixed top（px）；above 时为 null。 */
  top: number | null;
  /**
   * above 时的 fixed bottom（px，距视口底）；below 时为 null。
   * above 用 bottom 锚（浮层底边钉在锚上沿、内容向上生长）而非 top——否则内容比 maxHeight 矮的短浮层
   * 会被 `top = anchor.top - maxHeight` 顶到视口顶部、远离锚点（真浏览器验收 B2 暴露并修正）。
   */
  bottom: number | null;
  /** 该侧可用空间约束后的 maxHeight（px）；内部 overflow-y:auto 在此高度内滚动。 */
  maxHeight: number;
  /** 是否向上展开（below 放不下且 above 更宽时为 true）；调用方据此选用 top / bottom。 */
  above: boolean;
}

/**
 * @param anchor 锚元素（父卡）的视口坐标 rect。
 * @param width  浮层宽度（px）。
 * @param maxHeightCap 期望最大高度（px）；最终 maxHeight = min(cap, 选中侧可用空间)。
 * @param opts.gap 浮层与锚之间的间隙（默认 6）。
 * @param opts.margin 距视口边缘的安全边距（默认 8）。
 * @param opts.viewportW/viewportH 视口尺寸（默认取 window；便于测试注入）。
 */
export function computeFixedPopover(
  anchor: { top: number; bottom: number; left: number },
  width: number,
  maxHeightCap: number,
  opts: {
    gap?: number;
    margin?: number;
    viewportW?: number;
    viewportH?: number;
  } = {},
): FixedPopoverPlacement {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const viewportW =
    opts.viewportW ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const viewportH =
    opts.viewportH ?? (typeof window !== "undefined" ? window.innerHeight : 768);

  // 垂直：优先下方；下方可用 < 上方可用时翻上方。
  const spaceBelow = viewportH - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const above = spaceBelow < spaceAbove;

  const avail = Math.max(0, above ? spaceAbove : spaceBelow);
  const maxHeight = Math.max(0, Math.min(maxHeightCap, avail));

  // below：top 锚锚底下方；above：bottom 锚（底边钉锚上沿、内容向上长，短浮层不飘视口顶）。
  const top = above ? null : anchor.bottom + gap;
  const bottom = above ? Math.max(margin, viewportH - (anchor.top - gap)) : null;

  // 水平：默认与锚左对齐；右侧放不下则左收；再钳制 >= margin。
  let left = anchor.left;
  if (left + width > viewportW - margin) left = viewportW - margin - width;
  if (left < margin) left = margin;

  return { left, top, bottom, maxHeight, above };
}
