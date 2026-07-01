"use client";

import { useEffect, useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap-setup";
import { useMastermindStore } from "@/lib/stores/useMastermindStore";
import { useTheme } from "@/hooks/useTheme";
import PipelineBoardStyles from "@/components/PipelineBoardStyles";
import PipelineStageCard from "@/components/PipelineStageCard";
import MastermindPlanCard from "@/components/MastermindPlanCard";

/** prefers-reduced-motion 探测（照 AppShell.tsx:204-206 范式）。 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 主脑派活块的**内联容器**（内联锚点见 ChatWindow）：包 `.pipeline-board t-kimi-{light|dark}` 外壳 + 渲
 * PipelineBoardStyles（否则 .brow / var() token 全失效=秃卡，Trap 3），据 run.status 分派：
 *   - awaiting_plan_approval / paused / done / partial / failed → MastermindPlanCard（计划卡/抉择/只读）。
 *   - running → run.stages 逐个 PipelineStageCard（复用第七轮卡片族）。
 *
 * 数据经 useMastermindStore（只 import type + fetch JSON）：mount **无条件 ensureRun 一次**（首拉，与轮询
 * 分离，Trap 8）；轮询由单宿主 MastermindPollDriver 统一驱动、本组件不各自装定时器（防内存泄漏）。
 * toolResult 未到（流式窗口）→ runId=null，ChatWindow 渲 loading 占位、根本不 mount 本组件。
 *
 * GSAP 克制（照 AppShell 范式守 reduced-motion）：仅卡片一次性 stagger 入场；running 呼吸/LED 保留既有 CSS
 * 循环（未在 reduced-motion 下守卫=已知留 T7 的 gap、非 T5 回归）。
 */
export default function MastermindTeammateCards({
  runId,
  onOpenSession,
  onOpenArtifact,
}: {
  runId: string;
  onOpenSession?: (sessionId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const { isDark } = useTheme();
  const run = useMastermindStore((s) => s.runs[runId]);
  const ensureRun = useMastermindStore((s) => s.ensureRun);

  // 首拉（幂等）：mount 即 GET 一次；runId 变化再拉。失败静默（下次交互/轮询兜）。
  useEffect(() => {
    ensureRun(runId).catch(() => {});
  }, [runId, ensureRun]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isRunning = run?.status === "running";
  // GSAP stagger 依赖钉「本次渲了几张 stage 卡」——running 态卡片数变化时补间入场。
  const stageCount = isRunning ? run.stages.length : 0;

  useGSAP(
    () => {
      const cards = containerRef.current?.querySelectorAll<HTMLElement>(".brow");
      if (!cards || cards.length === 0) return;
      if (prefersReducedMotion()) {
        gsap.set(cards, { opacity: 1, y: 0 });
      } else {
        gsap.from(cards, {
          opacity: 0,
          y: 8,
          stagger: 0.06,
          duration: 0.3,
          ease: "power1.out",
        });
      }
    },
    { dependencies: [stageCount], scope: containerRef },
  );

  const themeClass = isDark ? "t-kimi-dark" : "t-kimi-light";

  return (
    <div
      ref={containerRef}
      data-testid="mastermind-teammate-cards"
      className={`pipeline-board ${themeClass}`}
      style={{ margin: "0.4rem 0 0.8rem" }}
    >
      <PipelineBoardStyles />

      {!run ? (
        // 首拉未回（或 GET 失败）：轻量占位，不崩。
        <div style={{ fontSize: "0.75rem", color: "var(--sub)", padding: "0.6rem 0.2rem" }}>
          加载派活计划…
        </div>
      ) : isRunning ? (
        <div className="clist">
          {run.stages.map((s) => (
            // MastermindStage 结构上是 StageCardStage 的子类型（多字段 + status 更宽），直传无需 as 强转。
            <PipelineStageCard
              key={s.order}
              stage={s}
              totalStages={run.stages.length}
              stages={run.stages}
              onOpenSession={onOpenSession}
              onOpenArtifact={onOpenArtifact}
            />
          ))}
        </div>
      ) : (
        <MastermindPlanCard run={run} />
      )}
    </div>
  );
}
