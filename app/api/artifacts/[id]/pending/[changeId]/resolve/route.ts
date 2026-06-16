import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { PendingChangeStore, PendingChangeError } from "@/lib/domain/pending-change-service";
import { domainErrorResponse } from "@/lib/api/errors";

/**
 * POST /api/artifacts/[id]/pending/[changeId]/resolve — 逐块确认/拒绝（§5.5，D4）。
 * body: { blockId?, action: 'confirm'|'reject' }（契约 docs/04:25，后端 action 仅 confirm/reject）。
 * blockId 省略 → 对该 PendingChange 全部 pending 块统一置态。
 *
 * 薄路由：翻块 + 写盘红线（全块非 pending 才重建出新版，D-D4-5）全在 service
 * `resolveAndMaterialize` 内，本层只解析校验 + 跨项目定位 + 调用。
 * 返回 service 的 { change, materialized, artifact? }（materialized 时附新 Artifact 供前端刷新）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; changeId: string }> },
) {
  const { id, changeId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { blockId?: unknown; action?: unknown };
    if (body.action !== "confirm" && body.action !== "reject") {
      throw new PendingChangeError("INVALID", "action 必须为 confirm 或 reject");
    }
    const blockId = typeof body.blockId === "string" ? body.blockId : undefined;

    const { projectId } = new ArtifactService().findArtifact(id);
    const result = new PendingChangeStore().resolveAndMaterialize(projectId, id, changeId, {
      blockId,
      action: body.action,
    });
    return NextResponse.json(result);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
