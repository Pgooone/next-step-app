import { NextResponse } from "next/server";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects/[id]/agents — 列出该项目下全部 Agent 档案
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(new AgentProfileStore().list(id));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// POST /api/projects/[id]/agents — 新建 Agent 档案并落盘三件套
// body: { name, role?, model?, skills?, tools?, thinkingLevel? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      role?: unknown;
      model?: unknown;
      skills?: unknown;
      tools?: unknown;
      thinkingLevel?: unknown;
      mode?: unknown;
    };
    const input = {
      name: typeof body.name === "string" ? body.name : "",
      ...(typeof body.role === "string" ? { role: body.role } : {}),
      ...(typeof body.model === "string" ? { model: body.model } : {}),
      ...(Array.isArray(body.skills) ? { skills: body.skills as string[] } : {}),
      ...(Array.isArray(body.tools) ? { tools: body.tools as string[] } : {}),
      ...(typeof body.thinkingLevel === "string"
        ? { thinkingLevel: body.thinkingLevel as "off" | "low" | "medium" | "high" }
        : {}),
      ...(typeof body.mode === "string" ? { mode: body.mode as "doc" | "coding" } : {}),
    };
    const profile = new AgentProfileStore().create(id, input);
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
