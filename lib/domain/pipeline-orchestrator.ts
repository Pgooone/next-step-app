/**
 * V1.2 第七轮（流水线与阶段看板）·T3 —— 流水线运行编排器（§3.3）。
 *
 * 职责：把一次 {@link PipelineRun} 的 stages **按 order 串行**逐阶段起 worker 会话执行，
 * 上游阶段的产物**累积**拼进下游阶段的首条 message（AC-6，非只链一跳），每阶段产物 id 落
 * `PipelineRunStage.artifactId`（worker 的 create_artifact 已物化受管文档、artifactId 即权威产物），
 * 并实时回写 {@link PipelineRun} 状态机（running→done/failed）+ 每阶段 status（queued→running→done）。
 *
 * 冻结模型（F16 / D-V1.2-41 核心）：**每阶段（含 completed）跑完后主动 {@link evictSession}** 按
 * **本阶段 sessionId** 销毁该阶段会话还槽（第八轮 D-V1.2-50 轮次2：从原「按 agentId 一锅端」收窄为「按
 * 本阶段 sessionId」，防跨 run 误杀同 agent 的用户接管会话）——现 `runDispatch` 对 completed worker 不销毁、
 * 留 registry 占槽到 10min idle（dispatch-runner.ts:161-163 仅在 !completed 时 abort；orchestrator.ts:156-198
 * completed 路径无销毁），故本编排器新增 evict 后串行运行中活 worker 会话恒 ≤1（AC-2），多 run 并发受
 * acquireSlot 限流轮转（AC-4）。
 *
 * 红线：
 * - 本模块属**服务端领域层**（链经 store/dispatch-runner 引 node:fs），绝不被客户端 value-import
 *   （D-R7B-07，看板 UI 只 fetch JSON + import type）；顶部不加 "use client"。
 * - **不 import node:fs、不写 .pi/artifacts 文本**——worker 的 create_artifact 已物化受管文档，artifactId 即权威产物。
 * - headless worker 复用既有 {@link runWorker} 装配（doc 模式套 DISPATCH_DOC_SESSION_TOOLS 6 项白名单、
 *   **无 propose_edit**）——编排器全程不碰工具装配，不新增 propose_edit 放行；不改 pi 内核。
 * - evict 只 destroy、**绝不碰 bySession/removeOwner**（evict-agent-sessions.ts:11-13 红线，误碰会复现第五轮
 *   re-attach getOwner 返 null → 反塞 write/edit/bash 的 bug）。
 */

import { AgentProfileStore } from "./agent-profile-store";
import { PipelineRunStore, type PipelineRun, type PipelineRunStage } from "./pipeline-run-store";
import { ProjectRegistry } from "./project-registry";
import { setOwner } from "./session-agent-map";
import { acquireSlot } from "../pi/concurrency-gate";
import { evictSession } from "../pi/evict-agent-sessions";
import { runWorker, type RegisterInnerSession } from "../pi/dispatch-runner";
import type { CreateAgentSessionOptions, SessionManager } from "@earendil-works/pi-coding-agent";

/** 单 worker 回合默认超时（兜底，防止无 agent_end 永久挂起）。照搬 orchestrator.ts:27。 */
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

