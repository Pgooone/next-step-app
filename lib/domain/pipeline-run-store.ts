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

/** 一次运行中某阶段的快照（§2.2）。sessionId/artifactId 在阶段起停时填，null 表示未起/无产物。 */
export interface PipelineRunStage {
  order: number;
  agentId: string;
  agentName: string;
  subTask: string;
  status: DispatchStatus;
  statusDetail?: "queued";
  sessionId: string | null;
  artifactId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 一次流水线运行（§2.2）：随项目落盘到 `.pi/factory/runs/<id>.json`，由 T3 编排器读-改-写驱动。 */
export interface PipelineRun {
  id: string;
  projectId: string;
  pipelineId: string;
  pipelineName: string;
  status: DispatchStatus;
  currentStageIndex: number;
  createdAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  failedReason: string | null;
  stages: PipelineRunStage[];
}

/** listRuns 只返回最近 N 条（看板 run 下拉够用）。 */
const RECENT_N = 20;
/** runs/*.json 磁盘保留上限，超出按 createdAt 删最旧（仅终态 run）。约束 N<=M。 */
const KEEP_M = 50;

/**
 * 流水线运行存储：运行随项目落盘到 `<projectRoot>/.pi/factory/runs/<id>.json`。
 * run 对象由 T3 编排器 / POST 路由构造好传入（run 是内部产物非用户输入，store 不造 id 不做业务校验）。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 NOT_FOUND）。
 */
export class PipelineRunStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  private runsDir(projectId: string): string {
    return join(this.registry.get(projectId).root, ".pi", "factory", "runs");
  }

  private runPath(projectId: string, runId: string): string {
    return join(this.runsDir(projectId), `${runId}.json`);
  }

  /** 起 run 初次落盘（write 内自带 mkdir），写后顺手 GC（只在 create 触发，listRuns 保持纯读）。 */
  create(projectId: string, run: PipelineRun): void {
    this.write(projectId, run);
    this.pruneOld(projectId);
  }

  /** 读盘（不对账；对账是 reconcileOrphan 单独的事）。不存在抛 NOT_FOUND。 */
  get(projectId: string, runId: string): PipelineRun {
    const path = this.runPath(projectId, runId);
    if (!existsSync(path)) {
      throw new PipelineError("NOT_FOUND", `运行记录不存在: ${runId}`);
    }
    return this.readRun(path);
  }

  /**
   * 仅凭 runId 跨项目定位运行，返回 `{projectId, run}`（与 findTask 返回裸 task 不同）。
   * per-file try/catch 防坏文件；找不到抛 NOT_FOUND。
   */
  findRun(runId: string): { projectId: string; run: PipelineRun } {
    for (const project of this.registry.list()) {
      const path = join(project.root, ".pi", "factory", "runs", `${runId}.json`);
      if (existsSync(path)) {
        try {
          return { projectId: project.id, run: this.readRun(path) };
        } catch {
          continue;
        }
      }
    }
    throw new PipelineError("NOT_FOUND", `运行记录不存在: ${runId}`);
  }

  /**
   * 列该项目下某蓝图的最近 N 次运行：仿 listArtifacts 的 per-file try/catch（绝不仿 listVersions——
   * 后者 readVersion 抛错不跳过）。比 listVersions 多三件：① 按 pipelineId 过滤（runs/ 平铺混放所有
   * 蓝图的 run）② createdAt 倒序 ③ slice(0,N) 截断。目录不存在（从未起过 run）→ []。
   */
  listRuns(projectId: string, pipelineId: string): PipelineRun[] {
    const dir = this.runsDir(projectId);
    if (!existsSync(dir)) return [];
    const all: PipelineRun[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const run = this.readRun(join(dir, entry.name));
        if (run.pipelineId === pipelineId) all.push(run);
      } catch {
        // 跳坏文件，不拖垮整列表
      }
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.slice(0, RECENT_N);
  }

  /** 整体替换落盘（原子写，内含 mkdir）。运行时由 orchestrator 读-改-写驱动状态机。 */
  write(projectId: string, run: PipelineRun): void {
    this.atomicWrite(this.runPath(projectId, run.id), `${JSON.stringify(run, null, 2)}\n`);
  }

  /**
   * 读时对账（D-V1.2-45）：进程重启后，running 中的 run 的当前阶段会话已不在活 registry → 翻 failed。
   * 这是【有写盘副作用】的实例方法（命中孤儿就地 this.write），与纯函数 pruneMissing 本质不同。
   * liveSessionIds 由参数注入（API 层组装），领域层不读 globalThis、保持可单测。cur 用 ?. 兜越界。
   */
  reconcileOrphan(
    projectId: string,
    run: PipelineRun,
    liveSessionIds: Set<string>,
  ): PipelineRun {
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
   * 保留上限 M：总数 > M 时按 createdAt 删最旧。只删终态（done/failed）run，绝不删 running/pending
   * （避免删运行中 checkpoint）；unlink 用 try/catch 吞 ENOENT（并发已删）。
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
          terminal: r.status === "done" || r.status === "failed",
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

  private readRun(path: string): PipelineRun {
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as PipelineRun;
    } catch {
      throw new PipelineError("INVALID", `pipeline run 解析失败: ${path}`);
    }
  }

  /**
   * 「临时文件 + rename」原子落盘，内置 mkdir：run-store.create 入参已是完整 run、无「create 必先
   * write」保证，首跑 runs 目录不存在会 ENOENT，故仿 session-agent-map.writeMap 在写前建目录。
   */
  private atomicWrite(filePath: string, content: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}
