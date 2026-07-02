/**
 * 第 8.6 轮 · T3（D-R8.6-11）—— 主脑（总管）编排运行存储。
 *
 * 与 {@link PipelineRunStore} 同构（照抄「临时文件 + rename」原子写、findRun 跨项目、reconcileOrphan
 * 读时对账、pruneOld 保留上限），但**独立落盘目录** `.pi/factory/mastermind-runs/<id>.json`（与流水线
 * `runs/` 平级、绝不混放），且类型自成一套——**不复用 PipelineRun/PipelineRunStage/DispatchStatus**：
 *   - MastermindRun 的 status 有 6 态（含 awaiting_plan_approval / paused / partial），DispatchStatus 只 4 态；
 *   - MastermindStage 比 PipelineRunStage 多 retryCount / acceptanceCriteria / isDynamic（Q6③：守详设不动
 *     PipelineRunStage、独立目录，复用 PipelineRunStore + 扩类型会牵动 dispatch/pipeline 全族 + 第七轮落盘
 *     兼容，爆炸半径大，故新建）。
 *
 * run 对象由 T5/submit_plan（awaiting_plan_approval 初态、stages 空）或 approve 路由（running）构造好传入
 * （run 是内部产物非用户输入，store 不造 id 不做业务校验）。projectRoot 经注入的 ProjectRegistry 反查
 * （project 不存在时 registry 抛 NOT_FOUND）。
 *
 * 红线（同 pipeline-run-store）：本模块属**服务端领域层**（顶部 import node:fs），绝不被客户端
 * value-import（D-R7B-07，看板/计划卡 UI 只 fetch JSON + import type）；顶部不加 "use client"。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ProjectRegistry } from "./project-registry";
import type { DispatchStatus } from "./dispatch-store";
import { PipelineError } from "./pipeline-store";

/**
 * 主脑运行的状态机（比 DispatchStatus 多 3 态）：
 *   - awaiting_plan_approval：submit_plan 已落计划、等用户在计划卡确认放行（本无活会话）。
 *   - running：approve 后编排进行中。
 *   - done：全部阶段完成。
 *   - failed：某阶段失败中止 / 被取消 / 用户 reject / revise。
 *   - paused：某阶段两次尝试仍失败，等用户抉择（retry/reassign/skip/abort），本无活会话。
 *   - partial：全跑完但含被 skip 的阶段（非全成功、非失败）。
 */
export type MastermindRunStatus =
  | "awaiting_plan_approval"
  | "running"
  | "done"
  | "failed"
  | "paused"
  | "partial";

/** 单阶段状态：复用 DispatchStatus 四态 + skip（用户在 paused 时选择跳过）。 */
export type MastermindStageStatus = DispatchStatus | "skipped";

/**
 * 主脑运行的单个阶段快照（语义仿 PipelineRunStage，多 3 个字段）。
 * sessionId/artifactId 在阶段起停时填，null 表示未起/无产物；retryCount 记本阶段已重试次数（0 或 1）；
 * acceptanceCriteria 来自计划（供 UI 展示 / 未来判定）；isDynamic 标记「运行中动态追加」的阶段（预留）。
 */
export interface MastermindStage {
  order: number;
  agentId: string;
  agentName: string;
  subTask: string;
  status: MastermindStageStatus;
  statusDetail?: "queued";
  sessionId: string | null;
  artifactId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  acceptanceCriteria?: string;
  /** 计划里的队员职衔（如「日本市场研究员」），供 hover/菜单显职衔（M5a）；旧 run JSON 无则 undefined、向后兼容。 */
  role?: string;
  isDynamic?: boolean;
}

/** 计划里的单个队员（submit_plan 提交，mode 由主脑按子任务性质声明，默认 doc）。 */
export interface MastermindTeammate {
  name: string;
  role: string;
  subTask: string;
  acceptanceCriteria: string;
  mode?: "doc" | "coding";
}

/** 主脑提交的一份多队员协作计划。 */
export interface MastermindPlan {
  teammates: MastermindTeammate[];
  notes: string;
}

/** 某阶段失败时记录的失败队员信息（供计划卡展示 + resume 定位）。 */
export interface MastermindFailedTeammate {
  order: number;
  agentId: string;
  reason: string;
}

/**
 * 一次主脑编排运行：随项目落盘到 `.pi/factory/mastermind-runs/<id>.json`，由 T4 编排器读-改-写驱动。
 * 一次定全字段（避二次改落盘契约）：submit_plan 起 awaiting_plan_approval（stages 空），approve 后
 * 编排器逐阶段填 stages/currentStageIndex/status。
 */
export interface MastermindRun {
  id: string;
  projectId: string;
  status: MastermindRunStatus;
  plan: MastermindPlan;
  stages: MastermindStage[];
  currentStageIndex: number;
  /** 某阶段失败暂停时记失败队员（paused 态下计划卡据此展示抉择项）；非暂停态可缺。 */
  failedTeammate?: MastermindFailedTeammate;
  /** paused 态下可选抉择项（["retry","reassign","skip","abort"]）；非暂停态可缺。 */
  failureOptions?: string[];
  createdAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  failedReason: string | null;
}

