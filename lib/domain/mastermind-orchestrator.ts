/**
 * 第 8.6 轮 · T4（D-R8.6-11）—— 主脑（总管）编排器 runMastermind（仿 {@link runPipeline}）。
 *
 * 职责：把一次已 approve（running）的 {@link MastermindRun} 的 stages **按 order 串行**逐阶段起 worker
 * 执行，上游产物**累积**拼进下游首条 message，每阶段产物 id 落 stage.artifactId，实时回写 run 状态机。
 *
 * 与 runPipeline 的**四处关键差异**（Q2/Q6 + 失败语义）：
 *   a) **resume 不重跑**：循环开头对 done/skipped 阶段 continue（done 的 cache 从 artifactId 回读重建），
 *      使 paused→resume 只跑未完成阶段（AC-2.4）。
 *   b) **临时造 agentId**（承重·teammate 无 agentId 直套母版必崩）：首次进阶段（stage.agentId 为占位空串）
 *      时对该 teammate `AgentProfileStore.create` 造临时档案拿 agentId 填 stage（Q2，uuid8 绕重名）。
 *   c) **retry 小循环**：每阶段最多两次尝试（attempt 0/1），每 attempt 走 runWorker→setOwner→evict→判定，
 *      失败且 retryCount<1 进 attempt1，两次都失败才 pauseRun（AC-2.1/2.3）。
 *   d) **失败改 pauseRun 非 fail-fast**：超时/未产出/runWorker 抛错 → 阶段 failed、run **paused**（等用户抉择），
 *      **不写 finishedAt**（非终态）；仅 abort（signal）与兜底 catch 走 failRun 终态。
 *
 * 一字不改继承 runPipeline 的承重契约：acquireSlot({timeoutMs:Infinity})、setOwner→evict 顺序、
 * evictSession(projectRoot, stage.sessionId) 按本阶段 sid 逐出、upstream filter status==="done"、
 * runWorker signal 透传 + try/catch。
 *
 * 红线（同 pipeline-orchestrator.ts:16-24）：
 * - 本模块属**服务端领域层**（链经 store/dispatch-runner 引 node:fs），绝不被客户端 value-import
 *   （D-R7B-07，计划卡/看板 UI 只 fetch JSON + import type）；顶部不加 "use client"。
 * - **不 import node:fs、不写 .pi/artifacts 文本**——worker 的 create_artifact 已物化受管文档，artifactId 即权威产物。
 * - **否决 dispatch 链**：复用 runWorker/acquireSlot/evictSession/setOwner，**禁 import runDispatch/dispatch-store**。
 * - evict 只 destroy、**绝不碰 bySession/removeOwner**（evict-agent-sessions.ts:11-13 红线）。
 * - headless worker 复用既有 runWorker 装配（doc 模式套 DISPATCH_DOC_SESSION_TOOLS 6 项、无 propose_edit）——
 *   编排器全程不碰工具装配、不改 pi 内核。
 */

import { randomUUID } from "node:crypto";
import { AgentProfileStore } from "./agent-profile-store";
import { ArtifactService } from "./artifact-service";
import {
  MastermindRunStore,
  type MastermindRun,
  type MastermindStage,
} from "./mastermind-run-store";
import { ProjectRegistry } from "./project-registry";
import { setOwner } from "./session-agent-map";
import { acquireSlot } from "../pi/concurrency-gate";
import { evictSession } from "../pi/evict-agent-sessions";
import { runWorker, type RegisterInnerSession } from "../pi/dispatch-runner";
import type { CreateAgentSessionOptions, SessionManager } from "@earendil-works/pi-coding-agent";

/** 单 worker 回合默认超时（兜底，防止无 agent_end 永久挂起）。照搬 pipeline-orchestrator.ts:36。 */
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

/** 每阶段最多尝试次数（attempt 0 首跑 + attempt 1 重试一次；两次都失败才 pause，AC-2.3）。 */
const MAX_ATTEMPTS = 2;

