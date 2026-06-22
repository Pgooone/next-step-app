"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useArtifactStore,
  selectPendingBlocks,
} from "@/lib/stores/useArtifactStore";
import { parseToc, slugify } from "@/lib/artifact-view/toc";
import { buildLineDiffSegments } from "@/lib/artifact-view/anchor";
import { computeVersionDiffBlocks } from "@/lib/artifact-view/version-diff";
import { computeTocDiff, type TocDiffItem } from "@/lib/artifact-view/toc-diff";
import {
  INLINE_HL_LIMIT,
  countPendingBlocks,
} from "@/lib/artifact-view/degrade";
import { useResolveBlock } from "@/hooks/useResolveBlock";
import type { DiffBlock } from "@/lib/domain/pending-change-service";
import type { ArtifactVersion } from "@/lib/domain/artifact-service";

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
 * 行内 diff（第七轮·第二轮 C 混合，D-UI-10）：未改动 equal 段走 markdown 富渲染、
 * 改动块走与「查看 Diff」同款 DiffBlockCard，由 buildLineDiffSegments 按 LCS ops 真实顺序驱动。
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
  // 看历史版的逃生口（第二轮 T2 / D-R2-07）：true=对比上一版只读 diff（默认）、false=只读全文。
  // 瞬态局部态、切版本时重置回「对比」默认——纯 useState、彻底绕开 D-D3-10 selector 坑。
  const [historyCompare, setHistoryCompare] = useState(true);
  // Diff 历史时间线（第二轮 T3 / D-R2-05/06）：historyMode=主体区铺满时间线覆盖正文（甲）；
  // expandedHistoryVersion=当前手风琴展开的版本号（null=全收起）。皆**局部 useState 标量**——
  // 瞬态 UI 态、不进 store，彻底绕开 D-D3-10 派生 selector 无限重渲染坑。
  const [historyMode, setHistoryMode] = useState(false);
  const [expandedHistoryVersion, setExpandedHistoryVersion] = useState<number | null>(null);

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

  // 切换查看的版本（或回到最新）时，逃生口重置回「对比上一版」默认（D-R2-07）。
  useEffect(() => {
    setHistoryCompare(true);
  }, [selectedVersion]);

  // 切换打开的 artifact 时，Diff 历史时间线态归零（不跨 artifact 留旧的 historyMode/展开条目，T3）。
  const artifactId = artifact?.id;
  useEffect(() => {
    setHistoryMode(false);
    setExpandedHistoryVersion(null);
  }, [artifactId]);

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

  // 「取某版的前驱版内容」共用 helper（第二轮 T2/T3 / D-R2-04）：versions[] 按 version 升序，取目标
  // 版在序列里的**前一个元素** content 作 base（**非**「版号-1」，防版本号空洞）；目标版是序列首元素
  // （通常 v1、无前驱）或未找到 → null。T2（viewingHistory 版本下拉）与 T3（时间线手风琴）共用同一套
  // 「排序取前驱」逻辑，保两处取基准完全一致。useCallback 依赖 versions（已 useShallow 稳定引用）。
  const baseContentFor = useCallback(
    (version: number | null): string | null => {
      if (version == null) return null;
      const sorted = [...versions].sort((a, b) => a.version - b.version);
      const idx = sorted.findIndex((v) => v.version === version);
      if (idx <= 0) return null; // 未找到或为首元素 → 无前驱
      return sorted[idx - 1].content;
    },
    [versions],
  );

  // 版本间 diff 的「前驱版内容」（第二轮 T2 / D-R2-04）：仅在看历史版时取选中版的前驱（见 baseContentFor）。
  const historyBaseContent = useMemo(
    () => (viewingHistory ? baseContentFor(selectedVersion) : null),
    [viewingHistory, baseContentFor, selectedVersion],
  );

  // 版本间 diff 块（只读、纯客户端重算，D-R2-01/02）。仅在「看历史版 + 逃生口=对比 + 有前驱」时算，
  // base=前驱版 content、target=选中版 content（historyContent / displayContent）。
  const versionDiffBlocks = useMemo(
    () =>
      viewingHistory && historyCompare && historyBaseContent != null
        ? computeVersionDiffBlocks(historyBaseContent, displayContent)
        : [],
    [viewingHistory, historyCompare, historyBaseContent, displayContent],
  );

  // 左侧目录数据（第三轮 T2 / 需求A）：版本对比态用 computeTocDiff 算带 diff 标记的目录序列，
  // 否则退化为现有 parseToc 映射成无 diffKind 的等价项（side='target'、line=0），TocSidebar 据此
  // 渲染同现状（零回归）。
  //
  // ⚠️ 就地从**已订阅的** historyBaseContent/displayContent 用 useMemo 算——**绝不**新建返回新数组的
  // store selector（D-D3-10：派生 selector 每次返回新数组引用 → useSyncExternalStore 快照恒不等 →
  // 无限重渲染、只真浏览器暴露）。computeTocDiff/parseToc 都只值导入 lcs.ts/toc.ts（D-R7B-07，零 node 依赖）。
  //
  // 对比条件与 versionDiffBlocks 完全对齐（viewingHistory && historyCompare && historyBaseContent != null）：
  // 逃生口切「只读全文」(historyCompare=false) 时正文走纯只读 Markdown 无 diff，TOC 也须随之退回无标记，
  // 否则会出现「正文只读全文、目录却带 diff 色线」的不一致。
  const tocItems = useMemo<TocDiffItem[]>(() => {
    if (viewingHistory && historyCompare && historyBaseContent != null) {
      return computeTocDiff(historyBaseContent, displayContent);
    }
    // 非对比态：parseToc → 无 diffKind 的等价项（与旧 toc 行为一致）。
    return parseToc(displayContent).map((it) => ({
      ...it,
      line: 0,
      side: "target",
      diffKind: null,
    }));
  }, [viewingHistory, historyCompare, historyBaseContent, displayContent]);

  // AC④：pending 块数 > 阈值自动降级为并排 Diff（即使用户没点切换）。
  // 全屏态阈值放宽到 80（D-UI-05），非全屏维持 25；看历史版不叠 pending（走只读分支）。
  const pendingCount = countPendingBlocks(pendingBlocks);
  const effectiveLimit = isFullscreen ? FULLSCREEN_INLINE_HL_LIMIT : INLINE_HL_LIMIT;
  const degraded = pendingCount > effectiveLimit;
  const effectiveMode: "inline" | "diff" = degraded ? "diff" : viewMode;
  // 内联混合渲染只在「单条 replace」时走（D-R7B-02 保 LCS 自洽）；多条 / op=patch 退回并排 Diff。
  // 解构出 diff 单独窄化，使下方 .diff.oldContent/newContent 访问类型成立（discriminated union）。
  const only = pendingChanges.length === 1 ? pendingChanges[0] : null;
  const singleReplace = only && only.diff.kind === "replace" ? { ...only, diff: only.diff } : null;

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
            // 操作版本下拉即退出 Diff 历史时间线（E，D-R2-06）→ 回正文/版本 diff。
            setHistoryMode(false);
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
        {/* Diff 历史时间线入口（第二轮 T3 / D-R2-06）：独立 toggle 按钮、放版本下拉右侧、**常驻可见**
            （不塞进 `[行内│查看Diff]` 段——该段在历史/无 pending 时隐藏会一并藏掉入口）。点击切 historyMode、
            开时重置展开态从全收起开始；激活态高亮（active=true 走选中底色 + 加边框）。 */}
        <button
          onClick={() => {
            setHistoryMode((on) => !on);
            setExpandedHistoryVersion(null);
          }}
          title="查看版本变更时间线（点条目就地展开该版与上一版的只读 diff）"
          style={{
            ...btnStyle(historyMode),
            // 高亮态用完整 border shorthand 覆盖 btnStyle 的 border——勿用 borderColor（longhand），
            // 否则与 btnStyle 的 border（shorthand）混用，React 报「mixing shorthand/non-shorthand」console error。
            ...(historyMode ? { border: "1px solid var(--accent, #2563eb)", fontWeight: 600 } : {}),
          }}
        >
          Diff 历史
        </button>
        {/* 看历史版时给出只读 + rollback 二次确认（D-D5-5）。 */}
        {viewingHistory && (
          <>
            <span style={{ color: "var(--text-dim)" }}>历史版本（只读）</span>
            {/* 逃生口（D-R2-07）：对比上一版 ⇄ 只读全文（默认对比）。仅有前驱版时显示——
                首版无对比基准，主体区直接走只读全文 + 提示，开关无意义故隐藏。 */}
            {historyBaseContent != null && (
              <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
                <button
                  onClick={() => setHistoryCompare(true)}
                  title="与紧邻上一版做只读行内对比"
                  style={segBtnStyle(historyCompare, false)}
                >
                  对比上一版
                </button>
                <button
                  onClick={() => setHistoryCompare(false)}
                  title="只读查看该版完整正文"
                  style={segBtnStyle(!historyCompare, false)}
                >
                  只读全文
                </button>
              </div>
            )}
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
        {/* 视图切换（AC⑤）；降级时锁定 diff 并提示。看历史版时纯只读、无 Diff（D-D5-4），故隐藏。
            Diff 历史时间线模式下也隐藏（D，D-R2-06：时间线覆盖正文、行内/Diff 切换无意义）。 */}
        {!viewingHistory && !historyMode && (
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

      {/* 主体：左 TOC + 右内容（AC①）。Diff 历史时间线模式下 TOC 无意义（时间线非文档正文），隐藏。 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {tocItems.length > 0 && !historyMode && <TocSidebar items={tocItems} contentRef={contentRef} />}
        <div ref={contentRef} style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
          {historyMode ? (
            // Diff 历史时间线（第二轮 T3 / D-R2-05/06，甲）：主体区铺满版本时间线、覆盖正文；
            // 点条目手风琴就地展开该版 vs 前驱版的只读 diff（懒算，复用 T2 渲染器）。
            <HistoryTimeline
              versions={versions}
              expandedVersion={expandedHistoryVersion}
              onToggle={(v) => setExpandedHistoryVersion((cur) => (cur === v ? null : v))}
              baseContentFor={baseContentFor}
              effectiveLimit={effectiveLimit}
            />
          ) : viewingHistory ? (
            // 看历史版（第二轮 T2 / D-R2-07，推翻 D-D5-4「纯只读全文」）：默认展示该版 vs 紧邻上一版的
            // **只读**行内 diff（复用形态C混合、无 ✓/✗ 无状态标）；逃生口切「只读全文」或首版无前驱时退回纯只读。
            historyBaseContent == null ? (
              // 首版（无前驱）：只读全文 + 提示。
              <div style={{ padding: "16px 24px", maxWidth: 900 }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
                  首版，无对比基准。
                </div>
                <Markdown>{displayContent}</Markdown>
              </div>
            ) : !historyCompare ? (
              // 逃生口切「只读全文」：纯只读渲染（等价旧 D-D5-4 路径）。
              <div style={{ padding: "16px 24px", maxWidth: 900 }}>
                <Markdown>{displayContent}</Markdown>
              </div>
            ) : versionDiffBlocks.length > effectiveLimit ? (
              // 降级护栏（D-R2-03）：版本 diff 块非 pending、countPendingBlocks 恒 0，故按总块数另判；
              // 超阈值降级为并排 Diff（只读，DiffBlockCard 不传 resolve 三件套）。
              <>
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 12,
                    color: "#ca8a04",
                    background: "rgba(234,179,8,0.1)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  变更块数（{versionDiffBlocks.length}）超过 {effectiveLimit}，已自动切换为并排 Diff。
                </div>
                <DiffBlocksView blocks={versionDiffBlocks} />
              </>
            ) : (
              // 版本间只读行内 diff：base=前驱版、target=选中版；不传 changeIdByBlock/resolveBlock/
              // isFullscreen → DiffBlockCard 恒只读、无 ✓/✗、无状态标（D-R2-02）。
              <InlineDiffView
                oldContent={historyBaseContent}
                newContent={displayContent}
                diffBlocks={versionDiffBlocks}
              />
            )
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
              ) : singleReplace ? (
                // 单条 replace：整篇混合内联（equal=markdown / change=与「查看 Diff」同款卡片）。
                <InlineDiffView
                  oldContent={singleReplace.diff.oldContent}
                  newContent={singleReplace.diff.newContent}
                  diffBlocks={singleReplace.diffBlocks}
                  changeIdByBlock={changeIdByBlock}
                  isFullscreen={isFullscreen}
                  resolveBlock={resolveBlock}
                />
              ) : pendingBlocks.length === 0 ? (
                // 无 pending：只读全文。
                <div style={{ padding: "16px 24px", maxWidth: 900 }}>
                  <Markdown>{artifact.content}</Markdown>
                </div>
              ) : (
                // 多条 / op=patch：退回并排 Diff（D-R7B-02），功能不丢。
                <DiffBlocksView blocks={pendingBlocks} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** TOC diff 类型符号（靠形状区分、满足色盲无障碍 color-not-only，T2b 乙）：+ 新增 / ~ 修改 / − 删除。 */
const TOC_DIFF_SYMBOL: Record<NonNullable<TocDiffItem["diffKind"]>, string> = {
  add: "+",
  mod: "~",
  del: "−", // U+2212 minus sign（比 ASCII '-' 更端正、与 del 删除线语义呼应）
};
/** 符号列宽（含与标题的 1 字距）：标记条 marginLeft 与之对齐，使色条左缘正对标题文字起点。 */
const TOC_SYMBOL_COL_WIDTH = 14;

/**
 * TOC 侧栏（AC① + 第三轮 T2 需求A + T2b 乙·标记条+类型符号）：点击标题滚到对应 id 的标题元素。
 *
 * 接受带可选 `diffKind`/`side` 的目录项（{@link TocDiffItem}）：
 * - 版本对比态（diffKind 非 null）→ 行首一个极小单色**类型符号**（`+`/`~`/`−`，靠形状区分、色盲也能辨）
 *   + 标题下方一条**内缩、加粗 3px、圆角**的色条（add 绿 / mod 黄 / del 红，不顶满侧栏宽、左对齐文字、
 *   右侧留 padding），**无圆点/图标**（D-R3-05 / D-UI-乙）。
 * - `del` 条目（side==='base'）：渲染层无对应 data-slug 落点 → 文本暗色（opacity 0.55）、**不可点击**
 *   （onClick no-op、cursor default、无 hover 变色），符号 `−`、标记条红色。
 * - `diffKind===null`（未变 / 非对比态）→ 文本同现状；行首留**等宽符号占位**（无符号但缩进对齐保持
 *   一致，标题不因有无符号而错位），无标记条（零回归）。
 */
function TocSidebar({ items, contentRef }: { items: TocDiffItem[]; contentRef: React.RefObject<HTMLDivElement | null> }) {
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
      {items.map((it, i) => {
        const isDel = it.diffKind === "del";
        // del 条目无落点 → 不可点；其余（add/mod/null，side==='target'）走现有 slug 跳转。
        const clickable = !isDel;
        const baseColor = isDel ? "var(--text-dim)" : "var(--text-muted)";
        const kindColor = it.diffKind ? KIND_STYLE[it.diffKind].border : undefined;
        return (
          <button
            key={i}
            onClick={clickable ? () => jump(it.slug) : undefined}
            title={it.text}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              // 标记条占位时下方多留间距（marginBottom），避免色条与下一行挤在一起。
              padding: `3px 12px 3px ${8 + (it.level - 1) * 12}px`,
              marginBottom: it.diffKind ? 4 : 0,
              background: "none",
              border: "none",
              color: baseColor,
              // del 文本暗色（占位、不可点）。
              opacity: isDel ? 0.55 : 1,
              fontSize: 12,
              cursor: clickable ? "pointer" : "default",
            }}
            // del 不绑 hover 变色（保持暗色不可点观感）；其余维持现有 hover（只改文本色、不动符号/色条）。
            onMouseEnter={clickable ? (e) => { e.currentTarget.style.color = "var(--text)"; } : undefined}
            onMouseLeave={clickable ? (e) => { e.currentTarget.style.color = baseColor; } : undefined}
          >
            {/* 行：类型符号（占等宽列、未变也留占位避免标题错位）+ 标题文本（单行省略号）。 */}
            <span style={{ display: "flex", alignItems: "baseline" }}>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: TOC_SYMBOL_COL_WIDTH,
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  lineHeight: 1,
                  color: kindColor ?? "transparent",
                }}
              >
                {it.diffKind ? TOC_DIFF_SYMBOL[it.diffKind] : ""}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                {it.text}
              </span>
            </span>
            {/* 标记条：标题下方一条内缩（左对齐文字起点、右侧留 padding 不顶满）、加粗 3px、圆角的色条。 */}
            {it.diffKind && (
              <span
                aria-hidden
                style={{
                  display: "block",
                  height: 3,
                  borderRadius: 2,
                  background: kindColor,
                  marginTop: 3,
                  marginLeft: TOC_SYMBOL_COL_WIDTH, // 左缘对齐标题文字起点
                  marginRight: 28, // 右侧留出 padding，不顶满侧栏宽
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 内联混合视图（D-UI-10 用户拍板 C；第七轮·第二轮纠偏）：对一对 `(oldContent,newContent)` +
 * 其聚块 `diffBlocks`，按 LCS ops 真实顺序渲染整篇——未改动 equal 段走 markdown 富渲染、改动块走
 * 与「查看 Diff」同款 `DiffBlockCard`（带颜色边框的 git 卡片）。靠 buildLineDiffSegments 驱动，无 unaligned。
 *
 * 参数化（第二轮 T2 / D-R2-02）：接受裸 `(oldContent,newContent,diffBlocks)`，可选 `changeIdByBlock/
 * isFullscreen/resolveBlock` 三件套——**pending 行内 diff** 传齐三件套（保就地 ✓/✗ 行为不变）；
 * **版本间只读 diff** 一律不传 → DiffBlockCard 的 `canResolveHere`（恒 false）/ 状态标（不显）双双关闭，
 * 纯只读、零改 DiffBlockCard 内部。
 * 注：pending 调用方须以 `change.diff.oldContent/newContent`（非 artifact.content，D-R7B-02 保 LCS 自洽）喂入。
 */
function InlineDiffView({
  oldContent,
  newContent,
  diffBlocks,
  changeIdByBlock,
  isFullscreen,
  resolveBlock,
}: {
  oldContent: string;
  newContent: string;
  diffBlocks: DiffBlock[];
  changeIdByBlock?: Map<string, string>;
  isFullscreen?: boolean;
  resolveBlock?: ResolveBlockFn;
}) {
  const segs = useMemo(
    () => buildLineDiffSegments(oldContent, newContent, diffBlocks, changeIdByBlock),
    [oldContent, newContent, diffBlocks, changeIdByBlock],
  );

  return (
    <div style={{ padding: "16px 24px", maxWidth: 900 }}>
      {segs.map((seg, i) =>
        seg.type === "equal" ? (
          seg.text.trim() === "" ? null : <Markdown key={i}>{seg.text}</Markdown>
        ) : (
          <DiffBlockCard
            key={i}
            block={seg.block}
            changeId={seg.changeId}
            isFullscreen={isFullscreen}
            resolveBlock={resolveBlock}
          />
        ),
      )}
    </div>
  );
}

/**
 * 单个改动块卡片：与「查看 Diff」(DiffBlocksView) 逐字同款的带边框 git 卡片
 * （四边 1px border + 左 3px kind 色 + 半透 kind 底 + mono + tag + DiffLine 行：
 * mod 先 oldLines '-' 红删除线再 lines '+' / add lines '+' 绿 / del lines '-' 红删除线）。
 * 外层 div 带 `data-block-id`（A3 跳转落点，横跨多行的 mod 块命中一个完整元素）。
 *
 * 当 `isFullscreen && block.state==='pending' && changeId != null && resolveBlock` 时，
 * 在 tag 行右侧给就地 ✓/✗（仅经 resolveBlock → resolve API，红线②不绕过）；
 * 全屏态已决则显「已确认/已拒绝」状态标。非全屏或无 resolveBlock 不渲 ✓/✗（DiffBlocksView 走这条）。
 */
function DiffBlockCard({
  block,
  changeId,
  isFullscreen,
  resolveBlock,
}: {
  block: DiffBlock;
  changeId?: string;
  isFullscreen?: boolean;
  resolveBlock?: ResolveBlockFn;
}) {
  const s = KIND_STYLE[block.kind];
  const [busy, setBusy] = useState(false);
  const resolved = block.state !== "pending";
  // 就地 ✓/✗ 仅全屏态、块 pending、有 changeId、且传了 resolveBlock 时显示。
  const canResolveHere = !!isFullscreen && !resolved && changeId != null && !!resolveBlock;

  const doResolve = async (action: "confirm" | "reject") => {
    if (busy || changeId == null || !resolveBlock) return;
    setBusy(true);
    try {
      await resolveBlock(changeId, block.id, action);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-block-id={block.id}
      style={{
        borderLeft: `3px solid ${s.border}`,
        border: "1px solid var(--border)",
        borderLeftWidth: 3,
        borderLeftColor: s.border,
        borderRadius: 6,
        background: s.wrap,
        padding: "10px 12px",
        marginBottom: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span
          style={{
            display: "inline-block",
            padding: "1px 6px",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            color: "#fff",
            background: s.tag,
          }}
        >
          {block.tag ?? s.tagText}
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
            {block.state === "confirmed" ? "已确认" : "已拒绝"}
          </span>
        )}
      </div>
      {/* mod 块：先列被删旧行（红删除线），再列新行（绿） */}
      {block.kind === "mod" &&
        (block.oldLines ?? []).map((ln, i) => (
          <DiffLine key={`o${i}`} text={ln} prefix="-" color="#f87171" strike />
        ))}
      {block.lines.map((ln, i) => (
        <DiffLine
          key={`n${i}`}
          text={ln}
          prefix={block.kind === "add" ? "+" : block.kind === "del" ? "-" : "+"}
          color={block.kind === "del" ? "#f87171" : block.kind === "add" ? "#4ade80" : "var(--text)"}
          strike={block.kind === "del"}
        />
      ))}
    </div>
  );
}

/**
 * 并排 Diff 视图（AC⑤）：逐块渲染 pending 块（add/del/mod），逐块可见、只读。
 * 改用与内联改动块共用的 DiffBlockCard（不传 resolve → 纯只读，无就地 ✓/✗）。
 */
function DiffBlocksView({ blocks }: { blocks: DiffBlock[] }) {
  if (blocks.length === 0) {
    return <Centered color="var(--text-dim)">无待确认变更</Centered>;
  }
  return (
    <div style={{ padding: "16px 24px", maxWidth: 900 }}>
      {blocks.map((b) => (
        <DiffBlockCard key={b.id} block={b} />
      ))}
    </div>
  );
}

/** ISO 时间 → 简洁相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前 / 更早走本地日期）。 */
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}

/**
 * Diff 历史时间线（第二轮 T3 / D-R2-05/06，甲）：铺满主体区、覆盖正文。
 * `versions[]` **按 version 倒序**（最新在上）逐条渲染；点条目手风琴就地展开（懒算）该版 vs 前驱版
 * 的**只读** diff。零新增存储——直接读 store 已拉回的 versions（含 content/note/author/createdAt）。
 *
 * 懒算（D-R2-05）：diff 计算下沉到 HistoryDiffBody，**只在条目展开时才挂载**该子组件 → 同一时刻只算
 * 当前展开的单条 diff（`computeVersionDiffBlocks` 内 `lcsDiff` 是 O(n*m) 全表 DP），绝不预算全部版本对。
 */
function HistoryTimeline({
  versions,
  expandedVersion,
  onToggle,
  baseContentFor,
  effectiveLimit,
}: {
  versions: ArtifactVersion[];
  expandedVersion: number | null;
  onToggle: (version: number) => void;
  baseContentFor: (version: number | null) => string | null;
  effectiveLimit: number;
}) {
  if (versions.length === 0) {
    return <Centered color="var(--text-dim)">暂无版本历史</Centered>;
  }
  const sortedDesc = [...versions].sort((a, b) => b.version - a.version);
  return (
    <div style={{ padding: "16px 24px", maxWidth: 900 }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
        版本变更时间线（共 {versions.length} 版）—— 点条目展开该版与上一版的只读对比。
      </div>
      {sortedDesc.map((v) => (
        <HistoryTimelineEntry
          key={v.version}
          version={v}
          expanded={expandedVersion === v.version}
          onToggle={() => onToggle(v.version)}
          base={baseContentFor(v.version)}
          effectiveLimit={effectiveLimit}
        />
      ))}
    </div>
  );
}

/**
 * 时间线单条目：恒渲染条目头（v{n} · note · 相对时间 · author + 展开角标），点击切展开。
 * 展开时**才挂载** HistoryDiffBody（懒算落点，见 HistoryTimeline 头注）。
 */
function HistoryTimelineEntry({
  version,
  expanded,
  onToggle,
  base,
  effectiveLimit,
}: {
  version: ArtifactVersion;
  expanded: boolean;
  onToggle: () => void;
  base: string | null;
  effectiveLimit: number;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        marginBottom: 8,
        background: expanded ? "var(--bg-panel)" : "var(--bg)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        title={expanded ? "收起" : "展开该版与上一版的只读对比"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          textAlign: "left",
          padding: "8px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text)",
          fontSize: 13,
        }}
      >
        <span style={{ width: 12, flexShrink: 0, color: "var(--text-dim)" }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>v{version.version}</span>
        <span
          style={{
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {version.note || "(初版)"}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>{version.author}</span>
        <span
          style={{ color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}
          title={new Date(version.createdAt).toLocaleString()}
        >
          {formatRelativeTime(version.createdAt)}
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <HistoryDiffBody base={base} target={version.content} effectiveLimit={effectiveLimit} />
        </div>
      )}
    </div>
  );
}

/**
 * 时间线条目展开后的只读 diff 主体（懒算落点）：只在父条目展开时挂载 → 此处 useMemo 的
 * `computeVersionDiffBlocks` 同一时刻只算当前一条（D-R2-05 懒算）。
 * 与 T2 版本下拉 diff 同一管线、同一渲染器（只读 InlineDiffView，**不传** resolve 三件套）：
 * - base==null（首元素 v1，无前驱）→ 「首版，无对比基准」+ 只读全文。
 * - 块数 > effectiveLimit → 降级并排 DiffBlocksView（D-R2-03，版本块非 pending 故按总块数判）。
 * - 否则 → 形态C混合只读行内 diff。
 */
function HistoryDiffBody({
  base,
  target,
  effectiveLimit,
}: {
  base: string | null;
  target: string;
  effectiveLimit: number;
}) {
  const blocks = useMemo(
    () => (base == null ? [] : computeVersionDiffBlocks(base, target)),
    [base, target],
  );
  if (base == null) {
    return (
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>首版，无对比基准。</div>
        <div style={{ maxWidth: 900 }}>
          <Markdown>{target}</Markdown>
        </div>
      </div>
    );
  }
  if (blocks.length > effectiveLimit) {
    return (
      <>
        <div
          style={{
            padding: "8px 16px",
            fontSize: 12,
            color: "#ca8a04",
            background: "rgba(234,179,8,0.1)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          变更块数（{blocks.length}）超过 {effectiveLimit}，已自动切换为并排 Diff。
        </div>
        <DiffBlocksView blocks={blocks} />
      </>
    );
  }
  // 只读行内 diff：不传 changeIdByBlock/resolveBlock/isFullscreen → 恒只读、无 ✓/✗、无状态标。
  return <InlineDiffView oldContent={base} newContent={target} diffBlocks={blocks} />;
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
