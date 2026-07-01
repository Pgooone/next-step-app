// 派发/阶段状态的徽章配色（纯对象、零运行时 import，可被客户端组件安全 import）。
// 值与结构对齐 DispatchPanel.tsx:38-43 的 STATUS_META（该常量未 export，不跨组件耦合，抽到此处共享）。
import type { DispatchStatus } from "@/lib/stores/useDispatchStore"; // 仅类型，编译期擦除

// 第 8.6 轮 T5：扩到 DispatchStatus | "skipped"，多一个 skipped 键——否则 StageHoverPreview.tsx:63
// `STATUS_META[stage.status]` 索引 skipped 返回 undefined → 读 .color/.label 崩白屏（Trap 2）。
// skipped 用「已跳过」灰底（--sub / --badge-bg 在 t-kimi 壳内有值）。
//
// 第 8.6 轮 T7 · P0③：再多一个 "queued" 键——queued 在领域模型是 `statusDetail`（底层 status 仍
// pending/running），PipelineStageCard.badgeFor 已优先识别 statusDetail 显「排队中·等会话槽」，但
// StageHoverPreview 只读 `STATUS_META[stage.status]` 忽略 statusDetail → 浮窗显 base「待执行」与卡片
// 自相矛盾。加此键让浮窗也能查到一致标签（消费方按 statusDetail==="queued" 优先取本键，见 STATUS_META_QUEUED_KEY）。
export const STATUS_META_QUEUED_KEY = "queued" as const;

export const STATUS_META: Record<
  DispatchStatus | "skipped" | "queued",
  { label: string; color: string; bg: string }
> = {
  pending: { label: "待执行", color: "var(--text-muted)", bg: "var(--bg-hover)" },
  // 第 8.6 轮 T7 · P0④：running 从硬编码 #2563eb 改用 t-kimi --run-accent（消双蓝割裂）。
  // 唯一读 .color/.bg 的消费方 StageHoverPreview 在 .pipeline-board.t-kimi-* 壳内、token 有值；
  // PipelineBoard 只读 .label 不受影响；DispatchPanel 用自己的本地 STATUS_META 不涉及。
  running: { label: "执行中", color: "var(--run-accent)", bg: "var(--run-bg)" },
  done: { label: "已完成", color: "var(--done-fg)", bg: "var(--done-bg)" },
  failed: { label: "失败", color: "var(--error)", bg: "rgba(255,59,48,0.14)" },
  skipped: { label: "已跳过", color: "var(--sub)", bg: "var(--badge-bg)" },
  // 排队中：用 t-kimi 壳内 run token（--run-accent 蓝）与卡片 badge-run 同色系，消双蓝割裂。
  queued: { label: "排队中·等会话槽", color: "var(--run-accent)", bg: "var(--run-bg)" },
};
