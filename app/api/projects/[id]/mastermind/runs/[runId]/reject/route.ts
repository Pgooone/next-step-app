import { NextResponse } from "next/server";
import { MastermindRunStore } from "@/lib/domain/mastermind-run-store";
import { PipelineError } from "@/lib/domain/pipeline-store";
import { domainErrorResponse } from "@/lib/api/errors";

// POST /api/projects/[id]/mastermind/runs/[runId]/reject — 用户在计划卡「否决」计划
// run→failed（failedReason="用户否决"），**不 fire 不 setController**。旧 run 终态可回收（pruneOld），
// 主脑据反馈重 submit_plan 产新 run。幂等门：仅 awaiting_plan_approval 可否决（终态/运行中 409）。
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  try {
    const runStore = new MastermindRunStore();
    const run = runStore.get(id, runId); // 不存在→NOT_FOUND 404
    if (run.status !== "awaiting_plan_approval") {
      throw new PipelineError("INVALID", `运行当前状态为 ${run.status}，不可否决`);
    }
    run.status = "failed";
    run.failedReason = "用户否决";
    run.finishedAt = new Date().toISOString();
    runStore.write(id, run);
    return NextResponse.json(run);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