/**
 * 主脑运行存储：运行随项目落盘到 `<projectRoot>/.pi/factory/mastermind-runs/<id>.json`。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 NOT_FOUND）。
 */
export class MastermindRunStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  private runsDir(projectId: string): string {
    return join(this.registry.get(projectId).root, ".pi", "factory", "mastermind-runs");
  }

  private runPath(projectId: string, runId: string): string {
    return join(this.runsDir(projectId), `${runId}.json`);
  }

  /** 起 run 初次落盘（write 内自带 mkdir），写后顺手 GC（只在 create 触发）。 */
  create(projectId: string, run: MastermindRun): void {
    this.write(projectId, run);
    this.pruneOld(projectId);
  }

  /** 读盘（不对账）。不存在抛 NOT_FOUND。 */
  get(projectId: string, runId: string): MastermindRun {
    const path = this.runPath(projectId, runId);
    if (!existsSync(path)) {
      throw new PipelineError("NOT_FOUND", `主脑运行记录不存在: ${runId}`);
    }
    return this.readRun(path);
  }

  /**
   * 仅凭 runId 跨项目定位运行，返回 `{projectId, run}`（无 projectId 的路由用；仿 PipelineRunStore.findRun）。
   * per-file try/catch 防坏文件；找不到抛 NOT_FOUND。
   */
  findRun(runId: string): { projectId: string; run: MastermindRun } {
    for (const project of this.registry.list()) {
      const path = join(project.root, ".pi", "factory", "mastermind-runs", `${runId}.json`);
      if (existsSync(path)) {
        try {
          return { projectId: project.id, run: this.readRun(path) };
        } catch {
          continue;
        }
      }
    }
    throw new PipelineError("NOT_FOUND", `主脑运行记录不存在: ${runId}`);
  }

  /** 整体替换落盘（原子写，内含 mkdir）。运行时由编排器读-改-写驱动状态机。 */
  write(projectId: string, run: MastermindRun): void {
    this.atomicWrite(this.runPath(projectId, run.id), `${JSON.stringify(run, null, 2)}\n`);
  }

  /**
   * 读时对账（仿 PipelineRunStore.reconcileOrphan）：进程重启后 running 中 run 的当前阶段会话已不在活
   * registry → 翻 failed。**首行 early-return**：awaiting_plan_approval / paused 两态本无活会话
   * （前者等确认、后者等抉择），绝不因 liveSet 无会话误翻 failed（AC-4.2/4.3）。
   * liveSessionIds 由参数注入（API 层组装），领域层不读 globalThis、保持可单测。cur 用 ?. 兜越界。
   */
  reconcileOrphan(
    projectId: string,
    run: MastermindRun,
    liveSessionIds: Set<string>,
  ): MastermindRun {
    if (run.status === "awaiting_plan_approval" || run.status === "paused") return run;
    if (run.status !== "running") return run;
    const cur = run.stages[run.currentStageIndex];
    if (cur?.sessionId && !liveSessionIds.has(cur.sessionId)) {
      run.status = "failed";
      run.failedReason = "进程重启,运行已中断";
      if (cur.status === "running") cur.status = "failed";
      run.finishedAt = new Date().toISOString();
      this.write(projectId, run);
    }
    return run;
  }

  /**
   * 保留上限 M：总数 > M 时按 createdAt 删最旧。只删**终态**（done/failed/partial）run，绝不删
   * running/awaiting_plan_approval/paused（这三态非终态、删了会丢待处理运行）；unlink 用 try/catch
   * 吞 ENOENT（并发已删）。
   */
  private pruneOld(projectId: string): void {
    const dir = this.runsDir(projectId);
    if (!existsSync(dir)) return;
    const items: { name: string; createdAt: string; terminal: boolean }[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      try {
        const r = this.readRun(join(dir, e.name));
        items.push({
          name: e.name,
          createdAt: r.createdAt,
          terminal: r.status === "done" || r.status === "failed" || r.status === "partial",
        });
      } catch {
        // 坏文件不计不删（保守）
      }
    }
    if (items.length <= KEEP_M) return;
    const deletable = items
      .filter((i) => i.terminal)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const overflow = items.length - KEEP_M;
    for (const f of deletable.slice(0, overflow)) {
      try {
        unlinkSync(join(dir, f.name));
      } catch {
        // best-effort，吞 ENOENT 不阻断
      }
    }
  }

  private readRun(path: string): MastermindRun {
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as MastermindRun;
    } catch {
      throw new PipelineError("INVALID", `mastermind run 解析失败: ${path}`);
    }
  }

  /** 「临时文件 + rename」原子落盘，内置 mkdir（仿 PipelineRunStore.atomicWrite）。 */
  private atomicWrite(filePath: string, content: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}

/** mastermind-runs/*.json 磁盘保留上限，超出按 createdAt 删最旧（仅终态 run）。 */
const KEEP_M = 50;
