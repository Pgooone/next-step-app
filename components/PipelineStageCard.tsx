"use client";

import { useEffect, useRef, useState } from "react";
import { agentAvatarDataUri } from "@/lib/pipeline/avatar";
import { statusToProgress } from "@/lib/pipeline/dot-matrix";
import StageDotMatrix from "@/components/StageDotMatrix";
import StageHoverPreview from "@/components/StageHoverPreview";
import StageSessionMenu from "@/components/StageSessionMenu";
import { friendlyAgentName } from "@/lib/mastermind/friendly-name";
// 第 8.6 轮 T5：卡片族收超集 StageCardStage（status 含 "skipped"），协变兼容第七轮的窄 PipelineRunStage。
import type { StageCardStage } from "@/lib/pipeline/stage-card-stage"; // 仅类型

/** status → .brow 修饰类（视觉 §6/§7；running 用 Kimi 蓝 run-accent，非 emerald）。 */
function statusClass(stage: StageCardStage): string {
  switch (stage.status) {
    case "running":
      return "running";
    case "done":
    case "skipped": // skipped 归 done 变体（灰化名，非红/非蓝）
      return "done";
    case "failed":
      return "failed";
    case "pending":
    default:
      return "wait";
  }
}

/**
 * 状态徽章内容（排队态优先显「排队中·等会话槽」，AC-5）。
 * T7 P1：emoji（⏳/✓/✕）→ chip 文字标签（更统一、可读、a11y 友好）；running 带脉动 LED 圆点（led）。
 */
function badgeFor(stage: StageCardStage): { text: string; cls: string; led?: boolean } {
  if (stage.statusDetail === "queued")
    return { text: "排队中·等会话槽", cls: "badge-run", led: true };
  switch (stage.status) {
    case "running":
      return { text: "执行中", cls: "badge-run", led: true };
    case "done":
      return { text: "已完成", cls: "badge-done" };
    case "failed":
      return { text: "失败", cls: "badge-failed" };
    case "skipped":
      return { text: "已跳过", cls: "badge-wait" };
    case "pending":
    default:
      return { text: "待执行", cls: "badge-wait" };
  }
}

/**
 * 单阶段卡（Kimi `.brow`，视觉 §4）：头像 / 两层主体(名+序号 / └任务+点阵) / 状态徽章 / 右箭头。
 * 交互分开：onMouseEnter→StageHoverPreview（只读速览）；onClick→T6 StageSessionMenu（本卡仅预留挂载点）。
 */
export default function PipelineStageCard({
  stage,
  stageName,
  totalStages,
  stages,
  onOpenSession,
  onOpenArtifact,
}: {
  stage: StageCardStage;
  stageName?: string;
  totalStages?: number;
  stages?: StageCardStage[];
  onOpenSession?: (sessionId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  // click 二级菜单（T6）：与 hover 浮窗分属两套独立 state，互不合并。
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = badgeFor(stage);
  // 喂给点阵/进度的窄 status（skipped 归一化为 done，语义=已完成态的满格进度、不改共享签名）。
  const dotStatus: import("@/lib/domain/dispatch-store").DispatchStatus =
    stage.status === "skipped" ? "done" : stage.status;

  // N2：锚父卡 ref，传给两浮层做 fixed 定位的 getBoundingClientRect 基准（脱离 overflow:hidden 裁切）。
  const browRef = useRef<HTMLDivElement | null>(null);
  // N2 防闪烁：hover 隐藏 140ms 防抖——鼠标穿过 6px 间隙进浮层时不立即 setHover(false)，
  // 配合浮层自身 onMouseEnter 取消隐藏（使浮层可达可滚）。
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setHover(false), 140);
  };
  // menuOpen 时无需 hover 浮层（已抑制）→ 清计时器；unmount 兜底清。
  useEffect(() => {
    if (menuOpen) cancelHide();
  }, [menuOpen]);
  useEffect(() => () => cancelHide(), []);

  return (
    <div
      ref={browRef}
      className={`brow ${statusClass(stage)}${menuOpen ? " selected" : ""}`}
      style={{ position: "relative" }}
      // T7 P1 a11y：卡片可聚焦 + 键盘触发（Enter/Space 等价点击弹菜单），role=button 让读屏正确识别。
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      aria-label={`阶段 ${stage.order}${stageName ? ` ${stageName}` : ""}·${badge.text}`}
      onMouseEnter={() => {
        cancelHide();
        setHover(true);
      }}
      onMouseLeave={scheduleHide}
      onClick={() => setMenuOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      {/* 区1 头像（dicebear data: URI，无法走 next/image，沿用既有 <img> 约定） */}
      <span className="ava">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={agentAvatarDataUri(stage.agentId)} alt="" />
      </span>

      {/* 区2 主体两层 */}
      <div className="rmain">
        <div className="rtop">
          <span className="rname">{stageName ?? `阶段 ${stage.order}`}</span>
          <span className="rrole">· {friendlyAgentName(stage.agentName ?? stage.agentId)}</span>
          <span className="rno">{String(stage.order).padStart(2, "0")}</span>
        </div>
        <div className="rtask">
          <span className="tline">└</span>
          <span className="tk">{stage.subTask}</span>
          {/* dot-matrix/StageDotMatrix 签名收窄 DispatchStatus（共享·爆炸半径大不改）→ skipped 卡内归一化为 done。 */}
          <StageDotMatrix progress={statusToProgress(dotStatus)} status={dotStatus} />
        </div>
      </div>

      {/* 区3 状态徽章（chip；running/queued 带脉动 LED 圆点） */}
      <span className={`badge ${badge.cls}`}>
        {badge.led && <span className="chip-dot led-live" />}
        {badge.text}
      </span>

      {/* 区4 右箭头 */}
      <span className="chev">›</span>

      {/* hover 浮窗：menuOpen 时抑制（避免两浮层叠加）。N2：传 anchorRef 做 fixed 定位 + 浮层自身 hover 防抖。 */}
      {hover && !menuOpen && (
        <StageHoverPreview
          stage={stage}
          stageName={stageName}
          totalStages={totalStages}
          anchorRef={browRef}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onDismiss={() => {
            cancelHide();
            setHover(false);
          }}
        />
      )}

      {/* click 二级菜单（T6）。N2：传 anchorRef 做 fixed 定位（脱离 overflow:hidden）。 */}
      {menuOpen && (
        <StageSessionMenu
          stage={stage}
          stages={stages ?? []}
          onOpenSession={onOpenSession}
          onOpenArtifact={onOpenArtifact}
          onClose={() => setMenuOpen(false)}
          anchorRef={browRef}
        />
      )}
    </div>
  );
}
