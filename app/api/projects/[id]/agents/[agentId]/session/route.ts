import { NextResponse } from "next/server";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";
import { registerInnerSession } from "@/lib/rpc-manager";
import { startProfileSession } from "@/lib/pi/profile-session-wiring";
import { setOwner } from "@/lib/domain/session-agent-map";

// POST /api/projects/[id]/agents/[agentId]/session
// body: { message: string }
// 按 Agent 档案注入起一个真实会话，并发首条 message（D-B4-3：带首条一步建会话+落盘）。
// 返回 { sessionId, diagnostics }，前端据 sessionId 走现有 onSessionCreated/SSE 流接管。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id, agentId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    // D-B4-3：首条 message 不可为空——空则内核懒落盘、后续读到幻影空会话。
    if (!message) {
      return NextResponse.json({ error: "message 不能为空" }, { status: 422 });
    }

    // D-B4-2：cwd 一律取项目 root（registry.get 在 project 不存在时抛 NOT_FOUND→404），
    // 不从请求体取。同时拿到 root 供档案正文 join 还原绝对路径。
    const projectRoot = new ProjectRegistry().get(id).root;
    const profile = new AgentProfileStore().get(id, agentId);

    const result = await startProfileSession({
      projectRoot,
      profile,
      cwd: projectRoot,
      firstMessage: message,
      registerInnerSession,
    });

    // M7·5.3：会话创建成功后立即写「会话→agent」归属，供左栏分组（功能#5.4）。
    // cwd 与建会话同取 projectRoot（D-B4-2）；映射存于 <root>/.pi/ns-session-map.json。
    setOwner(projectRoot, result.sessionId, agentId);

    // 与 /api/agent/new 同款：让新 cwd 立即可经 /api/files 读取，避免 403 直到缓存过期。
    globalThis.__piAllowedRootsCache?.roots.add(projectRoot);

    return NextResponse.json(result);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
