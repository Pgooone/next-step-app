import { NextResponse } from "next/server";
import { MastermindRunStore } from "@/lib/domain/mastermind-run-store";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { PipelineError } from "@/lib/domain/pipeline-store";
import { domainErrorResponse } from "@/lib/api/errors";
import { registerInnerSession } from "@/lib/rpc-manager";
import { runMastermind } from "@/lib/domain/mastermind-orchestrator";
import { setRunController, deleteRunController } from "@/lib/pi/run-controllers";
import { extraSkillDirs } from "@/lib/pi/extra-skill-dirs";

type ResumeAction = "retry" | "reassign" | "skip" | "abort";

// POST /api/projects/[id]/mastermind/runs/[runId]/resume — 用户在 paused 计划卡对失败阶段抉择
// body: { action: "retry"|"reassign"|"skip"|"abort", newAgentId? }
//   - retry：失败阶段 status→pending + retryCount=0，重 fire。
//   - reassign：收 newAgentId 改 stage.agentId + agentName（profileStore.get 取名）+ status→pending + retryCount=0，重 fire。
//   - skip：stage.status→skipped，重 fire（编排器跳过它继续下游；全跑完 partial）。
//   - abort：run.status→failed（终态），不 fire。
// 承重（D-R8.6-11）：非 abort 须 new AbortController+setRunController（上次 .finally 已删 controller、须重建）。
// 幂等门：仅 paused 可 resume（终态/运行中/awaiting 均 409）。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: ResumeAction; newAgentId?: string };
    const action = body.action;
    if (!action || !["retry", "reassign", "skip", "abort"].includes(action)) {
      throw new PipelineError("INVALID", `非法 action: ${action}`);
    }

    const registry = new ProjectRegistry();
    const runStore = new MastermindRunStore(registry);
    const profileStore = new AgentProfileStore(registry);

    const run = runStore.get(id, runId); // 不存在→NOT_FOUND 404
    if (run.status !== "paused") {
      throw new PipelineError("INVALID", `运行当前状态为 ${run.status}，不可 resume（仅 paused 可）`);
    }

    // 定位失败阶段（failedTeammate.order）。
    const order = run.failedTeammate?.order;
    const stage = run.stages.find((s) => s.order === order);
    if (!stage) {
      throw new PipelineError("INVALID", "找不到失败阶段（run 数据异常）");
    }

    if (action === "abort") {
      run.status = "failed";
      run.failedReason = "用户放弃";
      run.finishedAt = new Date().toISOString();
      runStore.write(id, run);
      return NextResponse.json(run);
    }

    if (action === "skip") {
      stage.status = "skipped";
    } else if (action === "reassign") {
      const newAgentId = (body.newAgentId ?? "").trim();
      if (!newAgentId) throw new PipelineError("INVALID", "reassign 须提供 newAgentId");
      const profile = profileStore.get(id, newAgentId); // 不存在→NOT_FOUND 404
      stage.agentId = profile.id;
      stage.agentName = profile.name;
      stage.status = "pending";
      stage.retryCount = 0;
      stage.sessionId = null;
    } else {
      // retry：重置该阶段（保留 agentId），重跑。
      stage.status = "pending";
      stage.retryCount = 0;
      stage.sessionId = null;
    }

    // 清 paused 标记 + run→running，重 fire。
    run.status = "running";
    run.failedReason = null;
    run.failedTeammate = undefined;
    run.failureOptions = undefined;
    runStore.write(id, run);

    // ★承重：上次 pauseRun 的 .finally(deleteRunController) 已删 controller，须新建 + 注册（对称）。
    const controller = new AbortController();
    setRunController(runId, controller);

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
      .finally(() => deleteRunController(runId))
      .catch(() => {});

    return NextResponse.json(run);
  } catch (error) {
    return domainErrorResponse(error);
  }
}
