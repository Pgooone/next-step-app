"use client";

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePipelineStore, selectNeedsPolling } from "@/lib/stores/usePipelineStore";
import { STATUS_META } from "@/lib/pipeline/status-meta";
import PipelineStageCard from "@/components/PipelineStageCard";

/** 轮询间隔（ms），仿 DispatchPanel.tsx:33。 */
const POLL_INTERVAL = 2000;

/**
 * 阶段看板主体（Kimi(A) 块，视觉 §2-§7）：run 下拉 + 容器头 + 全局进度条 + 纵向 stage 卡列表 + 空态 + 失败态头 + 停止按钮(占位)。
 * 轮询生命周期照搬 DispatchPanel 范式：currentRun 活跃才装 setInterval、终态自然停。
 */
export default function PipelineBoard({
  isDark,
  onOpenSession,
  onEditBlueprint,
}: {
  isDark: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onEditBlueprint?: () => void;
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
        <button
          data-testid="pipeline-empty-new"
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
      ) : currentRun ? (
        <>
          {/* 容器头：行1 ⑂ + 名 + ④/N；行2 全局进度条 + 状态字 */}
          <div className="hd">
            <div className="hd1">
              <span className="fork">⑂</span>
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
              {/* 停止按钮（UI 占位）：T6 端点未实现会 404，本卡仅占位、不接逻辑。 */}
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
                onOpenSession={onOpenSession}
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

/** Kimi(A) 块样式（CSS 变量 token + 组件类 + 关键帧），亮/暗双主题；严格对照 看板视觉定稿-kimi-v11.html。 */
function PipelineBoardStyles() {
  return (
    <style>{`
.pipeline-board.t-kimi-light{--bg:#eceef1;--container:#fff;--card:#fff;--card-bd:transparent;--text:#191a1c;--sub:#7c7c84;--task:#9a9aa1;--line:#cdcdd3;--accent:#0a84ff;--run-bg:#eef5ff;--run-accent:#0a84ff;--run-glow:rgba(10,132,255,.15);--led:#10b981;--ledoff:#d6d8dc;--done-bg:rgba(16,185,129,.13);--done-fg:#0a9d6e;--badge-bg:#eef0f3;--badge-fg:#8a8a90;--pop:#fff;--avab:rgba(0,0,0,.06);--error:#ff3b30;--bg-hover:#f3f3f5;--border:#cdcdd3;--text-muted:#7c7c84}
.pipeline-board.t-kimi-dark{--bg:#0c0c0e;--container:#161619;--card:transparent;--card-bd:transparent;--text:#e9e9ec;--sub:#8a8a90;--task:#6e6e74;--line:#46464c;--accent:#3b9eff;--run-bg:#11161f;--run-accent:#3b9eff;--run-glow:rgba(59,158,255,.3);--led:#30d158;--ledoff:#3a3a40;--done-bg:rgba(48,209,88,.16);--done-fg:#30d158;--badge-bg:#26262b;--badge-fg:#8a8a90;--pop:#1f1f24;--avab:rgba(255,255,255,.1);--error:#ff453a;--bg-hover:#26262b;--border:#46464c;--text-muted:#8a8a90}

.pipeline-board.board{border-radius:14px;padding:.7rem;background:var(--bg);color:var(--text)}
.pipeline-board .hd{padding:.35rem .5rem .65rem}
.pipeline-board .hd1{display:flex;align-items:center;gap:.45rem;font-size:.8rem;font-weight:650;color:var(--text)}
.pipeline-board .hd1 .fork{color:var(--accent);font-size:.9rem}
.pipeline-board .hd1 .cnt{margin-left:auto;font-size:.72rem;font-weight:500;color:var(--sub);font-variant-numeric:tabular-nums}
.pipeline-board .hd2{display:flex;align-items:center;gap:.55rem;margin-top:.45rem}
.pipeline-board .hd2 .rst{font-size:.68rem;color:var(--run-accent);font-weight:500}
.pipeline-board .gbar{display:inline-flex;gap:2px;vertical-align:middle}
.pipeline-board .gbar i{width:8px;height:10px;border-radius:2px;display:block}
.pipeline-board .clist{background:var(--container);border-radius:11px;padding:.35rem}
.pipeline-board .brow{display:flex;align-items:center;gap:.65rem;padding:.5rem .65rem;border-radius:10px;background:var(--card);border:1px solid var(--card-bd);margin-bottom:.35rem;cursor:pointer}
.pipeline-board .brow:last-child{margin-bottom:0}
.pipeline-board .brow.running{background:var(--run-bg);border-left:3px solid var(--run-accent);animation:pb-breathe 2.8s ease-in-out infinite}
.pipeline-board .brow.failed{border-left:3px solid var(--error)}
.pipeline-board .brow.wait{opacity:.5}
.pipeline-board .brow:hover{outline:2px solid var(--accent);outline-offset:1px}
.pipeline-board .ava{width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;box-shadow:inset 0 0 0 1px var(--avab)}
.pipeline-board .ava img{width:100%;height:100%;display:block}
.pipeline-board .rmain{flex:1;min-width:0}
.pipeline-board .rtop{display:flex;align-items:baseline;gap:.4rem}
.pipeline-board .rname{font-size:.86rem;font-weight:650;white-space:nowrap;color:var(--text);letter-spacing:-.01em}
.pipeline-board .brow.done .rname{color:var(--sub);font-weight:600}
.pipeline-board .rrole{font-size:.72rem;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pipeline-board .rno{margin-left:auto;font-size:.7rem;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--task)}
.pipeline-board .brow.running .rno{color:var(--run-accent);font-weight:700}
.pipeline-board .rtask{display:flex;align-items:center;gap:.5rem;margin-top:.25rem}
.pipeline-board .rtask .tline{color:var(--line);flex:none;font-size:.8rem}
.pipeline-board .brow.running .rtask .tline{color:var(--run-accent)}
.pipeline-board .rtask .tk{font-size:.72rem;color:var(--task);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;line-height:1.3}
.pipeline-board .chev{font-size:.95rem;flex-shrink:0;color:var(--line)}
.pipeline-board .badge{font-size:.63rem;padding:.1rem .45rem;border-radius:999px;white-space:nowrap;flex-shrink:0;font-weight:500}
.pipeline-board .badge.badge-wait{background:var(--badge-bg);color:var(--badge-fg)}
.pipeline-board .badge.badge-run{background:var(--run-bg);color:var(--run-accent);border:1px solid var(--run-accent)}
.pipeline-board .badge.badge-done{background:var(--done-bg);color:var(--done-fg)}
.pipeline-board .badge.badge-failed{background:rgba(255,59,48,.16);color:var(--error)}
@keyframes pb-breathe{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 3px var(--run-glow)}}
@keyframes pb-pulse-led{0%,100%{opacity:1}50%{opacity:.55}}
.pipeline-board .led-live{animation:pb-pulse-led 1.5s ease-in-out infinite}
`}</style>
  );
}
