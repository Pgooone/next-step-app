// 派发/阶段状态的徽章配色（纯对象、零运行时 import，可被客户端组件安全 import）。
// 值与结构对齐 DispatchPanel.tsx:38-43 的 STATUS_META（该常量未 export，不跨组件耦合，抽到此处共享）。
import type { DispatchStatus } from "@/lib/stores/useDispatchStore"; // 仅类型，编译期擦除

export const STATUS_META: Record<DispatchStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "待执行", color: "var(--text-muted)", bg: "var(--bg-hover)" },
  running: { label: "执行中", color: "#2563eb", bg: "rgba(37,99,235,0.10)" },
  done: { label: "已完成", color: "#16a34a", bg: "rgba(22,163,74,0.10)" },
  failed: { label: "失败", color: "#dc2626", bg: "rgba(239,68,68,0.10)" },
};
