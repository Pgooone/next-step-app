/**
 * 行内 diff 渲染数据层（第七轮·第二轮纠偏，D-R7B-01）：对 PendingChange 的
 * `oldContent→newContent` 跑与写盘端 applyResolvedBlocks 同一份 LCS，按真实顺序产出渲染段——
 * 改动 run 天然落在前后 equal 上下文之间，不存在「锚不到」（取代旧 buildSegments 子序列重锚、
 * 消除 unaligned 概念）。`block.id` 与 diffBlocks 同序一一对应、对齐不漂移。
 */
import type { DiffBlock } from "@/lib/domain/pending-change-service";
import { lcsDiff, splitLines } from "../domain/lcs";

/** 一段顺序渲染单元：equal（未改动正文，原样）或 change（一个改动块 add/del/mod）。 */
export type LineDiffSegment =
  | { type: "equal"; text: string }
  | { type: "change"; block: DiffBlock; changeId?: string };

/**
 * 按 PendingChange 的 LCS ops（oldContent→newContent）真实顺序产出渲染段：
 * equal 段=未改动正文（原样）、change 段=一个改动块（add/del/mod）。
 * 与 groupOpsToBlocks 用逐字相同的聚块循环，故第 k 个非 equal 编辑组 ↔ diffBlocks[k]，
 * 顺序天然对齐、不存在「锚不到」。changeIdByBlock 可选，命中则注入 changeId（供就地 ✓/✗）。
 *
 * 纯渲染 helper：编辑组取不到对应 diffBlocks[blockIdx]（理论不会发生，blocks 由同一
 * old→new 算出）时跳过该 change 段、不抛异常，避免打断 UI。
 */
export function buildLineDiffSegments(
  oldContent: string,
  newContent: string,
  diffBlocks: DiffBlock[],
  changeIdByBlock?: Map<string, string>,
): LineDiffSegment[] {
  const ops = lcsDiff(splitLines(oldContent), splitLines(newContent));
  const segments: LineDiffSegment[] = [];
  let blockIdx = 0;
  let k = 0;
  // 与 groupOpsToBlocks（pending-change-service.ts）逐字相同的聚块循环：
  // 连续 equal 攒成一个 equal 段；一个「连续 del 段 + 紧跟连续 add 段」= 一个改动块。
  while (k < ops.length) {
    if (ops[k].type === "equal") {
      const lines: string[] = [];
      while (k < ops.length && ops[k].type === "equal") lines.push(ops[k++].line);
      segments.push({ type: "equal", text: lines.join("\n") });
      continue;
    }
    // 消费一个编辑组（连续 del + 紧跟连续 add），与 groupOpsToBlocks 对齐
    while (k < ops.length && ops[k].type === "del") k++;
    while (k < ops.length && ops[k].type === "add") k++;
    const block = diffBlocks[blockIdx++];
    if (block) {
      segments.push({ type: "change", block, changeId: changeIdByBlock?.get(block.id) });
    }
    // block 缺失（理论不会发生）→ 跳过该 change 段、不抛异常、不报错
  }
  return segments;
}
