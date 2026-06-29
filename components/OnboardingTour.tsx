"use client";

/**
 * 第8.5轮 T1 · 首用引导 Tour —— overlay 引擎（mini-spike 骨架）。
 *
 * 本文件目前是 **Phase A mini-spike** 的最小可验证骨架，只为证伪/证实承重前提：
 * 「能程序化把 PipelineModal 开到空草稿编辑器（initialView=editor）、并 spotlight 其内部
 *  一个带 data-tour-id 的恒在元素，且在零数据空环境下不崩」。Phase B 会把它演进成
 *  总览轨(5 步) + 深度轨(6 步) 的完整引擎（步骤数组 + place() 三向 + seen 持久化 + 🧭 按钮）。
 *
 * 技术（ADR D-R8.5-01）：自定义 overlay，不引第三方 tour 库——
 *  - spotlight：单个全屏暗遮罩用 `box-shadow: 0 0 0 9999px rgba(17,17,20,.5)` 镂空 + 2px 白边，
 *    镂空矩形 = 目标 getBoundingClientRect() + 6px pad（位置算出、非写死）。
 *  - tooltip：绝对定位卡片（标题/正文/下一步/跳过），place 先放右、放不下钳进视口。
 *  - 过渡：复用项目已装 gsap（@/lib/gsap-setup）做淡入。
 *
 * 客户端 bundle 边界（D-R7B-07）：'use client'，**严禁值导入任何 server-only 模块**
 * （node:fs / pipeline-orchestrator 等）。本文件零此类导入。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap-setup";

/** 引导对两模态的编排请求：开哪个模态、到哪个子视图（由 AppShell 透传成 initial* props）。 */
type OpenModal =
  | { kind: "none" }
  | { kind: "pipeline"; tab?: "pipeline" | "dispatch"; view?: "board" | "editor"; blueprintId?: string }
  | { kind: "agents"; view?: "list" | "create" };

/** 单步配置：before() 编排模态（可选）→ 等内部目标挂载 → spotlight 锚 data-tour-id。 */
type TourStep = {
  /** spotlight + place 的锚目标（data-tour-id 值）；null/找不到 = 居中无镂空（降级，不崩）。 */
  tourId: string | null;
  title: string;
  body: string;
  /** 进入该步时要把模态开到的子视图；none = 不动模态（锚工作台顶层元素）。 */
  before: OpenModal;
};

/**
 * mini-spike 步骤集（最小链路）：
 *  step 0：锚工作台恒在顶层元素（Pipeline 入口按钮），不开模态——验「总览轨式」锚顶层。
 *  step 1：深度轨式——经 initialView=editor 把 PipelineModal 开到空草稿编辑器，
 *          spotlight 其内部 data-tour-id="pipeline-editor-name"（恒在、空环境可达）。
 * 触发方式：mini-spike 用一个临时「立即启动」入口（见 OnboardingTour 的 props.autoStart），
 *  Phase B 会换成「首启无 tour-seen 自动开 + 🧭 按钮」。
 */
const MINI_SPIKE_STEPS: TourStep[] = [
  {
    tourId: "tour-pipeline-entry",
    title: "流水线入口",
    body: "多个 Agent 按固定顺序接力 = 流水线。这里打开流水线面板。",
    before: { kind: "none" },
  },
  {
    tourId: "pipeline-editor-name",
    title: "排一条流水线",
    body: "在蓝图编辑器里给流水线起名、按顺序添加阶段（选 Agent + 子任务）。空项目也能直接编排。",
    before: { kind: "pipeline", tab: "pipeline", view: "editor" },
  },
];

/** spotlight 镂空矩形（视口坐标）；null = 无目标（居中、整屏暗遮罩、不镂空）。 */
type SpotRect = { top: number; left: number; width: number; height: number } | null;

const PAD = 6; // spotlight 目标外扩
const TOOLTIP_W = 300;
const GAP = 14; // tooltip 与 spotlight 间距

type Props = {
  /** 由 AppShell 透传：编排两模态开到指定子视图（set 后再开模态，mount 取 initial*）。 */
  onOrchestrate: (req: OpenModal) => void;
  /** 引导结束（完成 / 跳过）：AppShell 收到后关闭引导 + 复位编排。 */
  onFinish: () => void;
  /** mini-spike：true 时挂载即启动（Phase B 换成 seen 标记驱动）。 */
  autoStart?: boolean;
};

