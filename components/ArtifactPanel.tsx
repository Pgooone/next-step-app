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
  countPendingBlocks,
} from "@/lib/artifact-view/degrade";
import { useResolveBlock } from "@/hooks/useResolveBlock";
import type { DiffBlock } from "@/lib/domain/pending-change-service";

/** 全屏态放宽后的行内高亮块数上限（D-UI-05）；非全屏仍用 INLINE_HL_LIMIT(25)。 */
const FULLSCREEN_INLINE_HL_LIMIT = 80;

/** 单块 resolve 函数签名（useResolveBlock 返回值）；内联段就地 ✓/✗ 与对话框卡片（T4）共用。 */
type ResolveBlockFn = (changeId: string, blockId: string, action: "confirm" | "reject") => Promise<boolean>;

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

export function ArtifactPanel({
  onDeleted,
  isFullscreen = false,
}: { onDeleted?: () => void; isFullscreen?: boolean } = {}) {
  const artifact = useArtifactStore((s) => s.artifact);
  const loading = useArtifactStore((s) => s.loading);
  const error = useArtifactStore((s) => s.error);
  const viewMode = useArtifactStore((s) => s.viewMode);
  const setViewMode = useArtifactStore((s) => s.setViewMode);
  const setEditTarget = useArtifactStore((s) => s.setEditTarget);
  // A3 跳转信号（T2 已加，标量字段无 useShallow 风险）：focusBlockNonce 变化→滚到对应 data-block-id 段。
  // 只订阅 nonce 触发 effect；focusBlockId 在 effect 内用 getState() 读最新值（与 nonce 同 set 更新）。
  const focusBlockNonce = useArtifactStore((s) => s.focusBlockNonce);
  // D5 版本管理态。
  const versions = useArtifactStore(useShallow((s) => s.versions));
  const selectedVersion = useArtifactStore((s) => s.selectedVersion);
  const historyContent = useArtifactStore((s) => s.historyContent);
  const rollbackBusy = useArtifactStore((s) => s.rollbackBusy);
  const rollbackError = useArtifactStore((s) => s.rollbackError);
  const listVersions = useArtifactStore((s) => s.listVersions);
  const selectVersion = useArtifactStore((s) => s.selectVersion);
  const rollback = useArtifactStore((s) => s.rollback);
  // delete 是保留字，局部以 deleteArtifact 引用（store 内 action 键名仍是 delete，对外一致）。
  const deleteArtifact = useArtifactStore((s) => s.delete);
  // selectPendingBlocks 每次 flatMap+filter 返回新数组引用，直接订阅会让 zustand 的
  // useSyncExternalStore 快照恒不等（Object.is）→ 无限重渲染（getSnapshot should be cached /
  // Maximum update depth）。用 useShallow 逐元素浅比较：DiffBlock 元素来自稳定的
  // store.pendingChanges，pending 集不变时数组相等、返回同一引用，循环消除（D-D3-10，match
  // DispatchPanel/ProjectSwitcher/AgentManager 派生 selector 先例）。
  const pendingBlocks = useArtifactStore(useShallow(selectPendingBlocks));
  // 内联段就地 ✓/✗ 需 blockId→changeId（T3）。订阅完整 pendingChanges（useShallow：元素是稳定的
  // PendingChange 引用，pending 集不变时数组相等、返回同一引用，安全；D-D3-10）。
  // ⚠️ 不建返回 {block,changeId} 包装数组的 selector（每次新建包装对象→useShallow 逐元素 Object.is
  // 恒不等→无限重渲染），改用下方 useMemo 就地从稳定的 pendingChanges 构造 Map。
  const pendingChanges = useArtifactStore(useShallow((s) => s.pendingChanges));
  const changeIdByBlock = useMemo(
    () => new Map<string, string>(pendingChanges.flatMap((pc) => pc.diffBlocks.map((b) => [b.id, pc.id] as const))),
    [pendingChanges],
  );
  // 内联段就地 ✓/✗ 的共用 resolve（与对话框卡片 T4 共用同一 hook，避免 fetch 漂移）。
  // artifact 为 null 时传空串占位（内联视图仅在 artifact 存在时渲染，不会真调用）。
  const resolveBlock = useResolveBlock(artifact?.id ?? "");

  const contentRef = useRef<HTMLDivElement>(null);
  // rollback 二次确认（D-D5-5 两步按钮，非原生 confirm）。
  const [confirmRollback, setConfirmRollback] = useState(false);
  const rollbackConfirmRef = useRef<HTMLSpanElement>(null);
  // 删除二次确认（第四轮，复刻 rollback 两步范式）。
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteConfirmRef = useRef<HTMLSpanElement>(null);

  // 确认态打开时支持 Esc / 外点关闭（BUG-04，与 PendingChangeCard 全部✓/✗ 范式一致）。
  useEffect(() => {
    if (!confirmRollback) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rollbackConfirmRef.current && !rollbackConfirmRef.current.contains(e.target as Node)) {
        setConfirmRollback(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmRollback(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmRollback]);

  // 删除确认态同款 Esc / 外点关闭（BUG-04）。
  useEffect(() => {
    if (!confirmDelete) return;
    const onMouseDown = (e: MouseEvent) => {
      if (deleteConfirmRef.current && !deleteConfirmRef.current.contains(e.target as Node)) {
        setConfirmDelete(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDelete(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmDelete]);

  // 版本列表随 artifact 打开 / currentVersion 变化（rollback、D4 物化新版）统一重拉。
  const currentVersion = artifact?.currentVersion;
  useEffect(() => {
    if (currentVersion != null) void listVersions();
  }, [currentVersion, listVersions]);

  // A3 跳转消费端「滚动+脉冲」（T3）：focusBlockNonce 变化（点对话框 diff 块）→ 滚到原文对应
  // data-block-id 段并短暂高亮脉冲。照抄 TocSidebar.jump 的 querySelector+scrollIntoView 范式。
  // deps 只取 nonce（同一块连点也能重触发）；focusBlockId 用 getState() 读最新值（与 nonce 同 set 更新）。
  // 锚不到（unaligned / diff 视图 / 历史版）→ querySelector 落空、no-op，不报错。
  useEffect(() => {
    if (focusBlockNonce === 0) return;
    const id = useArtifactStore.getState().focusBlockId;
    if (!id) return;
    const el = contentRef.current?.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 自包含脉冲：直接写 inline boxShadow/outline 再定时清除（不依赖 globals.css class，scope 干净、
    // 不触发 saved-pop 的 scale 布局跳变）。
    const prevShadow = el.style.boxShadow;
    const prevTransition = el.style.transition;
    el.style.transition = "box-shadow 0.25s ease";
    el.style.boxShadow = "0 0 0 3px rgba(234,179,8,0.6)";
    const timer = window.setTimeout(() => {
      el.style.boxShadow = prevShadow;
      // 过渡跑完再还原 transition，避免残留 inline 样式。
      window.setTimeout(() => {
        el.style.transition = prevTransition;
      }, 300);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [focusBlockNonce]);

  // D-D5-4：看历史版（selectedVersion 非 null 且 ≠ 当前版）= 只读快照、无 pending 高亮、无 Diff。
  const viewingHistory =
    selectedVersion != null && artifact != null && selectedVersion !== artifact.currentVersion;
  // 渲染用内容：看历史版用 historyContent 快照，否则用当前版 content。
  const displayContent = viewingHistory ? (historyContent ?? "") : (artifact?.content ?? "");

  const toc = useMemo(() => parseToc(displayContent), [displayContent]);

  // AC④：pending 块数 > 阈值自动降级为并排 Diff（即使用户没点切换）。
  // 全屏态阈值放宽到 80（D-UI-05），非全屏维持 25；看历史版不叠 pending（走只读分支）。
  const pendingCount = countPendingBlocks(pendingBlocks);
  const effectiveLimit = isFullscreen ? FULLSCREEN_INLINE_HL_LIMIT : INLINE_HL_LIMIT;
  const degraded = pendingCount > effectiveLimit;
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
              <span ref={rollbackConfirmRef} style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#eab308" }}>
            {pendingCount} 处待确认
            {/* M3 视觉提示：右看改动 / 左逐块确认（与 PendingChangeCard 同用 #eab308 呼应） */}
            <span style={{ opacity: 0.85 }}>← 在左侧对话框逐块确认</span>
          </span>
        )}
        <span style={{ marginLeft: "auto" }} />
        {/* 删除按钮 + 两步二次确认（第四轮，复刻 rollback 范式）。 */}
        {confirmDelete ? (
          <span ref={deleteConfirmRef} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#dc2626" }}>
              永久删除该文档、全部版本历史与待确认变更、及磁盘文件，不可恢复？
            </span>
            <button
              onClick={() => {
                setConfirmDelete(false);
                void deleteArtifact().then((ok) => { if (ok) onDeleted?.(); });
              }}
              style={solidBtn("#dc2626")}
            >
              确认删除
            </button>
            <button onClick={() => setConfirmDelete(false)} style={btnStyle(false)}>
              取消
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            title="永久删除该文档（含全部版本与待确认变更、磁盘文件）"
            style={solidBtn("#dc2626")}
          >
            删除
          </button>
        )}
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
              title={degraded ? `变更超过 ${effectiveLimit} 块，已自动降级为并排 Diff` : "行内高亮视图"}
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
                  变更块数（{pendingCount}）超过 {effectiveLimit}，已自动切换为并排 Diff。
                </div>
              )}
              {effectiveMode === "diff" ? (
                <DiffBlocksView blocks={pendingBlocks} />
              ) : (
                <InlineHighlightView
                  content={artifact.content}
                  pendingBlocks={pendingBlocks}
                  changeIdByBlock={changeIdByBlock}
                  isFullscreen={isFullscreen}
                  resolveBlock={resolveBlock}
                />
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
function InlineHighlightView({
  content,
  pendingBlocks,
  changeIdByBlock,
  isFullscreen,
  resolveBlock,
}: {
  content: string;
  pendingBlocks: DiffBlock[];
  changeIdByBlock: Map<string, string>;
  isFullscreen: boolean;
  resolveBlock: ResolveBlockFn;
}) {
  const setViewMode = useArtifactStore((s) => s.setViewMode);
  const { segs, unaligned } = useMemo(
    () => buildSegments(content, pendingBlocks, changeIdByBlock),
    [content, pendingBlocks, changeIdByBlock],
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
          <HlSegment key={i} seg={seg} isFullscreen={isFullscreen} resolveBlock={resolveBlock} />
        ),
      )}
    </div>
  );
}

/**
 * 单个高亮段：套 KIND_STYLE 配色 + 角标；del/mod 的被删旧行以删除线红字展示。
 * 根 div 带 `data-block-id`（A3 跳转主落点，两态都有）。全屏态（isFullscreen）且块仍 pending 且
 * 有 changeId 时，角标区给出就地 ✓/✗（仅经 resolveBlock → resolve API，红线②不绕过）；已决态显状态标。
 * 非全屏态不显示 ✓/✗（保持侧栏态现状）。本组件只在「跟随最新版」分支渲染，故无需再判历史版只读。
 */
function HlSegment({
  seg,
  isFullscreen,
  resolveBlock,
}: {
  seg: Extract<Segment, { type: "hl" }>;
  isFullscreen: boolean;
  resolveBlock: ResolveBlockFn;
}) {
  const s = KIND_STYLE[seg.block.kind];
  const [busy, setBusy] = useState(false);
  const resolved = seg.block.state !== "pending";
  // 就地 ✓/✗ 仅全屏态、块 pending、有 changeId（能定位所属 PendingChange）时显示。
  const canResolveHere = isFullscreen && !resolved && seg.changeId != null;

  const doResolve = async (action: "confirm" | "reject") => {
    if (busy || seg.changeId == null) return;
    setBusy(true);
    try {
      await resolveBlock(seg.changeId, seg.block.id, action);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-block-id={seg.block.id}
      style={{
        position: "relative",
        margin: "2px 0",
        padding: "4px 8px 4px 12px",
        borderLeft: `3px solid ${s.border}`,
        background: s.wrap,
        borderRadius: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span
          style={{
            display: "inline-block",
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
        {/* 就地 ✓/✗（全屏态、pending、有 changeId）；onClick stopPropagation 防触发外层（A3 跳转等）。 */}
        {canResolveHere && (
          <span style={{ display: "flex", gap: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); void doResolve("confirm"); }}
              disabled={busy}
              title="确认此块"
              aria-label="确认此块"
              style={iconBtn("#16a34a")}
            >
              ✓
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void doResolve("reject"); }}
              disabled={busy}
              title="拒绝此块"
              aria-label="拒绝此块"
              style={iconBtn("#dc2626")}
            >
              ✗
            </button>
          </span>
        )}
        {/* 已决态（全屏态下）显状态标，半透明。 */}
        {isFullscreen && resolved && (
          <span style={{ color: "var(--text-dim)", fontSize: 10, opacity: 0.7 }}>
            {seg.block.state === "confirmed" ? "已确认" : "已拒绝"}
          </span>
        )}
      </div>
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
            data-block-id={b.id}
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

/** 就地 ✓/✗ 图标按钮（与 PendingChangeCard.iconBtn 同款，T3 内联段就地确认用）。 */
function iconBtn(color: string): React.CSSProperties {
  return {
    width: 20,
    height: 18,
    lineHeight: 1,
    fontSize: 11,
    cursor: "pointer",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 4,
    padding: 0,
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
