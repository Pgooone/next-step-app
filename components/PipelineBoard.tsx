"use client";

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePipelineStore, selectNeedsPolling } from "@/lib/stores/usePipelineStore";
import { STATUS_META } from "@/lib/pipeline/status-meta";
import PipelineStageCard from "@/components/PipelineStageCard";
// T5 抽取：卡片族样式 + t-kimi token 共享（原内联 PipelineBoardStyles 挪到独立组件，供 MastermindTeammateCards 共用）。
import PipelineBoardStyles from "@/components/PipelineBoardStyles";

/** 轮询间隔（ms），仿 DispatchPanel.tsx:33。 */
const POLL_INTERVAL = 2000;

/**
 * 阶段看板主体（Kimi(A) 块，视觉 §2-§7）：run 下拉 + 容器头 + 全局进度条 + 纵向 stage 卡列表 + 空态 + 失败态头 + 停止按钮(占位)。
 * 轮询生命周期照搬 DispatchPanel 范式：currentRun 活跃才装 setInterval、终态自然停。
 */
export default function PipelineBoard({
  isDark,
  onOpenArtifact,
  onOpenSession,
  onEditBlueprint,
  onSessionsChanged,
}: {
  isDark: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onEditBlueprint?: () => void;
  /** N3：board 开着时 currentRun 跑到终态 → 通知一次刷新左栏会话分组（仿 DispatchPanel）。 */
  onSessionsChanged?: () => void;
}) {
  const { currentRun, runs, pollCurrentRun, selectRun, cancelRun } = usePipelineStore(
    useShallow((s) => ({
      currentRun: s.currentRun,
      runs: s.runs,
      pollCurrentRun: s.pollCurrentRun,
      selectRun: s.selectRun,
      cancelRun: s.cancelRun,
    })),
  );

  // 轮询：currentRun 活跃才装定时器；终态/无活跃阶段 → 不装（停）。定时器读最新闭包，不进依赖数组。
  const pollRef = useRef(pollCurrentRun);
  pollRef.current = pollCurrentRun;
  useEffect(() => {
    if (!selectNeedsPolling(currentRun)) return;
    const timer = setInterval(() => {
      pollRef.current().catch(() => {});
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [currentRun?.id, currentRun?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // N3：currentRun 进终态（done/failed）即通知一次刷新「会话分组」（仿 DispatchPanel.tsx:117-123）。
  // 独立 ref 按 run.id 去重——pollCurrentRun 每 2s 产新 currentRun 对象，依赖只钉 id/status，不依赖整对象。
  // 已接受限制：本 effect 随 board 卸载（模态关/切 tab）停 → 仅保证「board 开着时」run 跑完刷新。
  const notifiedRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentRun) return;
    if (currentRun.status !== "done" && currentRun.status !== "failed") return; // 仅终态
    if (notifiedRunRef.current === currentRun.id) return; // 已通知过
    notifiedRunRef.current = currentRun.id;
    onSessionsChanged?.();
  }, [currentRun?.id, currentRun?.status, onSessionsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const themeClass = isDark ? "t-kimi-dark" : "t-kimi-light";

  // 空态（D-V1.2-34）：无当前 run 且无历史 run → 显「+ 新建流水线」卡。
  const isEmpty = !currentRun && runs.length === 0;

  return (
    <div className={`pipeline-board board ${themeClass}`}>
      <PipelineBoardStyles />

      {/* run 下拉（仿 ArtifactPanel.tsx:328-350 原生 <select> + selectStyle）：选历史 run 看只读。 */}
      {runs.length > 0 && (
        <div style={{ padding: "0 0.5rem 0.5rem", display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={currentRun?.id ?? ""}
            onChange={(e) => {
              const r = runs.find((x) => x.id === e.target.value) ?? null;
              selectRun(r);
            }}
            title="切换查看的运行"
            style={selectStyle}
          >
            {!currentRun && <option value="">选择一次运行…</option>}
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.pipelineName} · {r.createdAt.slice(0, 19).replace("T", " ")} ·{" "}
                {STATUS_META[r.status].label}
              </option>
            ))}
          </select>
        </div>
      )}

      {isEmpty ? (
        <>
          {/* N4：空态说明（流水线 vs 快速派发），与 DispatchPanel 引导文案同风格。 */}
          <div
            data-testid="pipeline-empty-note"
            data-tour-id="pipeline-empty-note"
            style={{
              fontSize: "0.8rem",
              color: "var(--sub)",
              lineHeight: 1.5,
              marginBottom: "0.6rem",
              textAlign: "center",
            }}
          >
            流水线 = 多个 Agent 按固定顺序接力、可保存复用；只想临时派一次 → 用上方「快速派发」。
          </div>
          <button
            data-testid="pipeline-empty-new"
            data-tour-id="pipeline-empty-new"
            onClick={onEditBlueprint}
            style={{
              display: "block",
              width: "100%",
              padding: "2rem 1rem",
              background: "var(--container)",
              border: "1px dashed var(--line)",
              borderRadius: 12,
              color: "var(--sub)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            + 新建流水线
          </button>
        </>
      ) : currentRun ? (
        <>
          {/* 容器头：行1 分支图标 + 名 + ④/N；行2 全局进度条 + 状态字 */}
          <div className="hd">
            <div className="hd1">
              <span className="fork" aria-hidden="true">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              </span>
              <span>{currentRun.pipelineName}</span>
              <span className="cnt">
                {Math.min(currentRun.currentStageIndex + 1, currentRun.stages.length)} /{" "}
                {currentRun.stages.length}
              </span>
            </div>
            <div className="hd2">
              <span className="gbar">
                {currentRun.stages.map((_, i) => {
                  const done = currentRun.status === "done";
                  let bg: string;
                  if (done || i < currentRun.currentStageIndex) bg = "var(--accent)";
                  else if (i === currentRun.currentStageIndex) bg = "var(--run-accent)";
                  else bg = "var(--ledoff)";
                  return <i key={i} style={{ background: bg }} />;
                })}
              </span>
              <span className="rst">
                {currentRun.status === "failed"
                  ? `已失败 · 停在第 ${currentRun.currentStageIndex + 1} 阶段`
                  : currentRun.status === "done"
                    ? "已完成"
                    : "运行中"}
              </span>
              {/* 停止按钮：已接 cancel route（POST /api/pipeline-runs/[id]/cancel），翻 cancelRequested + abort。 */}
              {currentRun.status === "running" && (
                <button
                  data-testid="pipeline-stop-btn"
                  onClick={() => {
                    cancelRun(currentRun.id).catch(() => {});
                  }}
                  style={{
                    marginLeft: "auto",
                    fontSize: "0.68rem",
                    padding: "0.15rem 0.55rem",
                    background: "none",
                    border: "1px solid var(--line)",
                    borderRadius: 7,
                    color: "var(--sub)",
                    cursor: "pointer",
                  }}
                >
                  停止
                </button>
              )}
            </div>
            {currentRun.status === "failed" && currentRun.failedReason && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.7rem", color: "var(--error, #ff3b30)" }}>
                {currentRun.failedReason}
              </div>
            )}
          </div>

          {/* stage 卡列表 */}
          <div className="clist">
            {currentRun.stages.map((s) => (
              <PipelineStageCard
                key={s.order}
                stage={s}
                totalStages={currentRun.stages.length}
                stages={currentRun.stages}
                onOpenSession={onOpenSession}
                onOpenArtifact={onOpenArtifact}
              />
            ))}
          </div>
        </>
      ) : (
        // 有历史 run 但未选：提示选一次运行（下拉已渲染在上方）。
        <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--sub)", fontSize: "0.8rem" }}>
          从上方选择一次运行查看进度
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  cursor: "pointer",
  background: "var(--bg-hover)",
  color: "var(--text-muted)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  maxWidth: "100%",
};