/** 编排器可注入依赖：生产全部省略走默认实现；测试注入 faux/spy。仿 PipelineOrchestratorDeps。 */
export interface MastermindOrchestratorDeps {
  registry?: ProjectRegistry;
  runStore?: MastermindRunStore;
  profileStore?: AgentProfileStore;
  runWorker?: typeof runWorker;
  acquireSlot?: typeof acquireSlot;
  /** 写「会话→agent」归属（看板分组 + re-attach 反查）；生产用 session-agent-map.setOwner，测试注入 spy。 */
  setOwner?: (cwd: string, sid: string, agentId: string) => void;
  /** ★冻结释槽 DI 钩子：生产用 lib/pi 的 evictSession（按本阶段 sessionId 逐出），测试注入 spy。 */
  evictSession?: typeof evictSession;
  /** 透传给 runWorker：生产用 rpc-manager.registerInnerSession，测试用 faux register。唯一必填。 */
  registerInnerSession: RegisterInnerSession;
  /** 透传给 runWorker（测试注入 faux session/model）。 */
  sessionManager?: SessionManager;
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  additionalSkillPaths?: string[];
  /** 单 worker 回合超时；测试可调短。 */
  workerTimeoutMs?: number;
}

/**
 * 串行执行一次已 approve（running）的主脑运行，原地驱动其状态机并落盘。**resume-safe**：
 * run.stages 已含 done/skipped/paused 时只跑未完成阶段（首次 approve 时 stages 已由路由从 plan 建好、
 * agentId 为占位空串，此处首次进阶段时临时造真档案填回）。
 *
 * @param signal 中途取消：触发后让正在跑的 worker 提前结束、不再起后续阶段，run→failed('已取消')。
 */
