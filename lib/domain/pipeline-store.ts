import { randomUUID } from "node:crypto";
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

/** 流水线蓝图的单个阶段（§2.1）。order 为 1..N 连续唯一的执行序。 */
export interface PipelineStageSpec {
  order: number;
  agentId: string;
  subTaskTemplate: string;
}

/** 流水线蓝图（§2.1）：一串按 order 顺序执行的阶段，随项目落盘到 `.pi/factory/pipelines/<id>.json`。 */
export interface PipelineBlueprint {
  id: string;
  projectId: string;
  name: string;
  stages: PipelineStageSpec[];
  createdAt: string;
  updatedAt: string;
}

/** create/update 的可写入参（id/createdAt/updatedAt 由存储填）。 */
type PipelineInput = {
  name: string;
  stages: { order: number; agentId: string; subTaskTemplate: string }[];
};

/**
 * 领域错误：code 由 API 层映射为 HTTP 状态（NOT_FOUND→404 / INVALID→422）。
 * 两个 store（pipeline-store / pipeline-run-store）共用同一个错误类，避免两份。
 */
export class PipelineError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * 流水线蓝图存储：蓝图随项目落盘到 `<projectRoot>/.pi/factory/pipelines/<id>.json`。
 * 仿 dispatch-store 的「临时文件 + rename」原子写，单进程单用户、无 DB。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 NOT_FOUND）。
 */
