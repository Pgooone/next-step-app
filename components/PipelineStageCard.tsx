"use client";

import { useState } from "react";
import { agentAvatarDataUri } from "@/lib/pipeline/avatar";
import { statusToProgress } from "@/lib/pipeline/dot-matrix";
import StageDotMatrix from "@/components/StageDotMatrix";
import StageHoverPreview from "@/components/StageHoverPreview";
import type { PipelineRunStage } from "@/lib/domain/pipeline-run-store"; // 仅类型

/** status → .brow 修饰类（视觉 §6/§7；running 用 Kimi 蓝 run-accent，非 emerald）。 */
function statusClass(stage: PipelineRunStage): string {
  switch (stage.status) {
    case "running":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "pending":
    default:
      return "wait";
  }
}

/** 状态徽章内容（排队态优先显「排队中·等会话槽」，AC-5）。 */
function badgeFor(stage: PipelineRunStage): { text: string; cls: string } {
  if (stage.statusDetail === "queued") return { text: "排队中·等会话槽", cls: "badge-wait" };
  switch (stage.status) {
    case "running":
      return { text: "⏳", cls: "badge-run" };
    case "done":
      return { text: "✓", cls: "badge-done" };
    case "failed":
      return { text: "✕", cls: "badge-failed" };
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
  onOpenSession,
}: {
  stage: PipelineRunStage;
  stageName?: string;
  totalStages?: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const badge = badgeFor(stage);
  return (
    <div
      className={`brow ${statusClass(stage)}`}
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        // T4 预留挂载点：T6 接 StageSessionMenu（按 stage.sessionId 进 agent 会话）。
        // onOpenSession 透传备用，本卡不消费（避免与 hover 浮窗合并）。
        void onOpenSession;
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
          <span className="rrole">· {stage.agentName ?? stage.agentId}</span>
          <span className="rno">{String(stage.order).padStart(2, "0")}</span>
        </div>
        <div className="rtask">
          <span className="tline">└</span>
          <span className="tk">{stage.subTask}</span>
          <StageDotMatrix progress={statusToProgress(stage.status)} status={stage.status} />
        </div>
      </div>

      {/* 区3 状态徽章 */}
      <span className={`badge ${badge.cls}`}>{badge.text}</span>

      {/* 区4 右箭头 */}
      <span className="chev">›</span>

      {hover && (
        <StageHoverPreview stage={stage} stageName={stageName} totalStages={totalStages} />
      )}
    </div>
  );
}
