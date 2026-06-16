/**
 * 从 Markdown 正文解析目录（TOC）：扫 ATX 标题（`#`..`######`），产出层级 + 文本 + slug。
 * 纯函数、不依赖 DOM，供 ArtifactPanel 渲染 TOC 与锚点跳转（AC①）。
 *
 * 规则（保持极简，只覆盖 artifact 文档常见写法）：
 * - 仅识别 ATX 标题（行首 1–6 个 `#` + 空格 + 文本）；Setext（=== / ---）不识别（文档型 artifact 少用）。
 * - 跳过围栏代码块（``` 或 ~~~ 之间）内的 `#`，避免把代码注释当标题。
 * - slug 去重：同名标题加 `-1` / `-2` 后缀，保证锚点唯一。
 */
export type TocItem = {
  /** 标题级别 1–6（# = 1）。 */
  level: number;
  /** 标题纯文本（去掉前导 `#` 与首尾空白；不剥离行内 markdown 标记，渲染层自行处理）。 */
  text: string;
  /** 锚点 id（kebab 化 + 去重），与渲染层给标题元素加的 id 对应。 */
  slug: string;
};

/** 把标题文本 kebab 化为 slug（保留中文/字母数字，空白→`-`，去掉其余符号）。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // 仅留字母(含中文)/数字/空白/连字符
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function parseToc(content: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (const raw of content.split("\n")) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = ATX_HEADING.exec(raw);
    if (!m) continue;

    const level = m[1].length;
    const text = m[2].trim();
    if (text === "") continue;

    const base = slugify(text) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const slug = n === 0 ? base : `${base}-${n}`;

    items.push({ level, text, slug });
  }

  return items;
}