export async function runMastermind(
  run: MastermindRun,
  deps: MastermindOrchestratorDeps,
  signal?: AbortSignal,
): Promise<MastermindRun> {
  const registry = deps.registry ?? new ProjectRegistry();
  const runStore = deps.runStore ?? new MastermindRunStore(registry);
  const profileStore = deps.profileStore ?? new AgentProfileStore(registry);
  const doRunWorker = deps.runWorker ?? runWorker;
  const doAcquireSlot = deps.acquireSlot ?? acquireSlot;
  const doSetOwner = deps.setOwner ?? setOwner;
  const doEvict = deps.evictSession ?? evictSession;
  const workerTimeoutMs = deps.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  const projectId = run.projectId;
  const projectRoot = registry.get(projectId).root;
  const artifactService = new ArtifactService(registry);

  // 工作副本：深拷一层 stages（浅拷会污染入参，仿 pipeline-orchestrator.ts:90）。
  const current: MastermindRun = { ...run, stages: run.stages.map((s) => ({ ...s })) };

  current.status = "running";
  runStore.write(projectId, current);

  // ★累积喂下游用的进程内缓存：key=stage.order，value=该阶段产物正文。零额外存储。
  const cache = new Map<number, string>();

  for (let i = 0; i < current.stages.length; i++) {
    const stage = current.stages[i];

    // a. resume 不重跑：done 阶段重建 cache（从 artifactId 回读，失败 ??""），skipped 直接跳过（AC-2.4）。
    if (stage.status === "done") {
      cache.set(stage.order, readArtifactContent(artifactService, projectId, stage.artifactId));
      continue;
    }
    if (stage.status === "skipped") continue;

    // 顶 cancel（未起 worker，无需 evict）。真 cancel 靠 signal（cancel 路由 abort 翻转），
    // current.cancelRequested 在活进程内恒 false（内存副本、不回读盘）。
    if (signal?.aborted || current.cancelRequested) {
      return failRun(runStore, projectId, current, stage, "已取消");
    }

    // b. ★临时造 agentId（承重·Q2）：首次进阶段（agentId 为占位空串）→ 对该 teammate 造临时档案。
    //    动态 run 语义天然依赖临时造；uuid8 绕 agent-profile-store.ts:127 重名 throw。teammate 经 order 对齐。
    if (!stage.agentId) {
      const teammate = current.plan.teammates[stage.order - 1];
      const uuid8 = randomUUID().slice(0, 8);
      const profile = profileStore.create(projectId, {
        name: `${teammate?.role ?? "worker"}-${uuid8}`,
        role: teammate?.role ?? "",
        mode: teammate?.mode ?? "doc",
      });
      stage.agentId = profile.id;
      stage.agentName = profile.name;
      runStore.write(projectId, current);
    }

    // 解析该阶段档案（临时造的必存在；resume/reassign 指定的可能已删 → 兜底 try/catch→pauseRun）。
    let profile;
    try {
      profile = profileStore.get(projectId, stage.agentId);
    } catch (error) {
      return pauseRun(
        runStore,
        projectId,
        current,
        stage,
        `Agent 档案不存在: ${stage.agentId}（${(error as Error).message}）`,
      );
    }

    // c. ★retry 小循环（AC-2.1/2.3）：attempt 0 首跑 + attempt 1 重试；每 attempt 走
    //    acquireSlot→runWorker→setOwner→evict→判定。attempt 结果分三类：ok（进下一阶段）/
    //    paused（两次都失败→整 run pause 并 return）/ retry（首次失败且 retryCount<1→进下一 attempt）。
    let stageDone = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !stageDone; attempt++) {
      // 每 attempt 顶部再查 cancel（attempt1 前用户可能已取消）。
      if (signal?.aborted || current.cancelRequested) {
        return failRun(runStore, projectId, current, stage, "已取消");
      }

      // 先指向该阶段 + 排队态（在 acquireSlot 之前，AC-5：排队时进度条即指向正排队阶段）。
      current.currentStageIndex = i;
      stage.statusDetail = "queued";
      runStore.write(projectId, current);

      // ★不限超时排队（acquireSlot 本体不动、只传 Infinity，同 pipeline-orchestrator.ts:129）。
      try {
        await doAcquireSlot({ timeoutMs: Infinity });
      } catch (error) {
        return failRun(runStore, projectId, current, stage, (error as Error).message);
      }

      // 放行：清排队态、阶段→running。
      stage.statusDetail = undefined;
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
      runStore.write(projectId, current);

      // ★累积喂下游：拼**所有** order<本阶段 且 done 的阶段产物摘要（非只紧邻一跳）。
      const upstream = current.stages.filter((s) => s.order < stage.order && s.status === "done");
      const firstMessage =
        stage.subTask +
        "\n\n请在完成后调用 create_artifact 产出受管文档。" +
        (upstream.length
          ? "\n\n## 上游产物（累积）\n" + upstream.map((s) => formatUpstream(s, cache)).join("\n\n")
          : "");

      // ★runWorker 必须包 try/catch（母版 pipeline-orchestrator.ts:149-183 承重）：catch 内 best-effort
      //   doEvict 传 stage.sessionId（此时恒 null→no-op），返回 failRun 终态（worker 崩非可 retry 的业务失败）。
      let result;
      try {
        result = await doRunWorker({
          projectRoot,
          projectId,
          profile,
          cwd: projectRoot,
          firstMessage,
          registerInnerSession: deps.registerInnerSession,
          timeoutMs: workerTimeoutMs,
          additionalSkillPaths: deps.additionalSkillPaths,
          sessionManager: deps.sessionManager,
          createOptionsOverride: deps.createOptionsOverride,
          signal,
        });
      } catch (error) {
        try {
          await doEvict(projectRoot, stage.sessionId);
        } catch {
          /* best-effort 释槽：stage.sessionId 恒 null→no-op；evict 失败不盖原始 reason */
        }
        return failRun(
          runStore,
          projectId,
          current,
          stage,
          `worker 执行失败: ${(error as Error).message}`,
        );
      }

      // setOwner 在 evict 之前（承重契约顺序 + 看板分组/re-attach 反查）。
      stage.sessionId = result.sessionId;
      doSetOwner(projectRoot, result.sessionId, stage.agentId);

      // ★冻结释槽（F16）：setOwner 之后、结果判定之前——每 attempt（含 completed/timeout/aborted/判空）
      //   都已 evict（不漏槽），保证二次会话 sid 也走 evict。按**本阶段 sessionId** 逐出（只销毁本阶段
      //   worker 会话、不连带同 agent 用户接管会话）；只 destroy 不碰 owner map。
      await doEvict(projectRoot, stage.sessionId);

      // 结果判定（顺序同 pipeline-orchestrator.ts:196-204）。
      if (result.reason === "aborted") {
        // 取消属终态失败、不 retry（用户主动停）。
        return failRun(runStore, projectId, current, stage, "已取消");
      }

      const failReason =
        result.reason === "timeout"
          ? "阶段超时"
          : !result.output.trim() && result.artifactIds.length === 0
            ? "阶段未产出"
            : null;

      if (failReason === null) {
        // 成功：落产物 id + 缓存正文供下游累积。
        stage.artifactId = result.artifactIds.at(-1) ?? null;
        cache.set(stage.order, result.createdContent ?? result.output);
        stage.status = "done";
        stage.finishedAt = new Date().toISOString();
        runStore.write(projectId, current);
        stageDone = true;
      } else if (stage.retryCount < MAX_ATTEMPTS - 1) {
        // 首次失败且未用尽重试：retryCount+1、清 sessionId 供 attempt1 重跑，进下一 attempt。
        stage.retryCount += 1;
        stage.sessionId = null;
        runStore.write(projectId, current);
      } else {
        // 两次都失败：暂停整 run 等用户抉择（不 fail-fast，可回收）。
        return pauseRun(runStore, projectId, current, stage, failReason);
      }
    }
  }

  // 全跑完判定（差异 d）：有 skipped 阶段→partial，否则 done。
  current.status = current.stages.some((s) => s.status === "skipped") ? "partial" : "done";
  current.finishedAt = new Date().toISOString();
  runStore.write(projectId, current);
  return current;
}

