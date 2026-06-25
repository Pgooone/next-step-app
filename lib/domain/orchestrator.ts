/**
 * C1 —— 多 Agent 串行派发编排（§5.3）。
 *
 * 职责：把一个 {@link DispatchTask} 的 assignments **按序**逐个起 worker 会话执行，
 * 上游 worker 的产物拼进下游 worker 的首条 message（AC③），每个 worker 的 assistant 产物
 * 落 `<projectRoot>/.pi/artifacts/<dispatchId>/<seq>-<agentName>.md`（D-C-1 轻量普通文件，
 * 不版本化/不 Diff，留 Iter D），Assignment.output 记相对 projectRoot 路径，并实时回写
 * DispatchTask 状态机（pending→running→done/failed）。
 *
 * 红线：不改 pi 内核；起会话/取产物的内核交互全经 lib/pi 封装（runWorker / acquireSlot）。
 * 编排逻辑本身框架无关、可 faux 单测（runWorker/acquireSlot 经依赖注入替换）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { AgentProfileStore } from "./agent-profile-store";
import { DispatchStore, type Assignment, type DispatchTask } from "./dispatch-store";
import { sanitizeFileName } from "./file-name";
import { ProjectRegistry } from "./project-registry";
import { setOwner } from "./session-agent-map";
import { acquireSlot } from "../pi/concurrency-gate";
import { runWorker, type RegisterInnerSession } from "../pi/dispatch-runner";
import type { CreateAgentSessionOptions, SessionManager } from "@earendil-works/pi-coding-agent";

/** 单 worker 回合默认超时（兜底，防止无 agent_end 永久挂起）。 */
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

/** runWorker 的依赖签名（生产用 lib/pi 的 runWorker，测试注入 faux 实现）。 */
export type RunWorkerFn = typeof runWorker;
/** acquireSlot 的依赖签名（生产用 lib/pi 的 acquireSlot，测试注入桩闸门）。 */
export type AcquireSlotFn = typeof acquireSlot;

/** Orchestrator 的可注入依赖：生产全部省略走默认实现；测试注入 faux/桩。 */
export interface OrchestratorDeps {
  registry?: ProjectRegistry;
  dispatchStore?: DispatchStore;
  profileStore?: AgentProfileStore;
  runWorker?: RunWorkerFn;
  acquireSlot?: AcquireSlotFn;
  /** 写「会话→agent」归属（V1.2 第五轮·5.3）；生产用 session-agent-map.setOwner，测试注入 spy。 */
  setOwner?: (cwd: string, sid: string, agentId: string) => void;
  /** 透传给 runWorker：生产用 rpc-manager.registerInnerSession，测试用 faux register。 */
  registerInnerSession: RegisterInnerSession;
  /** 透传给 runWorker（测试注入 faux session/model）。 */
  sessionManager?: SessionManager;
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  additionalSkillPaths?: string[];
  /** 单 worker 回合超时；测试可调短。 */
  workerTimeoutMs?: number;
}

/**
 * 串行执行一个已建好（pending）的派发任务，原地驱动其状态机并落产物。
 *
 * 流程：task→running 落盘 → 逐个 assignment：闸门等空位 → assignment→running 落盘 →
 * runWorker（首条 message = 子任务 [+ 上游产物]）→ 产物落 .pi/artifacts → assignment→done 落盘；
 * 任一 worker 抛错或产物为空 → 该 assignment→failed、task→failed 落盘并**中止后续**
 * （串行依赖：上游失败则下游缺输入，继续无意义）。全部 done → task→done 落盘。
 *
 * 设计为 fire-and-forget：API 层建任务后异步调用本函数（不 await），前端轮询 GET 看进度。
 * 函数内部所有异常都收敛为「task→failed 落盘」，不向上抛（避免未捕获 rejection）。
 *
 * @param signal 中途取消：触发后让正在跑的 worker 提前结束、不再起后续 worker，task→failed。
 */
