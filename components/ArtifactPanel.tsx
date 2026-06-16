"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useArtifactStore,
  selectPendingBlocks,
} from "@/lib/stores/useArtifactStore";
import { parseToc, slugify, type TocItem } from "@/lib/artifact-view/toc";
import { buildSegments, type Segment } from "@/lib/artifact-view/anchor";
import {
  INLINE_HL_LIMIT,
  shouldDegradeToDiff,
  countPendingBlocks,
} from "@/lib/artifact-view/degrade";
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/**
 * ArtifactPanel（D3，§5.4）：右侧面板里渲染受管 artifact 的「Notion 式只改一段」视图。
 * 纯渲染（D-D3-1）：完整内容 + TOC（AC①）、pending 块行内高亮（AC②③）、块数超限降级（AC④）、
 * 并排 Diff 切换（AC⑤）、划选引用到对话框（AC⑥）。
 * **不做** resolve / 逐块确认 / 版本切换（D4 / §5.5 / §5.6）。
 *
 * 配色沿用基座内联 `var(--...)` 主题（同 FileViewer），不引 Tailwind；
 * 渲染结构与锚定语义移植自 sf-mini InlineHighlightView / DiffBlockView（只取渲染、去 resolve）。
 */

// add 绿 / del 红 / mod 黄 三态配色（AC②）。border-left 3px + 浅色底，复用 FileViewer 的 diff 色值。
const KIND_STYLE: Record<
  DiffBlock["kind"],
  { wrap: string; border: string; tag: string; tagText: string; label: string }
> = {
  add: { wrap: "rgba(0,200,80,0.12)", border: "#4ade80", tag: "#16a34a", tagText: "新增", label: "add" },
  del: { wrap: "rgba(240,60,60,0.14)", border: "#f87171", tag: "#dc2626", tagText: "删除", label: "del" },
  mod: { wrap: "rgba(234,179,8,0.14)", border: "#eab308", tag: "#ca8a04", tagText: "修改", label: "mod" },
};

/**
 * Markdown 渲染包装：复用 FileViewer 的 `.markdown-body` 样式，并给标题注入 `data-slug`
 * （与 parseToc 的 slugify 一致），供 TOC 点击跳转定位（AC①）。同名标题取首个命中即可。
 */
