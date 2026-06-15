import { NextResponse } from "next/server";
import { ArtifactService, ArtifactError } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";
import { parseIfMatch } from "@/lib/api/if-match";

// POST /api/artifacts/[id]/submit-version — 提交新版本
// body: { content, note? }；Header If-Match = 客户端上次读到的 Artifact.version（缺省=不校验放行）。
// If-Match≠当前 version → 409；content 缺 → 422；非数字 If-Match → 422。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ifMatch = parseIfMatch(req); // 非数字抛 ArtifactError(INVALID)→422
    const body = (await req.json().catch(() => ({}))) as { content?: unknown; note?: unknown };
    if (typeof body.content !== "string") {
      throw new ArtifactError("INVALID", "content 不能为空");
    }
    const note = typeof body.note === "string" ? body.note : undefined;

    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id);
    const updated = service.submitVersion(projectId, id, { content: body.content, note, ifMatch });
    return NextResponse.json(updated);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
