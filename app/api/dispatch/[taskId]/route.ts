import { NextResponse } from "next/server";
import { DispatchStore } from "@/lib/domain/dispatch-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/dispatch/[taskId] — 查派发进度
// 契约路径无 projectId，故跨项目扫描定位任务（findTask，决策见 decisions.md）。
export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  try {
    return NextResponse.json(new DispatchStore().findTask(taskId));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
