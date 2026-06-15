import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectRegistry } from "./project-registry";

/**
 * 一个 diff 块 = 「只改了某一段」的最小单元。权威类型见 docs/03:79-86。
 * kind：add(纯新增) / del(纯删除) / mod(替换：旧行→新行)。
 * lines：该块涉及的行（add/mod 存新行，del 存旧行；mod 存新行、旧行进 oldLines 便于并排渲染）。
 * state：逐块确认状态，初始 pending；渲染层过滤 state≠pending 的块（docs/03:91）。
 */
export type DiffBlock = {
  id: string;
  kind: "add" | "del" | "mod";
  tag?: string;
  lines: string[];
  /** mod 块的旧行（add/del 块省略）；用于并排 Diff 展示「改成什么之前是什么」。 */
  oldLines?: string[];
  state: "pending" | "confirmed" | "rejected";
};

/**
 * 一次未确认的块级变更。权威类型见 docs/03:67-77。
 * op：replace(write 整文件替换) / patch(edit 局部替换)。
 * diff：原始改动数据（replace 存 {oldContent,newContent}；patch 存 edits[]），供回溯/并排。
 * sourceActor：哪个 agent 发起（D-D2-4 由工厂闭包注入，execute 的 ctx 不带身份）。
 * hitlMode：per_block 逐块确认（MVP 默认）/ whole 整体 / auto 自动。
 */
export type PendingChange = {
  id: string;
  artifactId: string;
  targetType: string;
  op: "replace" | "patch";
  diff: PendingChangeDiff;
  diffBlocks: DiffBlock[];
  sourceActor: string;
  hitlMode: "per_block" | "whole" | "auto";
  createdAt: string;
};

/** 原始改动数据：replace 携整文件新旧内容；patch 携 edit 列表。 */
export type PendingChangeDiff =
  | { kind: "replace"; oldContent: string; newContent: string }
  | { kind: "patch"; edits: { oldText: string; newText: string }[] };

/** 领域错误：code 由 API 层映射为 HTTP 状态（NOT_FOUND→404 / INVALID→422）。 */
export class PendingChangeError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "PendingChangeError";
  }
}

// ---------------------------------------------------------------------------
// 切块纯函数（手写极简行级 diff，无第三方依赖；文档型 artifact 行数有限，DP-LCS 足够）
// ---------------------------------------------------------------------------

/**
 * 把文本按行切分（保留空文件 → 空数组语义）。
 * 末尾换行不额外产出一个空行项（"a\n" → ["a"]，与编辑器「a 后有换行」直觉一致）。
 */
function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "del"; line: string }
  | { type: "add"; line: string };

/**
 * 经典 LCS（最长公共子序列）行级 diff：返回 equal/del/add 的有序序列。
 * 删除排在新增之前（del 段后紧跟 add 段时由调用方合并为 mod 块）。
 */
function lcsDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;
  // dp[i][j] = oldLines[i..] 与 newLines[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", line: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "add", line: newLines[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: "del", line: oldLines[i++] });
  while (j < n) ops.push({ type: "add", line: newLines[j++] });
  return ops;
}

function makeBlock(
  kind: DiffBlock["kind"],
  lines: string[],
  oldLines?: string[],
): DiffBlock {
  return {
    id: randomUUID(),
    kind,
    lines,
    ...(oldLines !== undefined ? { oldLines } : {}),
    state: "pending",
  };
}

/**
 * 把 LCS 编辑序列聚成 DiffBlock 列表：
 * - 连续 del 段后紧跟连续 add 段 → 合并为一个 mod 块（lines=新行, oldLines=旧行）。
 * - 仅 del 段 → del 块；仅 add 段 → add 块。
 * - equal 段不产出块（未改动的行不进 PendingChange）。
 */
function groupOpsToBlocks(ops: DiffOp[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === "equal") {
      k++;
      continue;
    }
    // 收集一段连续的 del
    const dels: string[] = [];
    while (k < ops.length && ops[k].type === "del") {
      dels.push(ops[k].line);
      k++;
    }
    // 收集紧跟的一段连续 add
    const adds: string[] = [];
    while (k < ops.length && ops[k].type === "add") {
      adds.push(ops[k].line);
      k++;
    }
    if (dels.length > 0 && adds.length > 0) {
      blocks.push(makeBlock("mod", adds, dels));
    } else if (dels.length > 0) {
      blocks.push(makeBlock("del", dels));
    } else if (adds.length > 0) {
      blocks.push(makeBlock("add", adds));
    }
  }
  return blocks;
}

