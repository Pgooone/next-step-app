import { NextResponse } from "next/server";
import { PipelineStore } from "@/lib/domain/pipeline-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects/[id]/pipelines — 列该项目全部蓝图
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(new PipelineStore().list(id)); // project 不存在 → registry NOT_FOUND → 404
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// POST /api/projects/[id]/pipelines — 建蓝图（校验在 store）
// body: { name: string, stages: { order, agentId, subTaskTemplate }[] }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; stages?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const stages = Array.isArray(body.stages)
      ? (body.stages as Array<{ order?: unknown; agentId?: unknown; subTaskTemplate?: unknown }>).map(
          (s) => ({
            order: typeof s?.order === "number" ? s.order : NaN, // 非 number → NaN，落入 store 整数校验 → INVALID 422
            agentId: typeof s?.agentId === "string" ? s.agentId : "",
            subTaskTemplate: typeof s?.subTaskTemplate === "string" ? s.subTaskTemplate : "",
          }),
        )
      : [];
    const bp = new PipelineStore().create(id, { name, stages });
    return NextResponse.json(bp, { status: 201 }); // 建资源 201
  } catch (error) {
    return domainErrorResponse(error); // INVALID→422 / NOT_FOUND→404
  }
}
