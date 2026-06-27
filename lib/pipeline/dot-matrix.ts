// 阶段点阵的纯算法 + 阶段状态→离散进度映射。
// 零依赖、零 value-import：客户端/服务端皆可直接调（D-R7B-07：避免任何 node:fs 经 "use client" 链入 bundle）。
import type { DispatchStatus } from "@/lib/stores/useDispatchStore"; // 仅类型，编译期擦除，不进 bundle

export const DOT_ROWS = 3;
export const DOT_COLS = 12; // 3×12 = 36 块（D-V1.2-31）

/** 把任意数夹到 [0,1]；NaN 归 0。纯函数。 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** progress(0..1) → 点亮列数 ∈ [0,12]。0→0；0.5→6；1→12。 */
export function filledCols(progress: number): number {
  return Math.round(clamp01(progress) * DOT_COLS);
}

/**
 * 阶段状态→点阵离散进度（喂 filledCols）。配色由 UI 按原始 status 决定，本函数只给进度量。
 *  done=1（满）/ failed=1（满但红，由调用方按 status==="failed" 着色）/ running=0.5（半）/ pending=0（空）
 * （记 ADR D-R7-*；queued 在领域模型是 statusDetail，底层 status 仍 pending，故归 0。）
 */
export function statusToProgress(status: DispatchStatus): number {
  switch (status) {
    case "done":
      return 1;
    case "failed":
      return 1;
    case "running":
      return 0.5;
    case "pending":
    default:
      return 0;
  }
}
