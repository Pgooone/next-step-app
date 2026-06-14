import { NextResponse } from "next/server";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects — 列出全部项目
export async function GET() {
  try {
    return NextResponse.json(new ProjectRegistry().list());
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// POST /api/projects — 新建项目  body: { name, root }
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; root?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    const root = typeof body.root === "string" ? body.root : "";
    const project = new ProjectRegistry().create({ name, root });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
