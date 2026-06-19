import { NextResponse } from "next/server";
import { DispatchStore } from "@/lib/domain/dispatch-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";
import { registerInnerSession } from "@/lib/rpc-manager";
import { runDispatch } from "@/lib/domain/orchestrator";
import { claudeSkillDirs } from "@/lib/pi/claude-skill-dirs";

// POST /api/projects/[id]/dispatch — 发起一次串行派发
// body: { goal: string, assignments: { agentId, subTask }[] }（2–3 条）
// 建任务（pending）→ 异步触发 runDispatch（fire-and-forget，前端轮询 GET 看进度）→ 立即返回 DispatchTask。
// cwd 一律取项目 root（registry.get 在 project 不存在时抛 NOT_FOUND→404，D-B4-2），不从请求体取。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      goal?: unknown;
      assignments?: unknown;
    };
    const goal = typeof body.goal === "string" ? body.goal : "";
    const assignments = Array.isArray(body.assignments)
      ? (body.assignments as Array<{ agentId?: unknown; subTask?: unknown }>).map((a) => ({
          agentId: typeof a?.agentId === "string" ? a.agentId : "",
          subTask: typeof a?.subTask === "string" ? a.subTask : "",
        }))
      : [];

    const registry = new ProjectRegistry();
    const store = new DispatchStore(registry);
    const task = store.create(id, { goal, assignments });

    // fire-and-forget：建任务后异步跑编排，不 await（前端轮询 GET /api/dispatch/[taskId]）。
    // 内部所有异常都收敛为 task→failed 落盘，这里再兜一层防未捕获 rejection。
    void runDispatch(task, {
      registry,
      dispatchStore: store,
      registerInnerSession,
      // 让派发的 worker 会话也发现 .claude/skills（再经 profile.skills 过滤后真加载）。
      additionalSkillPaths: claudeSkillDirs(registry.get(id).root),
    }).catch(() => {});

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
