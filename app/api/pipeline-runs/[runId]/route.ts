import { NextResponse } from "next/server";
import { PipelineRunStore } from "@/lib/domain/pipeline-run-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/pipeline-runs/[runId] — 读单次运行（前端轮询进度），**含读时对账**（AC-7）。
// 路径无 projectId，故 findRun 跨项目定位返回 {projectId, run}。读时对账：dev 重启后 running 中 run 的当前
// 阶段会话已不在活 registry（globalThis.__piSessions）→ reconcileOrphan 就地把 run 翻 failed 并写盘
// （故本 GET 含写副作用，是设计预期，非纯读）。liveSet 只在路由层组装——领域层不读 globalThis
// （pipeline-run-store.ts:128-129 注释钉死）。本路由只 GET；cancel 是 T6 的 pipeline-runs/[runId]/cancel。
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const store = new PipelineRunStore();
    const { projectId, run } = store.findRun(runId); // 跨项目定位；不存在→NOT_FOUND 404
    const liveSet = new Set<string>(globalThis.__piSessions?.keys() ?? []);
    return NextResponse.json(store.reconcileOrphan(projectId, run, liveSet));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
