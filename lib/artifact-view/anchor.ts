/**
 * 行内高亮锚定（AC②③）：把 pending 的 DiffBlock 就近叠加到当前版本正文上。
 * 移植自 sf-mini `InlineHighlightView.buildSegments` 的子序列锚定思路，
 * **适配点**：本项目 artifact 是裸文本、DiffBlock.lines 也是裸行（无 `"+ "/"- "` 前缀），
 * 故锚定对象 = 当前版本文本行；mod 块的新行 = `lines`、旧行 = `oldLines`（sf-mini 是同串里按前缀过滤）。
 *
 * 锚定策略（与 sf-mini 一致，保证「只改某一段」的就近展示）：
 * - add / mod：用块的新行（`lines`）作为锚，在正文中从游标位置起找完全相等的连续子序列；
 *   命中则该区间归属此块（套 add 绿 / mod 黄），游标后移；找不到 → 收进 unaligned。
 * - del：被删行在新正文中无位置，按当前游标顺序就近插入（以删除线红字展示）。
 * - 只处理 state==="pending" 的块由调用方先过滤（这里假设传入的都是 pending）。
 */
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/** 一段渲染单元：plain（未改动，原样 markdown）或 hl（命中某块的高亮段）。 */
export type Segment =
  | { type: "plain"; text: string }
  | {
      type: "hl";
      block: DiffBlock;
      /** 该段在正文中的文本（del 块为空串——它在新正文无对应行）。 */
      text: string;
      /** 被删除的旧行（del 块 = 自身 lines；mod 块 = oldLines；add 块 = []）。 */
      removed: string[];
      /**
       * 该块所属 PendingChange 的 id（供 T3 内联段就地 ✓/✗ 调 resolve）；
       * 由 buildSegments 的可选入参 changeIdByBlock 注入，未传时 undefined。
       */
      changeId?: string;
    };

/** 在 hay 中从 from 起查找与 needle 完全相等的连续子序列起点；找不到返回 -1。 */
export function findSubsequence(hay: string[], needle: string[], from: number): number {
  if (needle.length === 0) return -1;
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) {
      if (hay[i + k] !== needle[k]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * 把当前版本正文 + pending 块切成有序的渲染段。
 * 返回 segs（按正文顺序）与 unaligned（无法在正文定位的块，调用方据此提示切并排 Diff）。
 *
 * @param changeIdByBlock 可选 blockId → 所属 changeId 映射；命中时把 changeId 注入对应 hl 段。
 *   纯增量、向后兼容：旧的 2 参调用照常工作（changeId 为 undefined）。调用方（T3 ArtifactPanel）
 *   从稳定的 pendingChanges 用 useMemo 就地构造此 Map，避免 D-D3-10 无限重渲染。
 */
export function buildSegments(
  content: string,
  pendingBlocks: DiffBlock[],
  changeIdByBlock?: Map<string, string>,
): { segs: Segment[]; unaligned: DiffBlock[] } {
  const docLines = content.split("\n");
  const owner = new Array<DiffBlock | null>(docLines.length).fill(null);
  const unaligned: DiffBlock[] = [];
  const delAt: Record<number, DiffBlock[]> = {};
  let cursor = 0;

  for (const b of pendingBlocks) {
    if (b.kind === "del") {
      (delAt[cursor] ||= []).push(b);
      continue;
    }
    // add / mod 的锚 = 新行（本项目 lines 即裸新行）
    const anchor = b.lines;
    if (anchor.length === 0) {
      unaligned.push(b);
      continue;
    }
    const start = findSubsequence(docLines, anchor, cursor);
    if (start < 0) {
      unaligned.push(b);
      continue;
    }
    for (let k = start; k < start + anchor.length; k++) owner[k] = b;
    cursor = start + anchor.length;
  }

  const segs: Segment[] = [];
  const pushDelAt = (idx: number) => {
    for (const b of delAt[idx] ?? []) {
      segs.push({ type: "hl", block: b, text: "", removed: b.lines, changeId: changeIdByBlock?.get(b.id) });
    }
  };

  let i = 0;
  while (i < docLines.length) {
    pushDelAt(i);
    const o = owner[i];
    let j = i;
    while (j < docLines.length && owner[j] === o) j++;
    const text = docLines.slice(i, j).join("\n");
    if (o === null) {
      segs.push({ type: "plain", text });
    } else {
      const removed = o.kind === "mod" ? (o.oldLines ?? []) : [];
      segs.push({ type: "hl", block: o, text, removed, changeId: changeIdByBlock?.get(o.id) });
    }
    i = j;
  }
  pushDelAt(docLines.length);
  return { segs, unaligned };
}
