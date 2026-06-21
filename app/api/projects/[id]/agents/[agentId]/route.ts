import { NextResponse } from "next/server";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { evictAgentSessions } from "@/lib/pi/evict-agent-sessions";
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
      mode?: unknown;
    };
    const patch: {
      name?: string;
      role?: string;
      model?: string;
      skills?: string[];
      tools?: string[];
      thinkingLevel?: "off" | "low" | "medium" | "high";
      mode?: "doc" | "coding";
    } = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.role === "string") patch.role = body.role;
    if (typeof body.model === "string") patch.model = body.model;
    if (Array.isArray(body.skills)) patch.skills = body.skills as string[];
    if (Array.isArray(body.tools)) patch.tools = body.tools as string[];
    if (typeof body.thinkingLevel === "string") {
      patch.thinkingLevel = body.thinkingLevel as "off" | "low" | "medium" | "high";
    }
    if (typeof body.mode === "string") patch.mode = body.mode as "doc" | "coding";
    const store = new AgentProfileStore();
    const before = store.get(id, agentId); // 旧 mode（update 前）
    const updated = store.update(id, agentId, patch); // 原子写盘新 mode
    // 方案B（第六轮补丁）：mode 真变化 → 逐出该 agent 名下存活会话，使其下一条消息 re-attach
    // 按新 mode 重建工具集（doc→bash 即时消失 / coding→恢复）。仅 mode 变化才逐出（避免改
    // name/role/tools/model 误中断活会话）；务必 update 成功后再逐出（update 可能抛 INVALID 重名）。
    if (before.mode !== updated.mode) {
      const root = new ProjectRegistry().get(id).root;
      await evictAgentSessions(root, agentId);
    }
    return NextResponse.json(updated);
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
