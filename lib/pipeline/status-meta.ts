// 派发/阶段状态的徽章配色（纯对象、零运行时 import，可被客户端组件安全 import）。
// 值与结构对齐 DispatchPanel.tsx:38-43 的 STATUS_META（该常量未 export，不跨组件耦合，抽到此处共享）。
import type { DispatchStatus } from "@/lib/stores/useDispatchStore"; // 仅类型，编译期擦除

// 第 8.6 轮 T5：扩到 DispatchStatus | "skipped"，多一个 skipped 键——否则 StageHoverPreview.tsx:63
// `STATUS_META[stage.status]` 索引 skipped 返回 undefined → 读 .color/.label 崩白屏（Trap 2）。
// skipped 用「已跳过」灰底（--sub / --badge-bg 在 t-kimi 壳内有值）。
export const STATUS_META: Record<
  DispatchStatus | "skipped",
  { label: string; color: string; bg: string }
> = {
  pending: { label: "待执行", color: "var(--text-muted)", bg: "var(--bg-hover)" },
  running: { label: "执行中", color: "#2563eb", bg: "rgba(37,99,235,0.10)" },
  done: { label: "已完成", color: "#16a34a", bg: "rgba(22,163,74,0.10)" },
  failed: { label: "失败", color: "#dc2626", bg: "rgba(239,68,68,0.10)" },
  skipped: { label: "已跳过", color: "var(--sub)", bg: "var(--badge-bg)" },
};
