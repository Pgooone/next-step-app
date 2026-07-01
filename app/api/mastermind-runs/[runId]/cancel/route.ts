import { NextResponse } from "next/server";
import { MastermindRunStore } from "@/lib/domain/mastermind-run-store";
import { getRunController } from "@/lib/pi/run-controllers";
import { domainErrorResponse } from "@/lib/api/errors";

// POST /api/mastermind-runs/[runId]/cancel — 取消主脑运行。
// **不复用 pipeline cancel**（它硬编码 PipelineRunStore）。路径无 projectId → findRun 跨项目定位。
//   - running：翻 cancelRequested + abort 注册的 controller（signal 翻转 → runMastermind 顶检测 + worker
//     signal 提前结束 → run→failed('已取消')、该阶段 evict 释槽由编排器覆盖）。controller 清理不在此处
//     （approve/resume 的 .finally(deleteRunController) 是唯一清理点，本路由只 abort）。
//   - paused：本无活 controller（上次 pauseRun 的 .finally 已删），直接 run→failed('已取消') 落盘、不 abort。
// 幂等：running/paused 才处理；终态/awaiting_plan_approval/不存在均不动（awaiting 用 reject 而非 cancel）。
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const store = new MastermindRunStore();
    const { projectId, run } = store.findRun(runId); // 跨项目定位；不存在→NOT_FOUND 404
    if (run.status === "running") {
      run.cancelRequested = true;
      store.write(projectId, run);
      getRunController(runId)?.abort(); // 无则 ?. no-op（dev 重启后 controller 已丢，读时对账兜底）
    } else if (run.status === "paused") {
      // paused 无活 controller → 直接终态收敛（不 abort）。
      run.status = "failed";
      run.failedReason = "已取消";
      run.finishedAt = new Date().toISOString();
      store.write(projectId, run);
    }
    return NextResponse.json(run);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
