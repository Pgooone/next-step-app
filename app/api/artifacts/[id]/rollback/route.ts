import { NextResponse } from "next/server";
import { ArtifactService, ArtifactError } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";
import { parseIfMatch } from "@/lib/api/if-match";

// POST /api/artifacts/[id]/rollback — 回滚到目标版（复制成新版，不删旧版）
// body: { version }；Header If-Match 同 submit-version。
// If-Match≠当前 version → 409；目标版不存在 → 404；version 非数 → 422；非数字 If-Match → 422。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ifMatch = parseIfMatch(req); // 非数字抛 ArtifactError(INVALID)→422
    const body = (await req.json().catch(() => ({}))) as { version?: unknown };
    if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
      throw new ArtifactError("INVALID", "version 必须为整数");
    }

    const service = new ArtifactService();
    const { projectId } = service.findArtifact(id);
    const updated = service.rollback(projectId, id, { version: body.version, ifMatch });
    return NextResponse.json(updated);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
