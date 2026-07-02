import { NextResponse } from "next/server";
import { MastermindRunStore } from "@/lib/domain/mastermind-run-store";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";
import { registerInnerSession } from "@/lib/rpc-manager";
import { runMastermind } from "@/lib/domain/mastermind-orchestrator";
import { setRunController, deleteRunController } from "@/lib/pi/run-controllers";
import { extraSkillDirs } from "@/lib/pi/extra-skill-dirs";

// POST /api/projects/[id]/mastermind/runs/[runId]/approve — 用户在计划卡点「确认放行」
// 取 run（须 awaiting_plan_approval，否则 409 幂等门·防双 fire） → 从 plan 建 stages（agentId 占位空串、
// 待编排器临时造）+ run→running → 建 AbortController 注册（cancel/resume 用）→ 异步 fire runMastermind
// （fire-and-forget，前端轮询 GET mastermind-runs/[runId]）→ 立即返回 200 run。cwd 一律项目 root。
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  try {
    const registry = new ProjectRegistry();
    const runStore = new MastermindRunStore(registry);
    const profileStore = new AgentProfileStore(registry);

    const run = runStore.get(id, runId); // 不存在→NOT_FOUND 404

    // ★幂等门（承重·D-R8.6-11）：非 awaiting_plan_approval 态 approve → 409 Conflict、no-op（防重复点
    //   覆盖 controller + 双 fire 超额占槽）。已 running/done/failed/paused 都拒。直接 409（语义=状态冲突，
    //   非 domainErrorResponse 的 INVALID→422）。
    if (run.status !== "awaiting_plan_approval") {
      return NextResponse.json(
        { error: `运行当前状态为 ${run.status}，不可确认（仅 awaiting_plan_approval 可确认）`, code: "CONFLICT" },
        { status: 409 },
      );
    }

    // 从 plan 建 stages：agentId 占位空串（编排器首次进阶段临时造真档案），order 从 1 递增、mode 由队员声明。
    run.stages = run.plan.teammates.map((t, idx) => ({
      order: idx + 1,
      agentId: "",
      agentName: "",
      subTask: t.subTask,
      status: "pending" as const,
      sessionId: null,
      artifactId: null,
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
      acceptanceCriteria: t.acceptanceCriteria,
      role: t.role, // M5a：职衔落 stage（比 agentName「role-uuid8」更早有值、供 hover 显职衔）。
    }));
    run.currentStageIndex = 0;
    run.status = "running";
    run.failedReason = null;
    run.failedTeammate = undefined;
    run.failureOptions = undefined;
    runStore.write(id, run);

    // controller 进程级注册（cancel/resume 用）。
    const controller = new AbortController();
    setRunController(runId, controller);

    // fire-and-forget：异步跑编排、不 await（前端轮询）。内部异常都收敛为 run→failed/paused 落盘，再兜一层。
    void runMastermind(
      run,
      {
        registry,
        runStore,
        profileStore,
        registerInnerSession,
        additionalSkillPaths: extraSkillDirs(registry.get(id).root),
      },
      controller.signal,
    )
      .finally(() => deleteRunController(runId)) // 唯一清理点（cancel 只 abort 不删；resume 重建新 controller）
      .catch(() => {});

    return NextResponse.json(run);
  } catch (error) {
    return domainErrorResponse(error); // INVALID→422 / NOT_FOUND→404
  }
}