/**
 * 拼某已完成上游阶段的产物摘要：`### <agentName>\n<该阶段产物正文>`。
 * 正文取进程内缓存；done 阶段必已 set，`?? ""` 仅防御（同 pipeline-orchestrator.ts:225-227）。
 */
function formatUpstream(stage: MastermindStage, cache: Map<number, string>): string {
  return "### " + stage.agentName + "\n" + (cache.get(stage.order) ?? "");
}

/** 从某阶段的 artifactId 回读当前正文（resume 时重建 done 阶段的 cache）；无 id / 回读失败 → ""。 */
function readArtifactContent(
  artifactService: ArtifactService,
  projectId: string,
  artifactId: string | null,
): string {
  if (!artifactId) return "";
  try {
    return artifactService.readCurrentContent(projectId, artifactId);
  } catch {
    return "";
  }
}

/**
 * 把某阶段标失败、整 run 标 **paused**（非终态、等用户抉择）并落盘，返回最终 run（中止后续）。
 * **不写 finishedAt**（paused 非终态）。差异 vs failRun：run.status="paused" + 填 failedTeammate +
 * failureOptions，供计划卡展示抉择项、resume 路由定位失败阶段。
 */
function pauseRun(
  store: MastermindRunStore,
  projectId: string,
  run: MastermindRun,
  stage: MastermindStage,
  reason: string,
): MastermindRun {
  stage.status = "failed";
  run.status = "paused";
  run.failedTeammate = { order: stage.order, agentId: stage.agentId, reason };
  run.failureOptions = ["retry", "reassign", "skip", "abort"];
  run.failedReason = reason;
  store.write(projectId, run);
  return run;
}

/**
 * 把某阶段标失败、整 run 标 **failed**（终态）并落盘，返回最终 run（中止后续）。
 * 仅 abort（signal 取消）与兜底 catch（worker 抛错）走此终态路径——用户主动停 / worker 崩非可 retry
 * 的业务失败，直接终态收敛（reject/revise 由路由另标 failed）。写 finishedAt。
 */
function failRun(
  store: MastermindRunStore,
  projectId: string,
  run: MastermindRun,
  stage: MastermindStage,
  reason: string,
): MastermindRun {
  stage.status = "failed";
  run.status = "failed";
  run.failedReason = reason;
  run.finishedAt = new Date().toISOString();
  store.write(projectId, run);
  return run;
}