/** 编排器可注入依赖：生产全部省略走默认实现；测试注入 faux/spy。仿 OrchestratorDeps（orchestrator.ts:35-51）。 */
export interface PipelineOrchestratorDeps {
  registry?: ProjectRegistry;
  runStore?: PipelineRunStore;
  profileStore?: AgentProfileStore;
  runWorker?: typeof runWorker;
  acquireSlot?: typeof acquireSlot;
  /** 写「会话→agent」归属（看板分组 + re-attach 反查）；生产用 session-agent-map.setOwner，测试注入 spy。 */
  setOwner?: (cwd: string, sid: string, agentId: string) => void;
  /** ★冻结释槽 DI 钩子：生产用 lib/pi 的 evictSession（按本阶段 sessionId 逐出），测试注入 spy 断言每阶段调一次。 */
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
 * 串行执行一次已建好（running、各 stage=pending）的流水线运行，原地驱动其状态机并落盘。
 *
 * 流程：run→running 落盘 → 逐阶段：顶 cancel 检测 → 解析 profile → 指向该阶段+排队态落盘 →
 * acquireSlot 不限超时排队 → 阶段→running 落盘 → runWorker（首条 message = 子任务 + F10 引导 [+ 累积上游产物]）
 * → setOwner → **evict 释槽（含 completed）** → 结果判定 → 阶段→done 落盘 + 缓存产物正文供下游累积；
 * 任一阶段超时/取消/未产出/runWorker 抛错 → 该阶段→failed、run→failed 落盘并**中止后续**（串行依赖：
 * 上游失败下游缺输入，继续无意义）。全部 done → run→done 落盘。
 *
 * 设计为 fire-and-forget：POST 路由建 run 后异步调用本函数（不 await），前端轮询 GET 看进度。
 * 函数内部所有异常都收敛为「run→failed 落盘」，不向上抛（避免未捕获 rejection）。
 *
 * @param signal 中途取消：触发后让正在跑的 worker 提前结束、不再起后续阶段，run→failed。
 */
export async function runPipeline(
  run: PipelineRun,
  deps: PipelineOrchestratorDeps,
  signal?: AbortSignal,
): Promise<PipelineRun> {
  const registry = deps.registry ?? new ProjectRegistry();
  const runStore = deps.runStore ?? new PipelineRunStore(registry);
  const profileStore = deps.profileStore ?? new AgentProfileStore(registry);
  const doRunWorker = deps.runWorker ?? runWorker;
  const doAcquireSlot = deps.acquireSlot ?? acquireSlot;
  const doSetOwner = deps.setOwner ?? setOwner;
  const doEvict = deps.evictSession ?? evictSession;
  const workerTimeoutMs = deps.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  const projectRoot = registry.get(run.projectId).root;

  // 工作副本：PipelineRun 嵌套 stages[]，浅拷会污染入参，故深拷一层 stages（仿 orchestrator.ts:82）。
  const current: PipelineRun = { ...run, stages: run.stages.map((s) => ({ ...s })) };

  current.status = "running";
  runStore.write(run.projectId, current);

  // ★③ 累积喂下游用的进程内缓存：key=stage.order（非下标 i！），value=该阶段产物正文。零额外存储。
  const cache = new Map<number, string>();

  for (let i = 0; i < current.stages.length; i++) {
    const stage = current.stages[i];

    // a. 顶 cancel（未起 worker，无需 evict）。
    //    注：current.cancelRequested 在活进程内**恒 false**（current 是内存副本、不回读盘上 cancelRequested），
    //    真 cancel 靠 signal（T6 cancel 路由 abort 注册的 controller 翻转 signal 接通）；保留该写法钉死语义。
    if (signal?.aborted || current.cancelRequested) {
      return failRun(runStore, run.projectId, current, stage, "已取消");
    }

    // b. 解析该阶段的 Agent 档案（POST 已预检；此处兜底 try/catch→failRun，仿 orchestrator.ts:99-110）。
    let profile;
    try {
      profile = profileStore.get(run.projectId, stage.agentId);
    } catch (error) {
      return failRun(
        runStore,
        run.projectId,
        current,
        stage,
        `Agent 档案不存在: ${stage.agentId}（${(error as Error).message}）`,
      );
    }

    // c. ★先指向该阶段 + 排队态（在 acquireSlot 之前，AC-5：排队时全局进度条 ④/N 即指向正排队阶段）。
    current.currentStageIndex = i;
    stage.statusDetail = "queued";
    runStore.write(run.projectId, current);

    // d. ★① 不限超时排队（runDispatch 是默认 60s；acquireSlot 本体不动、signal 支持是 T5；T3 只传 Infinity）。
    try {
      await doAcquireSlot({ timeoutMs: Infinity });
    } catch (error) {
      return failRun(runStore, run.projectId, current, stage, (error as Error).message);
    }

    // e. 放行：清排队态、阶段→running。
    stage.statusDetail = undefined;
    stage.status = "running";
    stage.startedAt = new Date().toISOString();
    runStore.write(run.projectId, current);

    // f. ★③ 累积喂下游：拼**所有** order<本阶段 且 done 的阶段产物摘要（非只紧邻一跳）。
    const upstream = current.stages.filter((s) => s.order < stage.order && s.status === "done");
    const firstMessage =
      stage.subTask +
      "\n\n请在完成后调用 create_artifact 产出受管文档。" +
      (upstream.length
        ? "\n\n## 上游产物（累积）\n" + upstream.map((s) => formatUpstream(s, cache)).join("\n\n")
        : "");

    // g. ★【头号修正】runWorker 必须包 try/catch（详细设计 §3.3 伪代码漏了，模板 orchestrator.ts:131-154 有）。
    //    catch 内 best-effort doEvict 传 stage.sessionId——此时 stage.sessionId 尚为初值 null（:181 在 try 之后、
    //    worker 抛错未执行到），故 evictSession(null) 是 no-op（第八轮收窄后于 catch 语境恒不命中会话）；
    //    生产不漏槽：runWorker 在 registerInnerSession(dispatch-runner.ts:151，唯一占槽点)后无 throw 路径，
    //    worker 抛错必在占槽之前；即便未来引入占槽后抛，该正崩 worker 槽靠 wrapper 10min idle + AC-7
    //    reconcileOrphan 回收。吞 evict 错不盖原始 reason。
    let result;
    try {
      result = await doRunWorker({
        projectRoot,
        projectId: run.projectId,
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
        /* best-effort 释槽：stage.sessionId 恒 null→no-op（详上）；evict 失败不盖原始 reason */
      }
      return failRun(
        runStore,
        run.projectId,
        current,
        stage,
        `worker 执行失败: ${(error as Error).message}`,
      );
    }

    // h. setOwner 在 evict 之前（承重契约顺序 + 看板分组/re-attach 反查，orchestrator.ts:161 同款）。
    stage.sessionId = result.sessionId;
    doSetOwner(projectRoot, result.sessionId, stage.agentId);

    // i. ★② 冻结释槽（F16，AC-2/3）：必须在 setOwner 之后、结果判定之前——completed/timeout/aborted/判空
    //    四类 return 前都已 evict（不漏槽）。第八轮按**本阶段 sessionId** 逐出（:181 已赋 result.sessionId），
    //    只 destroy 本阶段 worker 会话、不连带逐出同 agent 用户接管会话（AC-1/3）；只 destroy 不碰 owner map
    //    （evict-agent-sessions.ts:11-13 红线）；对非 completed runWorker 内已自 abort，evict 再 destroy 幂等安全。
    await doEvict(projectRoot, stage.sessionId);

    // j. 结果判定（顺序同 orchestrator.ts:164-181）。
    if (result.reason === "timeout") {
      return failRun(runStore, run.projectId, current, stage, "阶段超时");
    }
    if (result.reason === "aborted") {
      return failRun(runStore, run.projectId, current, stage, "已取消");
    }
    if (!result.output.trim() && result.artifactIds.length === 0) {
      return failRun(runStore, run.projectId, current, stage, "阶段未产出");
    }

    // k. 落产物 id + 缓存正文供下游累积（取值仿 orchestrator.ts:197）。
    stage.artifactId = result.artifactIds.at(-1) ?? null;
    cache.set(stage.order, result.createdContent ?? result.output);
    stage.status = "done";
    stage.finishedAt = new Date().toISOString();
    runStore.write(run.projectId, current);
  }

  current.status = "done";
  current.finishedAt = new Date().toISOString();
  runStore.write(run.projectId, current);
  return current;
}

/**
 * 拼某已完成上游阶段的产物摘要：`### <agentName>\n<该阶段产物正文>`。
 * 正文取进程内缓存（result.createdContent ?? result.output，与 orchestrator.ts:197 同源）；
 * done 阶段必已 set，`?? ""` 仅防御。
 */
function formatUpstream(stage: PipelineRunStage, cache: Map<number, string>): string {
  return "### " + stage.agentName + "\n" + (cache.get(stage.order) ?? "");
}

/**
 * 把某阶段标失败、整 run 标失败并落盘，返回最终 run（中止后续）。
 * 关键差异（vs failTask orchestrator.ts:207-219）：{@link PipelineRunStage} **无 output 字段**——
 * reason 只落 `run.failedReason`，绝不给 stage 造 output。
 */
function failRun(
  store: PipelineRunStore,
  projectId: string,
  run: PipelineRun,
  stage: PipelineRunStage,
  reason: string,
): PipelineRun {
  stage.status = "failed";
  run.status = "failed";
  run.failedReason = reason;
  run.finishedAt = new Date().toISOString();
  store.write(projectId, run);
  return run;
}
