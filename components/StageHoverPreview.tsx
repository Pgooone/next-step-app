"use client";

import { agentAvatarDataUri } from "@/lib/pipeline/avatar";
import { STATUS_META } from "@/lib/pipeline/status-meta";
import type { PipelineRunStage } from "@/lib/domain/pipeline-run-store"; // 仅类型

/** 把 startedAt/finishedAt 算成「耗时 1m23s」；未完成显「运行中」、未起显「—」。 */
function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return "—";
  if (!finishedAt) return "运行中…";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

const h3Style: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--sub)",
  margin: "0.5rem 0 0.12rem",
  fontSize: "0.66rem",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const bodyTextStyle: React.CSSProperties = {
  fontSize: "0.73rem",
  lineHeight: 1.55,
  color: "var(--task)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/**
 * 悬停浮窗（~330px 可滚动）：任务/范围/上游/产物/验收/最近动作/耗时（与 T6 的 StageSessionMenu 分开实现）。
 * MVP：run 模型只有 subTask/artifactId/startedAt/finishedAt，范围/上游/验收/最近动作无对应字段 → 渲染「暂无」；
 * 耗时用 startedAt/finishedAt 真实算。
 */
export default function StageHoverPreview({
  stage,
  stageName,
  totalStages,
}: {
  stage: PipelineRunStage;
  stageName?: string;
  totalStages?: number;
}) {
  const meta = STATUS_META[stage.status];
  const roleLabel = totalStages
    ? `阶段 ${stage.order} / ${totalStages}`
    : `阶段 ${stage.order}`;
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 50,
        width: 330,
        maxWidth: "100%",
        background: "var(--pop)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        padding: "0.9rem",
        maxHeight: 300,
        overflowY: "auto",
        color: "var(--task)",
        boxShadow: "0 12px 34px rgba(0,0,0,0.18)",
      }}
    >
      {/* 头部：头像 44 + 名/角色 + 状态徽章 */}
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.55rem" }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            boxShadow: "inset 0 0 0 1px var(--avab)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={agentAvatarDataUri(stage.agentId)}
            alt=""
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.95rem",
              color: "var(--text)",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {stageName ?? stage.agentName ?? stage.agentId}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--sub)", marginTop: "0.04rem" }}>
            {roleLabel}
          </div>
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: "0.1rem 0.45rem",
            borderRadius: 999,
            fontSize: "0.63rem",
            fontWeight: 500,
            color: meta.color,
            background: meta.bg,
          }}
        >
          {meta.label}
        </span>
      </div>

      {/* 正文分段 */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "0.55rem" }}>
        <div style={h3Style}>当前任务</div>
        <div style={bodyTextStyle}>{stage.subTask || "—"}</div>

        <div style={h3Style}>范围</div>
        <div style={bodyTextStyle}>暂无</div>

        <div style={h3Style}>上游依赖</div>
        <div style={bodyTextStyle}>暂无</div>

        <div style={h3Style}>产物</div>
        <div style={{ ...bodyTextStyle, color: stage.artifactId ? "var(--accent)" : "var(--task)" }}>
          {stage.artifactId ? "📄 已产出受管文档" : "暂无"}
        </div>

        <div style={h3Style}>验收清单</div>
        <div style={bodyTextStyle}>暂无</div>

        <div style={h3Style}>最近动作</div>
        <div style={bodyTextStyle}>暂无</div>
      </div>

      {/* 页脚耗时 */}
      <div
        style={{
          marginTop: "0.55rem",
          borderTop: "1px dashed var(--line)",
          paddingTop: "0.4rem",
          fontSize: "0.67rem",
          color: "var(--accent)",
        }}
      >
        耗时 · {formatDuration(stage.startedAt, stage.finishedAt)}
      </div>
    </div>
  );
}
