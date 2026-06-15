import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/artifacts/[id]/versions — 列出该 artifact 全部版本（按 version 升序）
// 契约路径无 projectId，故 findArtifact 跨项目定位。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id);
    return NextResponse.json(service.listVersions(projectId, id));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
