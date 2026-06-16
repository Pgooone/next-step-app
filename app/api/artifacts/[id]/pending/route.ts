import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { PendingChangeStore } from "@/lib/domain/pending-change-service";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/artifacts/[id]/pending — 列该 artifact 的未确认块级变更（只读，供 ArtifactPanel 渲染）
// 契约路径无 projectId，故 findArtifact 跨项目定位（仿 dispatch findTask / GET artifact，只扫 managed/）。
// 只读：不触确认 / 不写盘（resolve 留 D4，§5.5）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { projectId } = new ArtifactService().findArtifact(id);
    return NextResponse.json(new PendingChangeStore().listPendingChanges(projectId, id));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
