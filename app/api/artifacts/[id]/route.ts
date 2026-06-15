import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/artifacts/[id] — 取 artifact 元数据 + 当前版本内容
// 契约路径无 projectId，故 findArtifact 跨项目定位（仿 dispatch findTask，只扫 managed/）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id);
    return NextResponse.json(service.getArtifact(projectId, id));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