export function OnboardingTour({ onOrchestrate, onFinish, autoStart }: Props) {
  const steps = MINI_SPIKE_STEPS;
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [spot, setSpot] = useState<SpotRect>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const step = steps[stepIdx];

  // 启动（mini-spike：autoStart）。
  useEffect(() => {
    if (autoStart) setActive(true);
  }, [autoStart]);

  // 进入每一步：先编排模态（before），再在下一帧起轮询等目标元素挂载、算 spotlight。
  useEffect(() => {
    if (!active || !step) return;
    onOrchestrate(step.before);

    let raf = 0;
    let tries = 0;
    const MAX_TRIES = 90; // ~1.5s（模态/编辑器冷挂载留足时间），到点仍无 → 降级居中、不崩

    const tick = () => {
      const el = step.tourId
        ? (document.querySelector(`[data-tour-id="${step.tourId}"]`) as HTMLElement | null)
        : null;
      if (el) {
        const r = el.getBoundingClientRect();
        // 防御：元素存在但尚未布局（rect 全 0）也继续等，避免 spotlight 套在 0×0 上。
        if (r.width > 0 && r.height > 0) {
          placeFor(r);
          return;
        }
      }
      if (step.tourId && tries < MAX_TRIES) {
        tries += 1;
        raf = requestAnimationFrame(tick);
        return;
      }
      // 无锚目标（before:none 的顶层步找不到 / 超时）→ 居中无镂空，绝不 NaN/崩。
      setSpot(null);
      setTooltipPos({
        top: Math.round(window.innerHeight / 2 - 80),
        left: Math.round(window.innerWidth / 2 - TOOLTIP_W / 2),
      });
    };

    // 算 spotlight 矩形 + tooltip 位置（place：优先右、放不下钳进视口）。
    const placeFor = (r: DOMRect) => {
      const rect: SpotRect = {
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      };
      setSpot(rect);

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 优先放右侧
      let left = r.right + GAP;
      let top = r.top;
      if (left + TOOLTIP_W > vw - 8) {
        // 放不下 → 放左侧
        left = r.left - GAP - TOOLTIP_W;
      }
      // 最终钳进视口（永不溢出）
      left = Math.max(8, Math.min(left, vw - TOOLTIP_W - 8));
      top = Math.max(8, Math.min(top, vh - 160));
      setTooltipPos({ top: Math.round(top), left: Math.round(left) });
    };

    // 下一帧再起（让 before() 触发的模态有机会进入 render/commit）。
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // step.before 是稳定字面量对象（来自模块常量）；按 stepIdx/active 驱动即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIdx]);

  // gsap 淡入整层（每次激活）。
  useLayoutEffect(() => {
    if (!active || !overlayRef.current) return;
    gsap.fromTo(overlayRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power1.out" });
  }, [active]);

  if (!active || !step) return null;

  const finish = () => {
    setActive(false);
    onFinish();
  };
  const next = () => {
    if (stepIdx >= steps.length - 1) finish();
    else setStepIdx((i) => i + 1);
  };
  const prev = () => setStepIdx((i) => Math.max(0, i - 1));

  return (
    <div
      ref={overlayRef}
      data-testid="onboarding-tour"
      style={{ position: "fixed", inset: 0, zIndex: 2000, visibility: "hidden" }}
    >
      {/* 遮罩 + spotlight：有 spot 则镂空高亮；无 spot 则整屏暗遮罩（降级居中步）。 */}
      {spot ? (
        <div
          data-testid="tour-spotlight"
          style={{
            position: "fixed",
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(17,17,20,.5)",
            border: "2px solid rgba(255,255,255,0.95)",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,17,20,.5)", pointerEvents: "none" }} />
      )}

      {/* tooltip 卡 */}
      <div
        data-testid="tour-tooltip"
        style={{
          position: "fixed",
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: TOOLTIP_W,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
          padding: 16,
          color: "var(--text)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", marginBottom: 6 }}>
          第 {stepIdx + 1} 步 / {steps.length}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)", marginBottom: 14 }}>
          {step.body}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            data-testid="tour-skip"
            onClick={finish}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              fontSize: 12,
              cursor: "pointer",
              padding: "4px 2px",
            }}
          >
            跳过
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {stepIdx > 0 && (
              <button
                data-testid="tour-prev"
                onClick={prev}
                style={{
                  padding: "6px 12px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                上一步
              </button>
            )}
            <button
              data-testid="tour-next"
              onClick={next}
              style={{
                padding: "6px 14px",
                background: "var(--accent)",
                border: "none",
                borderRadius: 7,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {stepIdx >= steps.length - 1 ? "完成" : "下一步"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
