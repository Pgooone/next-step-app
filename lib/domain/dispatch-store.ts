import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectRegistry } from "./project-registry";

/** 派发任务 / 子任务的状态机。权威类型见 docs/03:26-41。 */
export type DispatchStatus = "pending" | "running" | "done" | "failed";

/** 一个子任务 = 把某子任务派给某 Agent 档案执行。权威类型见 docs/03:34-41。 */
export type Assignment = {
  agentId: string;
  subTask: string;
  sessionId?: string;
  status: DispatchStatus;
  output?: string; // 产物路径（相对 projectRoot）或摘要
  /** 本 assignment 的 worker 经 create_artifact 新建的受管文档 id（文档型派发把受管文档当权威产物，T4）。
   *  可选：coding/纯文本 worker 无此字段；旧任务亦无（无迁移、按可选处理）。 */
  artifactId?: string;
};

/** 一次派发 = 一个目标 + 一串串行执行的子任务。权威类型见 docs/03:26-32。 */
export type DispatchTask = {
  id: string; // uuid
  projectId: string;
  goal: string;
  assignments: Assignment[];
  status: DispatchStatus;
};

/** 领域错误：code 由 API 层映射为 HTTP 状态（NOT_FOUND→404 / INVALID→422）。 */
export class DispatchError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

/** create 的可写入参（白名单；id/status/sessionId/output 由存储与运行时填）。 */
type DispatchInput = {
  goal: string;
  assignments: { agentId: string; subTask: string }[];
};

/**
 * 派发任务存储：任务随项目落盘到 `<projectRoot>/.pi/dispatch/<taskId>.json`。
 * 仿 agent-profile-store 的「临时文件 + rename」原子写，单进程单用户、无 DB。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 NOT_FOUND）。
 */
export class DispatchStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  /** `<projectRoot>/.pi/dispatch`；registry.get 在 project 不存在时抛 ProjectError NOT_FOUND。 */
  private dispatchDir(projectId: string): string {
    return join(this.registry.get(projectId).root, ".pi", "dispatch");
  }

  private taskPath(projectId: string, taskId: string): string {
    return join(this.dispatchDir(projectId), `${taskId}.json`);
  }

  /**
   * 建任务：校验 goal 非空、assignments 数量 2–3（§5.3「2–3 个 assignment」）、每条 agentId/subTask 非空，
   * 落盘初始 status=pending（各 assignment 同为 pending）。返回新建任务。
   */
  create(projectId: string, input: DispatchInput): DispatchTask {
    const goal = (input.goal ?? "").trim();
    if (!goal) throw new DispatchError("INVALID", "goal 不能为空");

    const rawAssignments = input.assignments ?? [];
    if (rawAssignments.length < 2 || rawAssignments.length > 3) {
      throw new DispatchError("INVALID", `assignment 数量须为 2–3，收到 ${rawAssignments.length}`);
    }
    const assignments: Assignment[] = rawAssignments.map((a) => {
      const agentId = (a.agentId ?? "").trim();
      const subTask = (a.subTask ?? "").trim();
      if (!agentId) throw new DispatchError("INVALID", "assignment.agentId 不能为空");
      if (!subTask) throw new DispatchError("INVALID", "assignment.subTask 不能为空");
      return { agentId, subTask, status: "pending" };
    });

    const task: DispatchTask = {
      id: randomUUID(),
      projectId,
      goal,
      assignments,
      status: "pending",
    };

    const dir = this.dispatchDir(projectId);
    mkdirSync(dir, { recursive: true });
    this.write(projectId, task);
    return task;
  }

  get(projectId: string, taskId: string): DispatchTask {
    const path = this.taskPath(projectId, taskId);
    if (!existsSync(path)) {
      throw new DispatchError("NOT_FOUND", `派发任务不存在: ${taskId}`);
    }
    return this.readTask(path);
  }

  /**
   * 仅凭 taskId 跨项目定位任务（契约 `GET /api/dispatch/[taskId]` 路径无 projectId，
   * 而任务随项目落盘 §03，故需扫描 registry 所有项目的 `.pi/dispatch/<taskId>.json`）。
   * 决策见 decisions.md（待 lead 记）。命中即返回，找不到抛 NOT_FOUND。
   */
  findTask(taskId: string): DispatchTask {
    for (const project of this.registry.list()) {
      const path = join(project.root, ".pi", "dispatch", `${taskId}.json`);
      if (existsSync(path)) return this.readTask(path);
    }
    throw new DispatchError("NOT_FOUND", `派发任务不存在: ${taskId}`);
  }

  private readTask(path: string): DispatchTask {
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as DispatchTask;
    } catch {
      throw new DispatchError("INVALID", `dispatch task 解析失败: ${path}`);
    }
  }

  /** 整体替换落盘（原子写）。运行时由 orchestrator 读-改-写驱动状态机。 */
  write(projectId: string, task: DispatchTask): void {
    this.atomicWrite(this.taskPath(projectId, task.id), `${JSON.stringify(task, null, 2)}\n`);
  }

  /** 「临时文件 + rename」原子落盘（仿 agent-profile-store.atomicWrite）。 */
  private atomicWrite(filePath: string, content: string): void {
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}
