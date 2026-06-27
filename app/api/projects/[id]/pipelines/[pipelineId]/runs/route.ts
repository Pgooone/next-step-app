import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PipelineStore, PipelineError } from "@/lib/domain/pipeline-store";
import { PipelineRunStore, type PipelineRun } from "@/lib/domain/pipeline-run-store";
import { AgentProfileStore } from "@/lib/domain/agent-profile-store";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";
import { registerInnerSession } from "@/lib/rpc-manager";
import { runPipeline } from "@/lib/domain/pipeline-orchestrator";
import { setRunController, deleteRunController } from "@/lib/pi/run-controllers";
import { extraSkillDirs } from "@/lib/pi/extra-skill-dirs";

// POST /api/projects/[id]/pipelines/[pipelineId]/runs — 起一次流水线运行
// 取蓝图 → 预检每阶段 agentId（任一不存在→422，不起 run）+ 快照 agentName/subTask → 实例化 PipelineRun
// → runStore.create 落盘 → 建 AbortController 注册（T6 cancel 用）→ 异步触发 runPipeline（fire-and-forget，
// 前端轮询 GET pipeline-runs/[runId] 看进度）→ 立即返回 201 PipelineRun。
// cwd 一律取项目 root（registry.get 在 project 不存在时抛 NOT_FOUND→404），不从请求体取。
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const { id, pipelineId } = await params;
  try {
    // 复用同一 registry 传 4 store + runPipeline，避免重复读盘（仿 dispatch route:28-30）。
    const registry = new ProjectRegistry();
    const pipelineStore = new PipelineStore(registry);
    const profileStore = new AgentProfileStore(registry);
    const runStore = new PipelineRunStore(registry);

    // 1. 取蓝图（不存在 → NOT_FOUND 404；project 不存在 registry 亦 NOT_FOUND→404）。
    const bp = pipelineStore.get(id, pipelineId);

    // 2. 预检 + 快照（一次 get 既预检又取 name）：profileStore.get 抛 NOT_FOUND→404，须 catch 后重抛
    //    PipelineError("INVALID")→422（语义：蓝图引用了已删 agent = 蓝图当前不可执行，非 URL 指向资源不存在）。
    const stages = bp.stages.map((s) => {
      let profile;
      try {
        profile = profileStore.get(id, s.agentId);
      } catch {
        throw new PipelineError("INVALID", `Agent 不存在: ${s.agentId}`);
      }
      return {
        order: s.order,
        agentId: s.agentId,
        agentName: profile.name,
        subTask: s.subTaskTemplate,
        status: "pending" as const,
        sessionId: null,
        artifactId: null,
        startedAt: null,
        finishedAt: null,
      };
    });

    // 3. 实例化 PipelineRun（run 级时间戳只有 createdAt，run 起始时间用 createdAt）。
    const now = new Date().toISOString();
    const run: PipelineRun = {
      id: randomUUID(),
      projectId: id,
      pipelineId,
      pipelineName: bp.name,
      status: "running",
      currentStageIndex: 0,
      createdAt: now,
      finishedAt: null,
      cancelRequested: false,
      failedReason: null,
      stages,
    };

    // 4. 落盘（预检步 2 已在此之前——任一 agentId 缺即 throw→422、盘上零 run、controller 不注册、runPipeline 不启动）。
    runStore.create(id, run);

    // 5. controller 进程级注册（T6 cancel 用）。
    const controller = new AbortController();
    setRunController(run.id, controller);

    // 6. fire-and-forget：建 run 后异步跑编排，不 await（前端轮询 GET pipeline-runs/[runId]）。
    //    内部所有异常都收敛为 run→failed 落盘，这里再兜一层防未捕获 rejection（仿 dispatch route:34-40）。
    void runPipeline(
      run,
      {
        registry,
        runStore,
        profileStore,
        registerInnerSession,
        // 让流水线 worker 会话也发现 .pi/agent/skills + .claude/skills（再经 profile.skills 过滤后真加载）。
        additionalSkillPaths: extraSkillDirs(registry.get(id).root),
      },
      controller.signal,
    )
      .finally(() => deleteRunController(run.id)) // 决策1：唯一清理点，覆盖 done/failed/cancel 所有终态（cancel 路由只 abort 不删）
      .catch(() => {});

    // 7. 立即返回（201）。
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error); // INVALID→422 / NOT_FOUND→404 自动映射
  }
}

// GET /api/projects/[id]/pipelines/[pipelineId]/runs — 列该蓝图最近 N 次运行（看板 run 下拉）。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const { id, pipelineId } = await params;
  try {
    return NextResponse.json(new PipelineRunStore().listRuns(id, pipelineId));
  } catch (error) {
    return domainErrorResponse(error);
  }
}
