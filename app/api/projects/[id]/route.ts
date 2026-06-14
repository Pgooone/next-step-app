import { NextResponse } from "next/server";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects/[id] — 读取单个项目
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(new ProjectRegistry().get(id));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// PATCH /api/projects/[id] — 修改项目  body: { name?, root? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; root?: unknown };
    const patch: { name?: string; root?: string } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.root === "string") patch.root = body.root;
    return NextResponse.json(new ProjectRegistry().update(id, patch));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// DELETE /api/projects/[id] — 仅移除注册项，不删除磁盘上的项目文件
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    new ProjectRegistry().remove(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
