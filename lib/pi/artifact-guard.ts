import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { ArtifactService } from "../domain/artifact-service";
import {
  PendingChangeStore,
  buildReplacePendingChange,
  type PendingChange,
} from "../domain/pending-change-service";
import { ProjectRegistry } from "../domain/project-registry";
import { resolveManagedTarget } from "./artifact-intercept";

/**
 * 内核工具工厂返回具体 `ToolDefinition<具体schema,具体details>`，因 `renderCall`/`parameters`
 * 泛型逆变，把异构具体类型收进 `ToolDefinition[]`（= `ToolDefinition<TSchema,unknown>[]`）会方差报错
 * （阶段0/D-D2-1 实测）。内核自身用 `ToolDef = ToolDefinition<any,any>` 规避，但该别名未从包根导出、
 * 深 import 内核内部又触红线，故在此本地等价定义。`any` 限定在这一行（下游引用 GuardToolDef 不再触规则）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GuardToolDef = ToolDefinition<any, any>;

/**
 * 装配「受管 artifact 写保护」会话所需的依赖。
 * 这些经构造期闭包注入到工具 operations，使得：
 * - sourceActor 来源（D-D2-4）：execute 的 ctx(ExtensionContext) 不带 agent 身份，
 *   故由本闭包在装配时注入「哪个 agent 发起」。
 * - registry/service/store 用于运行时识别受管路径、读当前内容、落 PendingChange。
 */
export type ArtifactGuardDeps = {
  /** 哪个 agent 发起这次会话（写进 PendingChange.sourceActor）。 */
  sourceActor: string;
  /** 会话 cwd（默认放行路径的工作目录；工具工厂也按它构造）。 */
  cwd: string;
  registry?: ProjectRegistry;
  artifactService?: ArtifactService;
  pendingStore?: PendingChangeStore;
  /**
   * 拦截到一次受管写改动时的回调（可选）。默认行为是「落盘 PendingChange」，
   * 回调用于测试观测或调用方扩展（如推 SSE）。在落盘**之后**调用。
   */
  onIntercept?: (change: PendingChange, ctx: { projectId: string }) => void;
};

/**
 * 拦截一次「受管 artifact 的写盘」：读当前版内容当 oldContent、用 newContent 算 diff_blocks、
 * 落 PendingChange、**不写盘**。write 与 edit 的写盘动作在此统一处理（D-D2-5 取舍：
 * 走 operations 注入路线后，内核 edit 已把 edits 应用成 finalContent 才调 writeFile，
 * 注入端拿不到原始 edits，故统一按 op=replace 切块 —— diffBlocks 质量不降反升，
 * 因 edit 路径的 oldContent 由内核 fuzzy 对齐后生成；PendingChange.op 统一为 replace）。
 */
function interceptManagedWrite(
  target: { projectId: string; artifactId: string },
  newContent: string,
  deps: Required<Pick<ArtifactGuardDeps, "sourceActor">> & {
    artifactService: ArtifactService;
    pendingStore: PendingChangeStore;
    onIntercept?: ArtifactGuardDeps["onIntercept"];
  },
): void {
  // 此刻 artifact 版本未变（写盘被拦截），当前版内容即 oldContent
  const oldContent = deps.artifactService.readCurrentContent(target.projectId, target.artifactId);
  const change = buildReplacePendingChange({
    artifactId: target.artifactId,
    sourceActor: deps.sourceActor,
    oldContent,
    newContent,
  });
  deps.pendingStore.save(target.projectId, change);
  deps.onIntercept?.(change, { projectId: target.projectId });
}

/**
 * 构造「自分流」的 write/edit operations：受管路径→拦截转 PendingChange、非受管→委托真实 fs。
 * operations 是 cwd 级单一函数、对所有路径生效，故每个回调内部都先判 `resolveManagedTarget`。
 */
function buildGuardOperations(deps: ArtifactGuardDeps) {
  const registry = deps.registry ?? new ProjectRegistry();
  const artifactService = deps.artifactService ?? new ArtifactService(registry);
  const pendingStore = deps.pendingStore ?? new PendingChangeStore(registry);
  const interceptDeps = {
    sourceActor: deps.sourceActor,
    artifactService,
    pendingStore,
    onIntercept: deps.onIntercept,
  };

  const writeFile = async (absolutePath: string, content: string): Promise<void> => {
    const target = resolveManagedTarget(absolutePath, registry);
    if (target) {
      interceptManagedWrite(target, content, interceptDeps);
      return; // 受管：不写盘
    }
    await fsWriteFile(absolutePath, content, "utf-8"); // 非受管：正常写
  };

  const writeOperations = {
    writeFile,
    async mkdir(dir: string): Promise<void> {
      // 受管目标的父目录由 artifact-service 管理；命中受管则跳过建目录
      if (resolveManagedTarget(dir, registry)) return;
      await fsMkdir(dir, { recursive: true });
    },
  };

  const editOperations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      const target = resolveManagedTarget(absolutePath, registry);
      if (target) {
        // 受管：喂「当前版内容」给内核算 diff（而非读裸文件——受管内容存 versions/<n>.json）
        return Buffer.from(artifactService.readCurrentContent(target.projectId, target.artifactId), "utf-8");
      }
      return fsReadFile(absolutePath); // 非受管：真读盘
    },
    writeFile, // 与 write 工具共用拦截逻辑
    async access(absolutePath: string): Promise<void> {
      if (resolveManagedTarget(absolutePath, registry)) return; // 受管：视为可读写
      await fsAccess(absolutePath);
    },
  };

  return { writeOperations, editOperations };
}

/**
 * 产出可展开进 `createAgentSession(...)` 的 options：用注入了守卫 operations 的内核 write/edit
 * + 重建的 read/bash/grep/find/ls，组成完整工具集（决策 D-D2-1 选 C：保留内核 name/schema/diff
 * 生成与 edit 语义，仅把写盘动作改成「受管拦截 / 非受管放行」，零工具漂移）。
 *
 * 用法（调用方负责真正 new 会话，同 B2 assembleProfileSessionOptions 的边界）：
 *   const { options } = assembleArtifactGuardOptions({ sourceActor, cwd, ... });
 *   await createAgentSession({ ...profileOptions, ...options, model, ... });
 * 注意：`noTools:"builtin"` 让内置集为空、customTools 照常加入，避免 allowlist 把 write/edit 挡掉
 * （阶段0 实测候选 b 被证伪）。
 */
export function assembleArtifactGuardOptions(deps: ArtifactGuardDeps): {
  options: { noTools: "builtin"; customTools: GuardToolDef[] };
} {
  const { writeOperations, editOperations } = buildGuardOperations(deps);
  const customTools: GuardToolDef[] = [
    createWriteToolDefinition(deps.cwd, { operations: writeOperations }),
    createEditToolDefinition(deps.cwd, { operations: editOperations }),
    createReadToolDefinition(deps.cwd),
    createBashToolDefinition(deps.cwd),
    createGrepToolDefinition(deps.cwd),
    createFindToolDefinition(deps.cwd),
    createLsToolDefinition(deps.cwd),
  ];
  return { options: { noTools: "builtin", customTools } };
}
