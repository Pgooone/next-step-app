import { describe, expect, it } from "vitest";
import type { StageCardStage } from "./stage-card-stage";
import type { PipelineRunStage } from "@/lib/domain/pipeline-run-store";
import type { MastermindStage } from "@/lib/domain/mastermind-run-store";

/**
 * 类型负对照：证 StageCardStage.status 确实**比** PipelineRunStage.status（DispatchStatus 四态）宽——
 * 加宽真生效、非 vacuous（若两者等宽，下方 @ts-expect-error 会因「没有错误」而报错，测试即失败）。
 * 这些是编译期断言（tsc 在 npm run lint 里跑），运行时仅走一个占位断言让 vitest 收录本文件。
 */

// StageCardStage 可赋 "skipped"（PipelineRunStage 不能）。
const skippedStage: StageCardStage = {
  order: 1,
  agentId: "a",
  agentName: "n",
  subTask: "t",
  status: "skipped",
  sessionId: null,
  artifactId: null,
  startedAt: null,
  finishedAt: null,
};

// 负对照 1：把含 skipped 的 StageCardStage 赋回窄的 PipelineRunStage 必报错（status 不兼容）。
// @ts-expect-error "skipped" 不能赋给 PipelineRunStage.status（DispatchStatus）——证 StageCardStage 更宽。
const narrow: PipelineRunStage = skippedStage;

// 负对照 2：直接把字面 "skipped" 塞进 PipelineRunStage.status 也必报错。
const literalNarrow: PipelineRunStage = {
  order: 1,
  agentId: "a",
  agentName: "n",
  subTask: "t",
  // @ts-expect-error "skipped" 不是 DispatchStatus 的成员。
  status: "skipped",
  sessionId: null,
  artifactId: null,
  startedAt: null,
  finishedAt: null,
};

// 协变正向：窄 PipelineRunStage（status=done）可赋给宽 StageCardStage（子类型 → 超类型，零报错）。
const doneNarrow: PipelineRunStage = {
  order: 2,
  agentId: "a",
  agentName: "n",
  subTask: "t",
  status: "done",
  sessionId: null,
  artifactId: null,
  startedAt: null,
  finishedAt: null,
};
const widened: StageCardStage = doneNarrow;

// M5a（第 8.6 轮第二期）：MastermindStage 带 role → 结构上是 StageCardStage 子类型，直传卡片族零 as 强转
// （运行期真实路径：MastermindTeammateCards 把 run.stages 直传 PipelineStageCard）。role 是可选字段——
// 旧 run JSON 无 role 读回 undefined 也可赋值（向后兼容、零迁移）。
const mmStageWithRole: MastermindStage = {
  order: 1,
  agentId: "日本市场研究员-a1b2c3d4",
  agentName: "日本市场研究员-a1b2c3d4",
  subTask: "调研",
  status: "running",
  sessionId: null,
  artifactId: null,
  startedAt: null,
  finishedAt: null,
  retryCount: 0,
  acceptanceCriteria: "覆盖三大平台",
  role: "日本市场研究员",
};
const cardFromMmWithRole: StageCardStage = mmStageWithRole;

// 旧数据：无 role 的 MastermindStage（role 缺省）同样可赋给 StageCardStage（role 可选）。
const mmStageNoRole: MastermindStage = {
  order: 2,
  agentId: "a",
  agentName: "n",
  subTask: "t",
  status: "done",
  sessionId: null,
  artifactId: null,
  startedAt: null,
  finishedAt: null,
  retryCount: 0,
};
const cardFromMmNoRole: StageCardStage = mmStageNoRole;

describe("StageCardStage 类型加宽负对照（编译期）", () => {
  it("skipped stage 结构完整、宽窄关系成立（编译通过即证）", () => {
    // 运行时仅确认对象存在、字段可读（真正的证明在上面的 @ts-expect-error 编译期断言）。
    expect(skippedStage.status).toBe("skipped");
    expect(narrow.order).toBe(1);
    expect(literalNarrow.order).toBe(1);
    expect(widened.status).toBe("done");
  });

  it("MastermindStage(含/缺 role) 可赋给 StageCardStage、role 作可选字段透传（M5a）", () => {
    // 编译通过即证 role 已进 StageCardStage 且可选；运行期确认字段可读、缺省为 undefined。
    expect(cardFromMmWithRole.role).toBe("日本市场研究员");
    expect(cardFromMmNoRole.role).toBeUndefined();
  });
});
