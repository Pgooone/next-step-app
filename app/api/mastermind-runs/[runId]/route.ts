import { NextResponse } from "next/server";
import { MastermindRunStore } from "@/lib/domain/mastermind-run-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/mastermind-runs/[runId] — 读单次主脑运行（前端轮询进度），**含读时对账**。
// 路径无 projectId，故 findRun 跨项目定位返回 {projectId, run}。读时对账：dev 重启后 running 中 run 的当前
// 阶段会话已不在活 registry（globalThis.__piSessions）→ reconcileOrphan 翻 failed 并写盘（故本 GET 含
// 写副作用，设计预期）；awaiting_plan_approval/paused 两态由 reconcileOrphan 首行 early-return 保护
// （本无活会话、绝不因无会话误翻 failed）。liveSet 只在路由层组装——领域层不读 globalThis。
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const store = new MastermindRunStore();
    const { projectId, run } = store.findRun(runId); // 跨项目定位；不存在→NOT_FOUND 404
    const liveSet = new Set<string>(globalThis.__piSessions?.keys() ?? []);
    return NextResponse.json(store.reconcileOrphan(projectId, run, liveSet));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
