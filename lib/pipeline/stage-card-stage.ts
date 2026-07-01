// 卡片族（PipelineStageCard / StageHoverPreview / StageSessionMenu）消费的**超集** stage 类型。
//
// 为何新建（待设计点 B 终裁 + t5-brief Trap 1）：详细设计.md:86/:110 写「MastermindStage extends
// PipelineRunStage」与代码不符——实际 mastermind-run-store.ts:58 是**独立 interface**、且 status(:63)
// = DispatchStatus | "skipped" 比 PipelineRunStage.status(pipeline-run-store.ts:21 DispatchStatus)**宽**。
// 直传 PipelineStageCard 硬报 TS2322（"skipped" not assignable to DispatchStatus）。
//
// 解法：具名超集 StageCardStage = Omit<PipelineRunStage,"status"> & 放宽的 status + Mastermind 多出的字段。
// 三组件 props + PipelineStageCard 两 helper(statusClass/badgeFor) 同步收它、各补 case "skipped"。
// 协变保证：第七轮传窄 PipelineRunStage 进放宽后的 prop 零改动零报错（子类型可赋给超类型形参）。
// **全 import type**（node:fs 不进 bundle，守 D-R7B-07）；**严禁 as 强转绕 tsc**。
import type { PipelineRunStage } from "@/lib/domain/pipeline-run-store";
import type { DispatchStatus } from "@/lib/domain/dispatch-store";

/**
 * 卡片族吃的 stage 超集：status 放宽含 "skipped"（用户 paused 时选跳过），并接纳 MastermindStage 多出的
 * retryCount / acceptanceCriteria / isDynamic（全可选，第七轮的 PipelineRunStage 不带这些也能赋值）。
 */
export type StageCardStage = Omit<PipelineRunStage, "status"> & {
  status: DispatchStatus | "skipped";
  retryCount?: number;
  acceptanceCriteria?: string;
  isDynamic?: boolean;
};
