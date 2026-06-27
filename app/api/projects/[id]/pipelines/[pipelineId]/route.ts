import { NextResponse } from "next/server";
import { PipelineStore } from "@/lib/domain/pipeline-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects/[id]/pipelines/[pipelineId] — 读单蓝图
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const { id, pipelineId } = await params;
  try {
    return NextResponse.json(new PipelineStore().get(id, pipelineId)); // 不存在 → NOT_FOUND 404
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// PUT /api/projects/[id]/pipelines/[pipelineId] — 整体改蓝图（PUT 整体替换语义，非增量）
// body: { name: string, stages: { order, agentId, subTaskTemplate }[] }
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const { id, pipelineId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; stages?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const stages = Array.isArray(body.stages)
      ? (body.stages as Array<{ order?: unknown; agentId?: unknown; subTaskTemplate?: unknown }>).map(
          (s) => ({
            order: typeof s?.order === "number" ? s.order : NaN,
            agentId: typeof s?.agentId === "string" ? s.agentId : "",
            subTaskTemplate: typeof s?.subTaskTemplate === "string" ? s.subTaskTemplate : "",
          }),
        )
      : [];
    return NextResponse.json(new PipelineStore().update(id, pipelineId, { name, stages })); // 200
  } catch (error) {
    return domainErrorResponse(error); // NOT_FOUND→404 / INVALID→422
  }
}

// DELETE /api/projects/[id]/pipelines/[pipelineId] — 仅删蓝图，历史 run 保留
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const { id, pipelineId } = await params;
  try {
    new PipelineStore().delete(id, pipelineId); // delete() 内只 unlink pipelines/<id>.json，绝不碰 runs/
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return domainErrorResponse(error); // 不存在 → NOT_FOUND 404
  }
}
