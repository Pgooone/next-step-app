"use client";

import { filledCols, DOT_ROWS, DOT_COLS } from "@/lib/pipeline/dot-matrix";
import type { DispatchStatus } from "@/lib/stores/useDispatchStore"; // 仅类型

/**
 * 绿点阵 LED：3×12 方块网格，同一列 3 点同步亮灭，`col < filledCols(progress)` 给亮色。
 * 亮色 emerald(`--led`)，失败态红(`--error`)，灭色 `--ledoff`。running 态加呼吸动画。
 * （视觉 §5：定稿原型用单 span + CSS mask；此处按 AC-10「3×12 块按列点亮」用直白网格，更易验收。）
 */
export default function StageDotMatrix({
  progress,
  status,
}: {
  progress: number;
  status?: DispatchStatus;
}) {
  const lit = filledCols(progress); // 0..12
  const litColor = status === "failed" ? "var(--error, #ff3b30)" : "var(--led)";
  const isRunning = status === "running";
  return (
    <span
      aria-hidden
      className={isRunning ? "led-live" : undefined}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(${DOT_COLS}, 1fr)`,
        gridTemplateRows: `repeat(${DOT_ROWS}, 1fr)`,
        gap: 1,
        width: 56,
        height: 12,
        verticalAlign: "middle",
        flex: "none",
      }}
    >
      {Array.from({ length: DOT_ROWS * DOT_COLS }).map((_, idx) => {
        const col = idx % DOT_COLS;
        return (
          <span
            key={idx}
            style={{ borderRadius: 1, background: col < lit ? litColor : "var(--ledoff)" }}
          />
        );
      })}
    </span>
  );
}
