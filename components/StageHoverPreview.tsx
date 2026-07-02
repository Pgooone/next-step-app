"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { agentAvatarDataUri } from "@/lib/pipeline/avatar";
import { STATUS_META } from "@/lib/pipeline/status-meta";
import { computeFixedPopover } from "@/lib/pipeline/popover-position";
import { friendlyAgentName } from "@/lib/mastermind/friendly-name";
import { usePopoverPortalHost } from "@/lib/pipeline/use-popover-portal-host";
import type { StageCardStage } from "@/lib/pipeline/stage-card-stage"; // 仅类型（超集，含 skipped）

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
const POPOVER_WIDTH = 330;
const MAX_HEIGHT_CAP = 330;

export default function StageHoverPreview({
  stage,
  stageName,
  totalStages,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  onDismiss,
}: {
  stage: StageCardStage;
  stageName?: string;
  totalStages?: number;
  /** 锚父卡（.brow）的 ref，用于 getBoundingClientRect 算 fixed 坐标（N2 脱离 overflow:hidden 裁切）。 */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** N2 防闪烁：浮层自身成为 hover 目标——鼠标进浮层取消隐藏 / 离开浮层重新计时隐藏。 */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** T7 P1 a11y：Esc 关（键盘用户）——由父卡透出，落到 setHover(false)。 */
  onDismiss?: () => void;
}) {
  // T7 P1 a11y：Esc 关只读浮窗（与 StageSessionMenu 一致的键盘退出路径）。
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // P0③：排队态优先——queued 在领域模型是 statusDetail（底层 status 仍 pending/running），
  // 卡片 badgeFor 已优先显「排队中·等会话槽」，浮窗头徽章同步取 queued 键，消「卡片排队/浮窗待执行」矛盾。
  const meta =
    stage.statusDetail === "queued" ? STATUS_META.queued : STATUS_META[stage.status];
  const stageLabel = totalStages
    ? `阶段 ${stage.order} / ${totalStages}`
    : `阶段 ${stage.order}`;
  // M5a：头徽章名剥 uuid8（friendlyAgentName）；副行显职衔=优先 stage.role（计划角色，如「日本市场研究员」），
  //   并接阶段序号——role 缺省（如第七轮流水线看板 stage 无 role）时只显阶段序号，不重复主名。
  const displayName = friendlyAgentName(stageName ?? stage.agentName ?? stage.agentId);
  const subLabel = stage.role ? `${stage.role} · ${stageLabel}` : stageLabel;

  // N2：fixed 坐标必须在 useLayoutEffect 测量后存 state（渲染期/SSR 不能同步 getBoundingClientRect、首帧 rect 为 0）。
  const [placement, setPlacement] = useState<{
    left: number;
    top: number | null;
    bottom: number | null;
    maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = computeFixedPopover(rect, POPOVER_WIDTH, MAX_HEIGHT_CAP);
    setPlacement({ left: p.left, top: p.top, bottom: p.bottom, maxHeight: p.maxHeight });
  }, [anchorRef]);

  // M3：Portal 到 body 级 `.pipeline-board t-kimi-{theme}` wrapper——脱离 `.brow`（GSAP transform 造的包含块）、
  // fixed 恢复相对视口 + token 有值。host 未就绪（SSR/首帧）不渲。
  const host = usePopoverPortalHost();
  if (!host) return null;

  return createPortal(
    <div
      data-testid="stage-hover-preview"
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        // 未测量出坐标前先隐藏（避免首帧落 0,0 闪一下）；above 用 bottom 锚、below 用 top 锚。
        top: placement ? (placement.top ?? undefined) : 0,
        bottom: placement?.bottom ?? undefined,
        left: placement?.left ?? 0,
        visibility: placement ? "visible" : "hidden",
        // M3 评审遗漏命门：Portal 到 body 后成 PipelineModal(z:1000) 同胞，须 >1000 才不被盖；
        // 取 1050（<ModelsConfig z:1100 / OnboardingTour z:2000 / Toaster z:9999），与 menu(1060) 保相对序。
        zIndex: 1050,
        width: POPOVER_WIDTH,
        maxWidth: "calc(100vw - 16px)",
        background: "var(--pop)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        padding: "0.9rem",
        maxHeight: placement?.maxHeight ?? MAX_HEIGHT_CAP,
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
            {displayName}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--sub)", marginTop: "0.04rem" }}>
            {subLabel}
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
        <div style={bodyTextStyle}>{stage.acceptanceCriteria || "暂无"}</div>

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
    </div>,
    host,
  );
}
