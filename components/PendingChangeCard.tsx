"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useArtifactStore } from "@/lib/stores/useArtifactStore";
import { toast } from "@/lib/stores/useToastStore";
import type { DiffBlock, PendingChange } from "@/lib/domain/pending-change-service";

/**
 * PendingChangeCard（D4，§5.5）：在 ChatWindow 底部把当前 artifact 的块级变更渲染成可操作卡片，
 * 逐块 ✓/✗（resolveBlock）+ YNRD 快捷键（Y 确认 / N 拒绝 / R 重生 / D 跳并排 Diff）。
 *
 * 数据源 = useArtifactStore.pendingChanges（selectedArtifactId 驱动，仿 QuoteBar 挂法），
 * 故仅在「打开了某 artifact 的会话」语境出现。每次 resolve 调 `POST .../resolve` 后 store.refresh()：
 * 行内高亮按新 state 自然消失（D3 已 state 过滤，AC③），全块 resolve 时服务端物化新版本（AC⑤）。
 *
 * 红线：本组件**不写盘**——写盘只在 service `resolveAndMaterialize`「全块非 pending」时触发（D-D4-5）。
 * D（跳并排 Diff）调 `requestDiffFocus`：切 viewMode + 发信号让 AppShell 展开右面板（D-D4-3 选 B，
 * 卡片不直接碰 AppShell 的 rightPanelOpen 本地 state）。
 * R（重生）依赖「agent 重新生成 artifact」= 真实会话接线（D-D2-6 gap），D4 未接：保留键位满足 AC②
 * 字面，按下仅提示「需会话接线」（D-D4-2 降级）。
 *
 * 配色沿用基座内联 var(--...) 主题（同 ArtifactPanel / QuoteBar），不引 Tailwind。
 */

// add 绿 / del 红 / mod 黄（与 ArtifactPanel.KIND_STYLE 同源，卡片内自持一份避免跨组件耦合）。
const KIND_STYLE: Record<DiffBlock["kind"], { border: string; tag: string; label: string }> = {
  add: { border: "#4ade80", tag: "#16a34a", label: "新增" },
  del: { border: "#f87171", tag: "#dc2626", label: "删除" },
  mod: { border: "#eab308", tag: "#ca8a04", label: "修改" },
};

const STATE_LABEL: Record<DiffBlock["state"], string> = {
  pending: "",
  confirmed: "已确认",
  rejected: "已拒绝",
};

export function PendingChangeCard() {
  const selectedArtifactId = useArtifactStore((s) => s.selectedArtifactId);
  const pendingChanges = useArtifactStore(useShallow((s) => s.pendingChanges));
  const refresh = useArtifactStore((s) => s.refresh);
  // D 键/「查看 Diff」用 requestDiffFocus：切并排 Diff + 发信号让 AppShell 展开右面板（D-D4-3 选 B）。
  const requestDiffFocus = useArtifactStore((s) => s.requestDiffFocus);

  if (!selectedArtifactId || pendingChanges.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "0 12px 8px",
        maxHeight: "40vh",
        overflowY: "auto",
      }}
    >
      {/* M3 视觉提示：左确认 / 右看全貌（与 ArtifactPanel「N 处待确认」同用 #eab308 呼应） */}
      <div style={{ color: "#eab308", fontSize: 11, opacity: 0.85 }}>
        改动全貌见右侧产物面板（按 D 看并排 Diff）
      </div>
      {pendingChanges.map((pc) => (
        <ChangeCard
          key={pc.id}
          artifactId={selectedArtifactId}
          change={pc}
          onResolved={refresh}
          onJumpDiff={requestDiffFocus}
        />
      ))}
    </div>
  );
}

