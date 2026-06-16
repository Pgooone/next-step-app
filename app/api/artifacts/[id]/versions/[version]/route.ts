import { NextResponse } from "next/server";
import { ArtifactService, ArtifactError } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/artifacts/[id]/versions/[version] — 取某版本完整 ArtifactVersion（D5 版本下拉查看历史版）
// 契约路径无 projectId，故 findArtifact 跨项目定位；version 非整数 → 422；artifact/版本不存在 → 404。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const { id, version } = await params;
  try {
    const v = Number(version);
    if (!Number.isInteger(v)) {
      throw new ArtifactError("INVALID", `版本号必须为整数: ${version}`);
    }
    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id);
    return NextResponse.json(service.getVersion(projectId, id, v));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