/**
 * write（整文件替换）的切块：旧全文 vs 新全文 → 行级 diff → 聚块。
 * 内容完全相同 → 空块数组（无改动，调用方据此决定是否仍建 PendingChange）。
 */
export function computeReplaceDiffBlocks(oldContent: string, newContent: string): DiffBlock[] {
  return groupOpsToBlocks(lcsDiff(splitLines(oldContent), splitLines(newContent)));
}

/**
 * edit（局部替换）的切块：每个 {oldText,newText} 是一处独立改动，逐个切块。
 * 单个 edit 内部仍跑行级 diff（oldText 多行→newText 多行也能精确到行），
 * 再把该 edit 产出的块拼进总列表（保持 edit 顺序）。
 */
export function computeEditDiffBlocks(edits: { oldText: string; newText: string }[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  for (const e of edits) {
    blocks.push(...computeReplaceDiffBlocks(e.oldText, e.newText));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// PendingChange 组装 + 落盘
// ---------------------------------------------------------------------------

/** 组装一个 replace（write 拦截）PendingChange，不落盘（落盘由 store）。 */
export function buildReplacePendingChange(args: {
  artifactId: string;
  sourceActor: string;
  oldContent: string;
  newContent: string;
  hitlMode?: PendingChange["hitlMode"];
}): PendingChange {
  return {
    id: randomUUID(),
    artifactId: args.artifactId,
    targetType: "artifact",
    op: "replace",
    diff: { kind: "replace", oldContent: args.oldContent, newContent: args.newContent },
    diffBlocks: computeReplaceDiffBlocks(args.oldContent, args.newContent),
    sourceActor: args.sourceActor,
    hitlMode: args.hitlMode ?? "per_block",
    createdAt: new Date().toISOString(),
  };
}

/** 组装一个 patch（edit 拦截）PendingChange，不落盘（落盘由 store）。 */
export function buildPatchPendingChange(args: {
  artifactId: string;
  sourceActor: string;
  edits: { oldText: string; newText: string }[];
  hitlMode?: PendingChange["hitlMode"];
}): PendingChange {
  return {
    id: randomUUID(),
    artifactId: args.artifactId,
    targetType: "artifact",
    op: "patch",
    diff: { kind: "patch", edits: args.edits },
    diffBlocks: computeEditDiffBlocks(args.edits),
    sourceActor: args.sourceActor,
    hitlMode: args.hitlMode ?? "per_block",
    createdAt: new Date().toISOString(),
  };
}

/**
 * PendingChange 存储：随受管 artifact 落盘到 `<projectRoot>/.pi/artifacts/managed/<artifactId>/pending/<id>.json`，
 * 与 D1 的 `artifact.json` / `versions/<n>.json` 平级隔离（D-D2-3）。
 * 仿 dispatch-store 的「临时文件 + rename」原子写，单进程单用户、无 DB。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 ProjectError NOT_FOUND）。
 */
export class PendingChangeStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  /** `<projectRoot>/.pi/artifacts/managed/<artifactId>/pending`。 */
  private pendingDir(projectId: string, artifactId: string): string {
    return join(
      this.registry.get(projectId).root,
      ".pi",
      "artifacts",
      "managed",
      artifactId,
      "pending",
    );
  }

  private pendingPath(projectId: string, artifactId: string, id: string): string {
    return join(this.pendingDir(projectId, artifactId), `${id}.json`);
  }

  /** 落盘一条 PendingChange（原子写）。返回落盘的同一对象。 */
  save(projectId: string, change: PendingChange): PendingChange {
    const dir = this.pendingDir(projectId, change.artifactId);
    mkdirSync(dir, { recursive: true });
    this.atomicWrite(
      this.pendingPath(projectId, change.artifactId, change.id),
      `${JSON.stringify(change, null, 2)}\n`,
    );
    return change;
  }

  /** 精确读一条 PendingChange；不存在抛 NOT_FOUND。 */
  get(projectId: string, artifactId: string, id: string): PendingChange {
    const path = this.pendingPath(projectId, artifactId, id);
    if (!existsSync(path)) {
      throw new PendingChangeError("NOT_FOUND", `pending change 不存在: ${id}`);
    }
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as PendingChange;
    } catch {
      throw new PendingChangeError("INVALID", `pending change 解析失败: ${path}`);
    }
  }

  /** 「临时文件 + rename」原子落盘（仿 dispatch-store.atomicWrite）。 */
  private atomicWrite(filePath: string, content: string): void {
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}