/** 单条 PendingChange 卡片：列出其 diffBlocks，逐块 ✓/✗ + YNRD（作用于聚焦块）。 */
function ChangeCard({
  artifactId,
  change,
  onResolved,
  onJumpDiff,
}: {
  artifactId: string;
  change: PendingChange;
  onResolved: () => void | Promise<void>;
  onJumpDiff: () => void;
}) {
  // 聚焦块 = YNRD 作用对象；默认首个 pending 块（无 pending 块则 0）。
  const firstPendingIdx = change.diffBlocks.findIndex((b) => b.state === "pending");
  const [focusIdx, setFocusIdx] = useState(firstPendingIdx < 0 ? 0 : firstPendingIdx);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // 「全部 ✓/✗」二次确认态（BUG-04）：null=未确认；confirm/reject=已点开对应动作的确认条。
  // 复用 AgentManager.confirmDelete / ProjectSwitcher.confirmId 的内联两步范式，仅高危「全部」加，逐块不加。
  const [confirmAll, setConfirmAll] = useState<"confirm" | "reject" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const pendingCount = change.diffBlocks.filter((b) => b.state === "pending").length;

  // 后端在确认态打开时已 resolve（pendingChanges 变化 → 无 pending 块）→ 自动清确认态（边界）。
  useEffect(() => {
    if (pendingCount === 0) setConfirmAll(null);
  }, [pendingCount]);

  // 外点 / Esc 关闭确认态（仅在确认态打开时挂监听）。
  // Esc 用文档级监听（而非卡片 onKeyDown）——鼠标点「全部✓/✗」后按钮被确认条替换、焦点丢到
  // body，卡片 onKeyDown 收不到 Esc；文档级才能在鼠标流里可靠关闭（与 ArtifactPanel 回滚确认一致）。
  useEffect(() => {
    if (confirmAll === null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setConfirmAll(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmAll(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmAll]);

  // resolve 一块（或省略 blockId 全部）：调 API → 刷新 → 聚焦推进到下一个 pending 块。
  const resolve = useCallback(
    async (action: "confirm" | "reject", blockId?: string) => {
      if (busy) return;
      setBusy(true);
      setHint(null);
      try {
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(artifactId)}/pending/${encodeURIComponent(change.id)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, ...(blockId ? { blockId } : {}) }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          const msg = `操作失败：${data.error ?? `HTTP ${res.status}`}`;
          // 失败兜底：hint 可能滚出视口，补一条 toast（保留卡片内 hint）。
          setHint(msg);
          toast.error(msg);
          return;
        }
        await onResolved();
        // 成功回执（全部：无 blockId → 单条汇总，带处理块数）。
        if (blockId) {
          toast.success(action === "confirm" ? "已确认该块" : "已拒绝该块");
        } else {
          const n = change.diffBlocks.filter((b) => b.state === "pending").length;
          toast.success(action === "confirm" ? `已确认全部 ${n} 处` : `已拒绝全部 ${n} 处`);
        }
      } catch (e) {
        const msg = `操作失败：${String(e)}`;
        setHint(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [artifactId, change.id, change.diffBlocks, busy, onResolved],
  );

  // YNRD（作用于聚焦块）。R 降级：仅提示需会话接线（D-D4-3）。
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 「全部」确认态打开时接管键盘：Esc 取消 / Enter 确认，其余 YNRD 一律拦下（防误触逐块）。
      if (confirmAll !== null) {
        if (e.key === "Escape") {
          setConfirmAll(null);
          e.preventDefault();
        } else if (e.key === "Enter") {
          if (!busy) {
            const action = confirmAll;
            setConfirmAll(null);
            void resolve(action);
          }
          e.preventDefault();
        }
        return;
      }
      const focused = change.diffBlocks[focusIdx];
      const key = e.key.toLowerCase();
      if (key === "y") {
        if (focused?.state === "pending") void resolve("confirm", focused.id);
        e.preventDefault();
      } else if (key === "n") {
        if (focused?.state === "pending") void resolve("reject", focused.id);
        e.preventDefault();
      } else if (key === "r") {
        setHint("「重新生成」需与 agent 会话接线（D-D2-6），当前版本暂不可用。");
        e.preventDefault();
      } else if (key === "d") {
        onJumpDiff();
        e.preventDefault();
      } else if (key === "arrowdown") {
        setFocusIdx((i) => Math.min(i + 1, change.diffBlocks.length - 1));
        e.preventDefault();
      } else if (key === "arrowup") {
        setFocusIdx((i) => Math.max(i - 1, 0));
        e.preventDefault();
      }
    },
    [change.diffBlocks, focusIdx, resolve, onJumpDiff, confirmAll, busy],
  );

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="pending-change-card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-panel)",
        padding: "8px 10px",
        outline: "none",
        fontSize: 12,
      }}
    >
      {/* 卡片头：来源 agent + 剩余待确认数 + 操作区 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ color: "var(--text-dim)" }}>变更来自</span>
        <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{change.sourceActor}</span>
        <span style={{ color: "var(--text-dim)" }}>
          {pendingCount > 0 ? `· ${pendingCount} 处待确认` : "· 全部已处理"}
        </span>
        <span style={{ marginLeft: "auto" }} />
        {confirmAll !== null ? (
          // 二次确认态（BUG-04）：替换操作区为确认条，明确块数；hint 仍在卡片下方不抢空间。
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#ca8a04" }}>
              {confirmAll === "confirm" ? "确认全部" : "拒绝全部"} {pendingCount} 处待处理块？
            </span>
            <button
              onClick={() => {
                const action = confirmAll;
                setConfirmAll(null);
                void resolve(action);
              }}
              disabled={busy}
              title="确认执行"
              style={solidBtn(confirmAll === "confirm" ? "#16a34a" : "#dc2626")}
            >
              确认
            </button>
            <button onClick={() => setConfirmAll(null)} disabled={busy} title="取消" style={ghostBtn}>
              取消
            </button>
          </span>
        ) : (
          <>
            <button onClick={onJumpDiff} title="跳到并排 Diff（D）" style={ghostBtn}>
              查看 Diff
            </button>
            {pendingCount > 0 && (
              <>
                <button
                  onClick={() => setConfirmAll("confirm")}
                  disabled={busy}
                  title="确认全部待处理块"
                  style={solidBtn("#16a34a")}
                >
                  全部 ✓
                </button>
                <button
                  onClick={() => setConfirmAll("reject")}
                  disabled={busy}
                  title="拒绝全部待处理块"
                  style={solidBtn("#dc2626")}
                >
                  全部 ✗
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* 快捷键提示 */}
      <div style={{ color: "var(--text-dim)", fontSize: 10, marginBottom: 6 }}>
        快捷键：Y 确认 / N 拒绝 / R 重生 / D 跳 Diff（↑↓ 切换聚焦块）
      </div>

      {/* 逐块列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {change.diffBlocks.map((b, i) => (
          <BlockRow
            key={b.id}
            block={b}
            focused={i === focusIdx}
            busy={busy}
            onFocus={() => setFocusIdx(i)}
            onConfirm={() => void resolve("confirm", b.id)}
            onReject={() => void resolve("reject", b.id)}
          />
        ))}
      </div>

      {hint && (
        <div style={{ marginTop: 6, color: "#ca8a04", fontSize: 11 }}>{hint}</div>
      )}
    </div>
  );
}

/** 单块行：kind 角标 + 首行预览 + ✓/✗（pending 时）/ 状态标（已决时半透明）。 */
function BlockRow({
  block,
  focused,
  busy,
  onFocus,
  onConfirm,
  onReject,
}: {
  block: DiffBlock;
  focused: boolean;
  busy: boolean;
  onFocus: () => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const s = KIND_STYLE[block.kind];
  const resolved = block.state !== "pending";
  // 预览取首个非空行（mod 显新行）。
  const preview = block.lines.find((l) => l.trim() !== "") ?? block.lines[0] ?? "";
  return (
    <div
      onClick={onFocus}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 6px",
        borderLeft: `3px solid ${s.border}`,
        borderRadius: 4,
        background: focused ? "var(--bg-hover)" : "transparent",
        opacity: resolved ? 0.5 : 1,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          padding: "0 5px",
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 600,
          color: "#fff",
          background: s.tag,
        }}
      >
        {block.tag ?? s.label}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
        }}
        title={block.lines.join("\n")}
      >
        {preview || "（空行）"}
      </span>
      {resolved ? (
        <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 11 }}>
          {STATE_LABEL[block.state]}
        </span>
      ) : (
        <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
            disabled={busy}
            title="确认此块"
            aria-label="确认此块"
            style={iconBtn("#16a34a")}
          >
            ✓
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            disabled={busy}
            title="拒绝此块"
            aria-label="拒绝此块"
            style={iconBtn("#dc2626")}
          >
            ✗
          </button>
        </span>
      )}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "1px 7px",
  fontSize: 11,
  cursor: "pointer",
  background: "var(--bg-hover)",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 4,
};

function solidBtn(color: string): React.CSSProperties {
  return {
    padding: "1px 7px",
    fontSize: 11,
    cursor: "pointer",
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 4,
  };
}

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