export class PipelineStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  /** `<projectRoot>/.pi/factory/pipelines`；registry.get 在 project 不存在时抛 ProjectError NOT_FOUND。 */
  private pipelinesDir(projectId: string): string {
    return join(this.registry.get(projectId).root, ".pi", "factory", "pipelines");
  }

  private blueprintPath(projectId: string, pipelineId: string): string {
    return join(this.pipelinesDir(projectId), `${pipelineId}.json`);
  }

  /**
   * 校验 + 归一（create/update 共用，杜绝两处漂移）：名称非空、阶段数 >=1、每阶段
   * agentId/subTaskTemplate 非空、order 为整数；order 集合须为 {1..N} 连续无重无缺
   * （精确判别式=排序后逐位 ===i+1，一次覆盖重复/缺号/含 0/负/小数/乱序）。
   * 通过后按 order 升序归一落盘（唯一执行序）。
   */
  private validateAndNormalize(input: PipelineInput): {
    name: string;
    stages: PipelineStageSpec[];
  } {
    const name = (input.name ?? "").trim();
    if (!name) throw new PipelineError("INVALID", "蓝图名称不能为空");

    const raw = input.stages ?? [];
    if (raw.length < 1) {
      throw new PipelineError("INVALID", `阶段数须 >=1，收到 ${raw.length}`);
    }
    const stages: PipelineStageSpec[] = raw.map((s) => {
      const agentId = (s.agentId ?? "").trim();
      const subTaskTemplate = (s.subTaskTemplate ?? "").trim();
      if (!agentId) throw new PipelineError("INVALID", "阶段 agentId 不能为空");
      if (!subTaskTemplate) throw new PipelineError("INVALID", "阶段 subTaskTemplate 不能为空");
      if (typeof s.order !== "number" || !Number.isInteger(s.order)) {
        throw new PipelineError("INVALID", `阶段 order 须为整数，收到 ${s.order}`);
      }
      return { order: s.order, agentId, subTaskTemplate };
    });

    const sorted = [...stages].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].order !== i + 1) {
        throw new PipelineError(
          "INVALID",
          `order 须为 1..${sorted.length} 连续无重无缺，第 ${i + 1} 位为 ${sorted[i].order}`,
        );
      }
    }
    return { name, stages: sorted };
  }

  /** 建蓝图：校验 + 归一后落盘（write 内自带 mkdir）。返回新建蓝图。 */
  create(projectId: string, input: PipelineInput): PipelineBlueprint {
    const { name, stages } = this.validateAndNormalize(input);
    const now = new Date().toISOString();
    const bp: PipelineBlueprint = {
      id: randomUUID(),
      projectId,
      name,
      stages,
      createdAt: now,
      updatedAt: now,
    };
    this.write(projectId, bp);
    return bp;
  }

  get(projectId: string, pipelineId: string): PipelineBlueprint {
    const path = this.blueprintPath(projectId, pipelineId);
    if (!existsSync(path)) {
      throw new PipelineError("NOT_FOUND", `流水线蓝图不存在: ${pipelineId}`);
    }
    return this.readBlueprint(path);
  }

  /**
   * 列该项目下所有蓝图，按 updatedAt 倒序（最近改在前）。目录不存在（尚无蓝图）→ []。
   * 解析失败的条目跳过（per-file try/catch，仿 listArtifacts，不因单个坏文件拖垮整列表）。
   */
  list(projectId: string): PipelineBlueprint[] {
    const dir = this.pipelinesDir(projectId);
    if (!existsSync(dir)) return [];
    const out: PipelineBlueprint[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        out.push(this.readBlueprint(join(dir, entry.name)));
      } catch {
        // 跳过坏掉的蓝图 json，不让单个解析失败拖垮整列表
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }

  /**
   * 整体替换蓝图（PUT 语义）：先 get 兜 NOT_FOUND（在校验 patch 之前，不写孤儿），
   * 复用同一校验，`{...current}` 保 id/projectId/createdAt（仿 project-registry.update），
   * 只换 name/stages/updatedAt。
   */
  update(projectId: string, pipelineId: string, patch: PipelineInput): PipelineBlueprint {
    const current = this.get(projectId, pipelineId);
    const { name, stages } = this.validateAndNormalize(patch);
    const next: PipelineBlueprint = {
      ...current,
      name,
      stages,
      updatedAt: new Date().toISOString(),
    };
    this.write(projectId, next);
    return next;
  }

  /** 仅删蓝图 json；历史 run 在 `.pi/factory/runs/` 另目录不动（天然保留）。先 get 兜 NOT_FOUND 再 unlink。 */
  delete(projectId: string, pipelineId: string): void {
    this.get(projectId, pipelineId);
    unlinkSync(this.blueprintPath(projectId, pipelineId));
  }

  /**
   * 仅凭 pipelineId 跨项目定位蓝图（cancel/run 备用，本卡 API 主用 get(projectId,...)）。
   * 返回 `{projectId, blueprint}`。per-file try/catch 防坏文件让定位崩；找不到抛 NOT_FOUND。
   */
  findBlueprint(pipelineId: string): { projectId: string; blueprint: PipelineBlueprint } {
    for (const project of this.registry.list()) {
      const path = join(project.root, ".pi", "factory", "pipelines", `${pipelineId}.json`);
      if (existsSync(path)) {
        try {
          return { projectId: project.id, blueprint: this.readBlueprint(path) };
        } catch {
          continue;
        }
      }
    }
    throw new PipelineError("NOT_FOUND", `流水线蓝图不存在: ${pipelineId}`);
  }

  /** 整体替换落盘（原子写，内含 mkdir）。 */
  write(projectId: string, bp: PipelineBlueprint): void {
    this.atomicWrite(this.blueprintPath(projectId, bp.id), `${JSON.stringify(bp, null, 2)}\n`);
  }

  private readBlueprint(path: string): PipelineBlueprint {
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as PipelineBlueprint;
    } catch {
      throw new PipelineError("INVALID", `pipeline blueprint 解析失败: ${path}`);
    }
  }

  /**
   * 「临时文件 + rename」原子落盘，内置 mkdir（仿 session-agent-map.writeMap，更稳）。
   * 不依赖「create 必先 write」的调用顺序，全新项目首跑也不 ENOENT。
   */
  private atomicWrite(filePath: string, content: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}
