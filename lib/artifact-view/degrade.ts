/**
 * 行内高亮降级判定（AC④）：pending 块数超过阈值时，行内高亮会让正文支离破碎、
 * 性能与可读性都差，自动降级为并排 Diff 视图。阈值取 sf-mini 的 INLINE_HL_LIMIT = 25。
 */
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/** 行内高亮的块数上限（含）；超过则降级并排 Diff。源自 sf-mini RequirementView。 */
export const INLINE_HL_LIMIT = 25;

/**
 * 是否应从行内高亮降级到并排 Diff：pending 块数 > INLINE_HL_LIMIT 即降级。
 * 入参是「待渲染的 pending 块数」（调用方已按 state==="pending" 过滤）。纯函数，便于单测。
 */
export function shouldDegradeToDiff(pendingBlockCount: number): boolean {
  return pendingBlockCount > INLINE_HL_LIMIT;
}

/** 统计一组块里 state==="pending" 的数量（渲染层据此决定高亮 / 降级）。纯函数。 */
export function countPendingBlocks(blocks: DiffBlock[]): number {
  return blocks.filter((b) => b.state === "pending").length;
}