export async function runDispatch(
  task: DispatchTask,
  deps: OrchestratorDeps,
  signal?: AbortSignal,
): Promise<DispatchTask> {
  const registry = deps.registry ?? new ProjectRegistry();
  const dispatchStore = deps.dispatchStore ?? new DispatchStore(registry);
  const profileStore = deps.profileStore ?? new AgentProfileStore(registry);
  const doRunWorker = deps.runWorker ?? runWorker;
  const doAcquireSlot = deps.acquireSlot ?? acquireSlot;
  const doSetOwner = deps.setOwner ?? setOwner;
  const workerTimeoutMs = deps.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  const projectRoot = registry.get(task.projectId).root;

  // 工作副本：原地改 assignments/status，每步落盘。
  const current: DispatchTask = { ...task, assignments: task.assignments.map((a) => ({ ...a })) };

  current.status = "running";
  dispatchStore.write(task.projectId, current);

  let upstreamOutput = "";
  let upstreamAgentName = "";

  for (let i = 0; i < current.assignments.length; i++) {
    const assignment = current.assignments[i];

    // 中途取消：不再起后续 worker。
    if (signal?.aborted) {
      return failTask(dispatchStore, task.projectId, current, assignment, "派发已取消");
    }

    // 解析该 assignment 的 Agent 档案（不存在 → 该 assignment 失败、整任务失败）。
    let profile;
    try {
      profile = profileStore.get(task.projectId, assignment.agentId);
    } catch (error) {
      return failTask(
        dispatchStore,
        task.projectId,
        current,
        assignment,
        `Agent 档案不存在: ${assignment.agentId}（${(error as Error).message}）`,
      );
    }

    // AC⑤：起 worker 前等并发空位（超时抛错 → 该 assignment 失败）。
    // TOCTOU 提示：从这里 gate 通过到下面 runWorker 内 createAgentSession（async，会让出）
    // 真正把会话注册进 registry 之间有一个微小窗口。串行 + 单用户本地工具下可接受，
    // 不引并发池（红线：勿过度设计）；真要并发跑多任务时再议。
    try {
      await doAcquireSlot();
    } catch (error) {
      return failTask(dispatchStore, task.projectId, current, assignment, (error as Error).message);
    }

    assignment.status = "running";
    dispatchStore.write(task.projectId, current);

    // AC③：上游产物拼进下游首条 message。
    const firstMessage =
      i > 0 && upstreamOutput
        ? `${assignment.subTask}\n\n## 上游产物（${upstreamAgentName}）\n${upstreamOutput}`
        : assignment.subTask;

    let result;
    try {
      result = await doRunWorker({
        projectRoot,
        projectId: task.projectId,
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
      return failTask(
        dispatchStore,
        task.projectId,
        current,
        assignment,
        `worker 执行失败: ${(error as Error).message}`,
      );
    }

    assignment.sessionId = result.sessionId;

    // V1.2 第五轮·5.3：worker 会话已建（completed/timeout/aborted 三类都有 sessionId），立即写
    // 「会话→agent」归属，供左栏按 agent 分组（决策③：失败/超时会话也归类、也计数）。与
    // app/api/projects/[id]/agents/[agentId]/session/route.ts:45 同款——dispatch 此前漏写此行（Bug1 根因）。
    doSetOwner(projectRoot, result.sessionId, assignment.agentId);

    // 执行超时 / 被取消 → 明确失败信息（runWorker 已 abort 该会话释放并发槽），中止后续。
    if (result.reason === "timeout") {
      return failTask(
        dispatchStore,
        task.projectId,
        current,
        assignment,
        `worker 执行超时（${workerTimeoutMs}ms 内未结束），已中止该会话`,
      );
    }
    if (result.reason === "aborted") {
      return failTask(dispatchStore, task.projectId, current, assignment, "派发已取消");
    }

    // 正常结束但**既无文本产物又无受管文档**（worker 什么都没产出）→ 视为失败，中止后续。
    // T4：文档型 worker 可能只 create_artifact、不回 assistant 文本——此时 artifactIds 非空即算有产出。
    if (!result.output.trim() && result.artifactIds.length === 0) {
      return failTask(dispatchStore, task.projectId, current, assignment, "worker 未产出任何文本");
    }

    // T4：回填本回合新建的受管文档 id（取最后一个；文档型派发把受管文档当权威产物）。
    const lastArtifactId = result.artifactIds.at(-1);
    if (lastArtifactId) {
      assignment.artifactId = lastArtifactId;
    }

    // D-C-1：assistant 文本仍落 .pi/artifacts/<dispatchId>/<seq>-<agentName>.md（轻量普通文件，
    // 兼容 coding/纯文本 worker；文档型 worker 文本可能为空，照写空文件不影响——受管文档才是权威产物）。
    const relPath = writeArtifact(projectRoot, current.id, i + 1, profile.name, result.output);
    assignment.output = relPath;
    assignment.status = "done";
    dispatchStore.write(task.projectId, current);

    // T4：喂下游——有受管文档则用其权威正文（createdContent，回读失败退回 output），否则用文本产物。
    upstreamOutput = lastArtifactId ? (result.createdContent ?? result.output) : result.output;
    upstreamAgentName = profile.name;
  }

  current.status = "done";
  dispatchStore.write(task.projectId, current);
  return current;
}

/** 把某 assignment 标失败、整任务标失败并落盘，返回最终任务（中止后续）。 */
function failTask(
  store: DispatchStore,
  projectId: string,
  task: DispatchTask,
  assignment: Assignment,
  reason: string,
): DispatchTask {
  assignment.status = "failed";
  assignment.output = reason;
  task.status = "failed";
  store.write(projectId, task);
  return task;
}

/**
 * 落产物文件，返回相对 projectRoot 的路径（写进 Assignment.output）。
 * 路径：`.pi/artifacts/<dispatchId>/<seq>-<agentName>.md`；agentName 经 {@link sanitizeFileName}
 * 净化（仅替换文件系统非法字符，**保留中文/Unicode 字母**），避免越目录或非法文件名。
 */
function writeArtifact(
  projectRoot: string,
  dispatchId: string,
  seq: number,
  agentName: string,
  content: string,
): string {
  const dir = join(projectRoot, ".pi", "artifacts", dispatchId);
  mkdirSync(dir, { recursive: true });
  const safeName = sanitizeFileName(agentName);
  const fileName = `${seq}-${safeName}.md`;
  const abs = join(dir, fileName);
  writeFileSync(abs, content, "utf-8");
  return relative(projectRoot, abs);
}

/**
 * sanitizeFileName 已迁至共享模块 `./file-name`（V2-1，供 artifact-service 物化复用、避免 pi 依赖
 * 经 orchestrator 链污染领域存储层）。此处 re-export 以兼容既有 `import ... from "./orchestrator"`。
 */
export { sanitizeFileName } from "./file-name";

