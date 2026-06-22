/**
 * 版本间行内 diff 聚块纯算法（**零 node/外部依赖、客户端安全**，第二轮 T1 / D-R2-01）。
 *
 * 抽出动机：版本对比要在 **客户端**（`"use client"` 的 ArtifactPanel）把「两版 content」算成
 * `DiffBlock[]`，但现成的 `computeReplaceDiffBlocks`（`pending-change-service.ts:129`）身处
 * server-only 模块——其顶部值导入 `node:crypto`/`node:fs`/`node:path`（:1-14）。客户端 **值导入**
 * 它会把整条 server-only 链（→ node:fs）拖进客户端 bundle、Turbopack 报
 * `the chunking context does not support external modules (request: node:fs)` 致全站 500
 * （D-R7B-07 血泪，`lcs.ts:1-11` 已记载）。
 *
 * 故本模块**只从 `lib/domain/lcs.ts` 值导入** `lcsDiff`/`splitLines`（纯函数、无 node 依赖），
 * `DiffBlock` 仅 `import type`（编译期擦除、不拖运行时依赖）；**绝不**值导入 pending-change-service。
 * 聚块逻辑照搬 `groupOpsToBlocks`（`pending-change-service.ts:94-123`）、聚块循环与
 * `anchor.ts:36-49` 的 `buildLineDiffSegments` 逐字一致——保证 block 与渲染段对齐绝不漂移
 * （D-R7B-04）。与 `makeBlock`/`groupOpsToBlocks` 产出**完全一致**，仅两处刻意不同：
 * - `id`：用**确定性序号** `v-${idx}`（绝不用 `node:crypto.randomUUID`，否则引入 node 依赖）。
 *   id 只供 React key 与 `data-block-id`。
 * - `state`：取 `'confirmed'`（非 `'pending'`）——版本对比是已提交历史，且这样能让降级判定
 *   （`degrade.ts` 基于 `state==='pending'` 计数）不误判（D-R2-03 另按总块数判降级）。
 */
import type { DiffBlock } from "@/lib/domain/pending-change-service";
import { lcsDiff, splitLines } from "../domain/lcs";

/**
 * 造一个版本 diff 块（对应 `pending-change-service.ts:makeBlock`，仅 id/state 不同，见模块头注）。
 * @param idx 块在结果序列里的下标，用于生成确定性 id。
 */
function makeVersionBlock(
  kind: DiffBlock["kind"],
  lines: string[],
  idx: number,
  oldLines?: string[],
): DiffBlock {
  return {
    id: `v-${idx}`,
    kind,
    lines,
    ...(oldLines !== undefined ? { oldLines } : {}),
    state: "confirmed",
  };
}

/**
 * 把两版内容算成 `DiffBlock[]`：旧全文 vs 新全文 → 行级 LCS diff → 聚块。
 * 等价于 `groupOpsToBlocks(lcsDiff(splitLines(old), splitLines(new)))`（写盘端 server-only），
 * 但客户端安全（见模块头注）。
 *
 * 聚块循环与 `pending-change-service.ts:groupOpsToBlocks` / `anchor.ts:36-49` 逐字一致：
 * - 连续 del 段后紧跟连续 add 段 → 合并为一个 mod 块（lines=新行, oldLines=旧行）。
 * - 仅 del 段 → del 块；仅 add 段 → add 块。
 * - equal 段不产出块。
 * 内容完全相同（或两侧皆空）→ 空块数组。
 */
export function computeVersionDiffBlocks(oldContent: string, newContent: string): DiffBlock[] {
  const ops = lcsDiff(splitLines(oldContent), splitLines(newContent));
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
      blocks.push(makeVersionBlock("mod", adds, blocks.length, dels));
    } else if (dels.length > 0) {
      blocks.push(makeVersionBlock("del", dels, blocks.length));
    } else if (adds.length > 0) {
      blocks.push(makeVersionBlock("add", adds, blocks.length));
    }
  }
  return blocks;
}
