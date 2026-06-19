import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";
import { parseIfMatch } from "@/lib/api/if-match";

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

// DELETE /api/artifacts/[id] — 彻底删除 artifact（侧车目录 + 物化 .md）
// 结构操作、不走 propose（D-V4-02）。If-Match 不符 → 409；不存在 → 404；非数字 If-Match → 422。
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ifMatch = parseIfMatch(req); // 非数字抛 ArtifactError(INVALID)→422
    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id); // NOT_FOUND→404
    service.deleteArtifact(projectId, id, { ifMatch });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