function Markdown({ children }: { children: string }) {
  const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function H({ children: kids }: { children?: React.ReactNode }) {
      const text = typeof kids === "string" ? kids : Array.isArray(kids) ? kids.join("") : "";
      return <Tag data-slug={slugify(text)}>{kids}</Tag>;
    };
  return (
    <div className="markdown-body markdown-file-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4"), h5: heading("h5"), h6: heading("h6") }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function ArtifactPanel() {
  const artifact = useArtifactStore((s) => s.artifact);
  const loading = useArtifactStore((s) => s.loading);
  const error = useArtifactStore((s) => s.error);
  const viewMode = useArtifactStore((s) => s.viewMode);
  const setViewMode = useArtifactStore((s) => s.setViewMode);
  const setEditTarget = useArtifactStore((s) => s.setEditTarget);
  // D5 版本管理态。
  const versions = useArtifactStore(useShallow((s) => s.versions));
  const selectedVersion = useArtifactStore((s) => s.selectedVersion);
  const historyContent = useArtifactStore((s) => s.historyContent);
  const rollbackBusy = useArtifactStore((s) => s.rollbackBusy);
  const rollbackError = useArtifactStore((s) => s.rollbackError);
  const listVersions = useArtifactStore((s) => s.listVersions);
  const selectVersion = useArtifactStore((s) => s.selectVersion);
  const rollback = useArtifactStore((s) => s.rollback);
  // selectPendingBlocks 每次 flatMap+filter 返回新数组引用，直接订阅会让 zustand 的
  // useSyncExternalStore 快照恒不等（Object.is）→ 无限重渲染（getSnapshot should be cached /
  // Maximum update depth）。用 useShallow 逐元素浅比较：DiffBlock 元素来自稳定的
  // store.pendingChanges，pending 集不变时数组相等、返回同一引用，循环消除（D-D3-10，match
  // DispatchPanel/ProjectSwitcher/AgentManager 派生 selector 先例）。
  const pendingBlocks = useArtifactStore(useShallow(selectPendingBlocks));

  const contentRef = useRef<HTMLDivElement>(null);
  // rollback 二次确认（D-D5-5 两步按钮，非原生 confirm）。
  const [confirmRollback, setConfirmRollback] = useState(false);

  // 版本列表随 artifact 打开 / currentVersion 变化（rollback、D4 物化新版）统一重拉。
  const currentVersion = artifact?.currentVersion;
  useEffect(() => {
    if (currentVersion != null) void listVersions();
  }, [currentVersion, listVersions]);

  // D-D5-4：看历史版（selectedVersion 非 null 且 ≠ 当前版）= 只读快照、无 pending 高亮、无 Diff。
  const viewingHistory =
    selectedVersion != null && artifact != null && selectedVersion !== artifact.currentVersion;
  // 渲染用内容：看历史版用 historyContent 快照，否则用当前版 content。
  const displayContent = viewingHistory ? (historyContent ?? "") : (artifact?.content ?? "");

  const toc = useMemo(() => parseToc(displayContent), [displayContent]);

  // AC④：pending 块数 > INLINE_HL_LIMIT 自动降级为并排 Diff（即使用户没点切换）。
  // 看历史版时不叠 pending（viewingHistory 直接走只读渲染分支）。
  const pendingCount = countPendingBlocks(pendingBlocks);
  const degraded = shouldDegradeToDiff(pendingCount);
  const effectiveMode: "inline" | "diff" = degraded ? "diff" : viewMode;

  // AC⑥：划选 artifact 正文 → 写 editTarget.quoteText（ChatWindow 引用条读取）。
  const handleQuote = () => {
    if (!artifact) return;
    const sel = window.getSelection?.();
    const text = sel?.toString().trim();
    if (!text) return;
    setEditTarget({ targetArtifactId: artifact.id, quoteText: text });
    sel?.removeAllRanges();
  };

  if (loading) {
    return <Centered>加载产物…</Centered>;
  }
  if (error) {
    return <Centered color="#f87171">{error}</Centered>;
  }
  if (!artifact) {
    return <Centered color="var(--text-dim)">未打开产物</Centered>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 状态栏：标题 + 版本 + pending 计数 + 视图切换（AC⑤） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }} title={artifact.title}>
          {artifact.title}
        </span>
        {/* 版本下拉（D5 §5.6 AC③）：「最新 (v{n})」跟随最新，选历史版只读看快照（D-D5-4）。 */}
        <select
          value={viewingHistory ? String(selectedVersion) : ""}
          onChange={(e) => {
            setConfirmRollback(false);
            const val = e.target.value;
            void selectVersion(val === "" ? null : Number(val));
          }}
          title="切换查看的版本"
          style={selectStyle}
        >
          <option value="">最新 (v{artifact.currentVersion})</option>
          {versions
            .filter((v) => v.version !== artifact.currentVersion)
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.note ? ` · ${v.note}` : ""}
              </option>
            ))}
        </select>
        {/* 看历史版时给出只读 + rollback 二次确认（D-D5-5）。 */}
        {viewingHistory && (
          <>
            <span style={{ color: "var(--text-dim)" }}>历史版本（只读）</span>
            {confirmRollback ? (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#ca8a04" }}>回滚到 v{selectedVersion}？将生成新版</span>
                <button
                  onClick={() => {
                    setConfirmRollback(false);
                    if (selectedVersion != null) void rollback(selectedVersion);
                  }}
                  disabled={rollbackBusy}
                  style={solidBtn("#dc2626")}
                >
                  确认回滚
                </button>
                <button onClick={() => setConfirmRollback(false)} style={btnStyle(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmRollback(true)}
                disabled={rollbackBusy}
                title="把此历史版本复制为新版本（不删除历史）"
                style={btnStyle(false)}
              >
                {rollbackBusy ? "回滚中…" : `回滚到 v${selectedVersion}`}
              </button>
            )}
          </>
        )}
        {!viewingHistory && pendingCount > 0 && (
          <span style={{ color: "#eab308" }}>{pendingCount} 处待确认</span>
        )}
        <span style={{ marginLeft: "auto" }} />
        {/* 划选引用按钮（AC⑥） */}
        <button
          onClick={handleQuote}
          title="选中正文后点此引用到对话框"
          style={btnStyle(false)}
        >
          引用到对话框
        </button>
        {/* 视图切换（AC⑤）；降级时锁定 diff 并提示。看历史版时纯只读、无 Diff（D-D5-4），故隐藏。 */}
        {!viewingHistory && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("inline")}
              disabled={degraded}
              title={degraded ? `变更超过 ${INLINE_HL_LIMIT} 块，已自动降级为并排 Diff` : "行内高亮视图"}
              style={segBtnStyle(effectiveMode === "inline", degraded)}
            >
              行内
            </button>
            <button
              onClick={() => setViewMode("diff")}
              title="并排 Diff 视图，逐块可见"
              style={segBtnStyle(effectiveMode === "diff", false)}
            >
              查看 Diff
            </button>
          </div>
        )}
      </div>
      {rollbackError && (
        <div
          style={{
            padding: "4px 16px",
            fontSize: 11,
            color: "#f87171",
            background: "rgba(240,60,60,0.1)",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {rollbackError}
        </div>
      )}

      {/* 主体：左 TOC + 右内容（AC①） */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {toc.length > 0 && <TocSidebar items={toc} contentRef={contentRef} />}
        <div ref={contentRef} style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
          {viewingHistory ? (
            // D-D5-4：历史版纯只读渲染（无 pending 高亮、无 Diff、无降级）。
            <div style={{ padding: "16px 24px", maxWidth: 900 }}>
              <Markdown>{displayContent}</Markdown>
            </div>
          ) : (
            <>
              {degraded && (
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    color: "#ca8a04",
                    background: "rgba(234,179,8,0.1)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  变更块数（{pendingCount}）超过 {INLINE_HL_LIMIT}，已自动切换为并排 Diff。
                </div>
              )}
              {effectiveMode === "diff" ? (
                <DiffBlocksView blocks={pendingBlocks} />
              ) : (
                <InlineHighlightView content={artifact.content} pendingBlocks={pendingBlocks} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** TOC 侧栏（AC①）：点击标题滚到对应 id 的标题元素。 */
function TocSidebar({ items, contentRef }: { items: TocItem[]; contentRef: React.RefObject<HTMLDivElement | null> }) {
  const jump = (slug: string) => {
    const el = contentRef.current?.querySelector(`[data-slug="${CSS.escape(slug)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        overflow: "auto",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-panel)",
        padding: "8px 0",
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => jump(it.slug)}
          title={it.text}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: `3px 12px 3px ${8 + (it.level - 1) * 12}px`,
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          {it.text}
        </button>
      ))}
    </div>
  );
}

/**
 * 行内高亮视图（AC②③）：用 buildSegments 把 pending 块就近锚定到裸文本行，
 * plain 段原样 markdown 渲染、hl 段套 add/del/mod 配色（del 显删除线旧行）。
 * 无法锚定的块（unaligned）顶部提示切到并排 Diff。
 */
function InlineHighlightView({ content, pendingBlocks }: { content: string; pendingBlocks: DiffBlock[] }) {
  const setViewMode = useArtifactStore((s) => s.setViewMode);
  const { segs, unaligned } = useMemo(
    () => buildSegments(content, pendingBlocks),
    [content, pendingBlocks],
  );

  return (
    <div style={{ padding: "16px 24px", maxWidth: 900 }}>
      {unaligned.length > 0 && (
        <button
          onClick={() => setViewMode("diff")}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            marginBottom: 10,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #eab308",
            background: "rgba(234,179,8,0.12)",
            color: "#ca8a04",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {unaligned.length} 处变更无法在正文定位，点此切到「并排 Diff」逐块查看 →
        </button>
      )}
      {segs.map((seg, i) =>
        seg.type === "plain" ? (
          seg.text.trim() === "" ? null : <Markdown key={i}>{seg.text}</Markdown>
        ) : (
          <HlSegment key={i} seg={seg} />
        ),
      )}
    </div>
  );
}

/** 单个高亮段：套 KIND_STYLE 配色 + 角标；del/mod 的被删旧行以删除线红字展示。 */
function HlSegment({ seg }: { seg: Extract<Segment, { type: "hl" }> }) {
  const s = KIND_STYLE[seg.block.kind];
  return (
    <div
      style={{
        position: "relative",
        margin: "2px 0",
        padding: "4px 8px 4px 12px",
        borderLeft: `3px solid ${s.border}`,
        background: s.wrap,
        borderRadius: 4,
      }}
    >
      <span
        style={{
          display: "inline-block",
          marginBottom: 2,
          padding: "1px 6px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          color: "#fff",
          background: s.tag,
        }}
      >
        {seg.block.tag ?? s.tagText}
      </span>
      {seg.removed.length > 0 && (
        <div style={{ margin: "2px 0" }}>
          {seg.removed.map((ln, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#f87171",
                textDecoration: "line-through",
              }}
            >
              {ln}
            </p>
          ))}
        </div>
      )}
      {seg.text.trim() !== "" && <Markdown>{seg.text}</Markdown>}
    </div>
  );
}

/**
 * 并排 Diff 视图（AC⑤）：逐块渲染 pending 块（add/del/mod），逐块可见。
 * 移植 sf-mini DiffBlockView 的渲染部分、去掉 resolve；mod 块上旧行下新行对照。
 */
function DiffBlocksView({ blocks }: { blocks: DiffBlock[] }) {
  if (blocks.length === 0) {
    return <Centered color="var(--text-dim)">无待确认变更</Centered>;
  }
  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 900 }}>
      {blocks.map((b) => {
        const s = KIND_STYLE[b.kind];
        return (
          <div
            key={b.id}
            style={{
              borderLeft: `3px solid ${s.border}`,
              border: "1px solid var(--border)",
              borderLeftWidth: 3,
              borderLeftColor: s.border,
              borderRadius: 6,
              background: s.wrap,
              padding: "10px 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <span
              style={{
                display: "inline-block",
                marginBottom: 6,
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "#fff",
                background: s.tag,
              }}
            >
              {b.tag ?? s.tagText}
            </span>
            {/* mod 块：先列被删旧行（红删除线），再列新行（绿） */}
            {b.kind === "mod" &&
              (b.oldLines ?? []).map((ln, i) => (
                <DiffLine key={`o${i}`} text={ln} prefix="-" color="#f87171" strike />
              ))}
            {b.lines.map((ln, i) => (
              <DiffLine
                key={`n${i}`}
                text={ln}
                prefix={b.kind === "add" ? "+" : b.kind === "del" ? "-" : "+"}
                color={b.kind === "del" ? "#f87171" : b.kind === "add" ? "#4ade80" : "var(--text)"}
                strike={b.kind === "del"}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DiffLine({ text, prefix, color, strike }: { text: string; prefix: string; color: string; strike?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        color,
        textDecoration: strike ? "line-through" : undefined,
      }}
    >
      <span style={{ userSelect: "none", opacity: 0.7, marginRight: 6 }}>{prefix}</span>
      {text || " "}
    </p>
  );
}

function Centered({ children, color = "var(--text-muted)" }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color, fontSize: 13 }}>
      {children}
    </div>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    background: active ? "var(--bg-selected)" : "var(--bg-hover)",
    color: active ? "var(--text)" : "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 5,
  };
}

const selectStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  cursor: "pointer",
  background: "var(--bg-hover)",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 5,
};

/** rollback 确认按钮（实心边框，红色高危）。复用 PendingChangeCard 同款实心样式语义。 */
function solidBtn(color: string): React.CSSProperties {
  return {
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 5,
  };
}

function segBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: "2px 8px",
    fontSize: 11,
    border: "none",
    cursor: disabled ? "default" : "pointer",
    background: active ? "var(--bg-selected)" : "var(--bg-hover)",
    color: active ? "var(--text)" : "var(--text-muted)",
    fontWeight: active ? 600 : 400,
    opacity: disabled && !active ? 0.5 : 1,
  };
}
