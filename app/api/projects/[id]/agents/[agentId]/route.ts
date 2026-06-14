import { NextResponse } from "next/server";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { domainErrorResponse } from "@/lib/api/errors";

// GET /api/projects/[id]/agents/[agentId] — 读取单个 Agent 档案
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id, agentId } = await params;
  try {
    return NextResponse.json(new AgentProfileStore().get(id, agentId));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// PATCH /api/projects/[id]/agents/[agentId] — 修改 Agent 档案（白名单字段）
// body: { name?, role?, model?, skills?, tools?, thinkingLevel? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id, agentId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      role?: unknown;
      model?: unknown;
      skills?: unknown;
      tools?: unknown;
      thinkingLevel?: unknown;
    };
    const patch: {
      name?: string;
      role?: string;
      model?: string;
      skills?: string[];
      tools?: string[];
      thinkingLevel?: "off" | "low" | "medium" | "high";
    } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.role === "string") patch.role = body.role;
    if (typeof body.model === "string") patch.model = body.model;
    if (Array.isArray(body.skills)) patch.skills = body.skills as string[];
    if (Array.isArray(body.tools)) patch.tools = body.tools as string[];
    if (typeof body.thinkingLevel === "string") {
      patch.thinkingLevel = body.thinkingLevel as "off" | "low" | "medium" | "high";
    }
    return NextResponse.json(new AgentProfileStore().update(id, agentId, patch));
  } catch (error) {
    return domainErrorResponse(error);
  }
}

// DELETE /api/projects/[id]/agents/[agentId] — 删除档案及其整个目录（D-19）
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id, agentId } = await params;
  try {
    new AgentProfileStore().remove(id, agentId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
