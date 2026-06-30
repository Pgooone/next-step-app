"use client";

/**
 * 第8.5轮 T1 · 首用引导 Tour —— 自定义 overlay 引擎（前端设计 §1.1/§1.2/§1.3）。
 *
 * 方案 B 分层（用户拍板）：默认总览轨（5 步，锚工作台顶层）+ 深度轨（6 步，按需，开真实模态高亮内部）。
 *  - 总览末步多一颗绿色「深入引导 →」切深度轨。
 *  - 深度轨 before() 经 AppShell 透传 initial* 把两模态开到目标子视图（Agents 表单 / Pipeline 两 tab /
 *    空草稿编辑器），再 spotlight 其中元素；步 4/5/6 面向零数据新用户**降级**（锚恒在元素 + 文案描述，
 *    绝不对空态/不存在元素 spotlight，D-R8.5-03）。
 *
 * 技术（ADR D-R8.5-01）：自定义 overlay、不引第三方 tour 库——
 *  - spotlight：单个全屏暗遮罩用 `box-shadow: 0 0 0 9999px rgba(17,17,20,.5)` 镂空 + 2px 白边，
 *    镂空矩形 = 目标 getBoundingClientRect() + 6px pad（位置算出、非写死）。
 *  - tooltip：绝对定位卡片（层级标签 + 第N/M步 + 标题 + 正文 + 步骤点 + 跳过/上一步/下一步），
 *    place 优先放右 → 放不下放左 → 再不下放下方 → 最后钳进视口（永不溢出/裁切）。
 *  - 过渡：复用项目已装 gsap（@/lib/gsap-setup）做淡入。
 *
 * 客户端 bundle 边界（D-R7B-07）：'use client'，**严禁值导入任何 server-only 模块**
 * （node:fs / pipeline-orchestrator 等）。本文件零此类导入。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap-setup";

/** 首启已看标记的 localStorage key（看完/跳过落它，不再自动弹）。 */
export const TOUR_SEEN_KEY = "next-step:tour-seen";

/**
 * 引导每步进入时的「场景」编排（before）——AppShell 据此把模态开到子视图 / 开右侧面板。
 * modal:"none" = 锚工作台顶层元素，不动模态。AppShell 透传成两模态的 initial* + 右侧面板开关。
 */
export type TourScene = {
  modal: "none" | "pipeline" | "agents";
  /** modal==="pipeline" 时的初始 tab/view/选中蓝图。 */
  tab?: "pipeline" | "dispatch";
  view?: "board" | "editor";
  blueprintId?: string;
  /** modal==="agents" 时的初始视图（list|create）。 */
  agentsView?: "list" | "create";
  /** 步「产物面板」需先展开右侧面板再 spotlight（恒在但折叠 0 宽）。 */
  openRightPanel?: boolean;
};

type Level = "总览" | "Agents" | "Pipeline" | "蓝图" | "看板" | "对话" | "产物";

/** 单步配置。 */
type TourStep = {
  /** spotlight + place 的锚目标（data-tour-id 值）；找不到/超时 → 居中无镂空（降级，绝不崩）。 */
  tourId: string;
  level: Level;
  title: string;
  body: string;
  /** 进入该步要编排的场景（none = 锚顶层不动模态）。 */
  scene: TourScene;
};

/** 层级标签配色（蓝系基调，区分轨/层）。 */
const LEVEL_COLOR: Record<Level, string> = {
  总览: "#2563eb",
  Agents: "#7c3aed",
  Pipeline: "#0891b2",
  蓝图: "#0891b2",
  看板: "#0891b2",
  对话: "#2563eb",
  产物: "#059669",
};

/* ── 总览轨（默认首启 · 5 步，锚工作台顶层恒在元素） ───────────────── */
const OVERVIEW_STEPS: TourStep[] = [
  {
    tourId: "tour-project-switcher",
    level: "总览",
    title: "项目 = 磁盘上一个文件夹",
    body: "这里切换 / 新建项目。新建时可勾「目录不存在则自动创建」。每个项目是独立工作区。",
    scene: { modal: "none" },
  },
  {
    tourId: "tour-agents-entry",
    level: "总览",
    title: "Agents：捏协作角色",
    body: "在这里自定义协作角色（产品经理 / 架构师 / 审查员…）：设定模型、技能、文档型 / 编码型模式。",
    scene: { modal: "none" },
  },
  {
    tourId: "tour-pipeline-entry",
    level: "总览",
    title: "Pipeline：多 Agent 接力",
    body: "多个 Agent 按固定顺序接力 = 流水线，可保存复用；只想临时派一次 → 用面板里的「快速派发」。",
    scene: { modal: "none" },
  },
  {
    tourId: "tour-chat-input",
    level: "对话",
    title: "也可直接单聊",
    body: "在主对话输入框直接聊；输入 @ 可把当前对话转交给某个 Agent。",
    scene: { modal: "none" },
  },
  {
    tourId: "tour-artifact-panel",
    level: "产物",
    title: "产物面板",
    body: "Agent 产出的文档落在这里，带版本 / Diff / 按块确认——改动需逐块确认才写盘。",
    scene: { modal: "none", openRightPanel: true },
  },
];

/* ── 深度轨（按需 · 6 步，before() 开真实模态高亮内部；步 4/5/6 空环境降级） ── */
const DEEP_STEPS: TourStep[] = [
  {
    tourId: "agent-form-name",
    level: "Agents",
    title: "新建 Agent",
    body: "给 Agent 起名、选模型、挑模式（文档型推荐：改动按块确认更安全；编码型可读写文件 / 跑命令）。",
    scene: { modal: "agents", agentsView: "create" },
  },
  {
    tourId: "pipeline-tab",
    level: "Pipeline",
    title: "两种派发方式",
    body: "「流水线」= 多 Agent 按蓝图顺序接力；「快速派发」= 临时派一次。两个 tab 在这里切换。",
    scene: { modal: "pipeline", tab: "pipeline", view: "board" },
  },
  {
    tourId: "pipeline-editor-name",
    level: "蓝图",
    title: "排一条流水线",
    body: "蓝图编辑器里起名、按顺序添加阶段（每阶段选 Agent + 填子任务）、用 ↑↓ 调序。空项目也能直接编排。",
    scene: { modal: "pipeline", tab: "pipeline", view: "editor" },
  },
  {
    // 步 4 降级：运行控制条须 blueprints>0 才渲 → 空环境锚 board 空态区「新建流水线」按钮（恒在）+ 降级文案。
    tourId: "pipeline-empty-new",
    level: "看板",
    title: "运行流水线",
    body: "建好蓝图后，看板顶部会出现「选蓝图 + ▶ 运行」控制条（并发上限默认 3、可配）。现在是空态，先去建一条蓝图。",
    scene: { modal: "pipeline", tab: "pipeline", view: "board" },
  },
  {
    // 步 5（并步 6）降级：阶段看板卡 / 阶段菜单须有 currentRun 才渲 → 空环境锚 board 空态区 + 文案描述。
    tourId: "pipeline-empty-note",
    level: "看板",
    title: "阶段看板",
    body: "跑起来后这里实时显示每个阶段进度（待执行 / 执行中 / 完成 + N/M）；点某阶段卡可进会话 / 看该阶段产物。",
    scene: { modal: "pipeline", tab: "pipeline", view: "board" },
  },
  {
    tourId: "tour-artifact-panel",
    level: "产物",
    title: "产物落地",
    body: "无论单聊、快速派发还是流水线，产出的受管文档都汇到右侧产物面板，带版本 / Diff / 按块确认。引导到此结束，随时可点侧栏「新手引导」重看。",
    scene: { modal: "none", openRightPanel: true },
  },
];

/** spotlight 镂空矩形（视口坐标）；null = 无目标（居中、整屏暗遮罩、不镂空）。 */
type SpotRect = { top: number; left: number; width: number; height: number } | null;

const PAD = 6; // spotlight 目标外扩
const TOOLTIP_W = 320;
const TOOLTIP_EST_H = 200; // 估高，用于钳制下边界
const GAP = 14; // tooltip 与 spotlight 间距

type Props = {
  /** 由 AppShell 透传：按 scene 编排两模态 / 右侧面板（set 后再开模态，mount 取 initial*）。 */
  onOrchestrate: (scene: TourScene) => void;
  /** 引导结束（完成 / 跳过）：AppShell 收到后关闭引导 + 复位编排 + 落 seen 标记。 */
  onFinish: () => void;
  /** 是否允许进深度轨（深度轨须开模态、模态须有项目）；false 则隐藏总览末步「深入引导」。 */
  canDeepTrack: boolean;
};

export function OnboardingTour({ onOrchestrate, onFinish, canDeepTrack }: Props) {
  const [track, setTrack] = useState<"overview" | "deep">("overview");
  const [stepIdx, setStepIdx] = useState(0);
  const [spot, setSpot] = useState<SpotRect>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const steps = track === "overview" ? OVERVIEW_STEPS : DEEP_STEPS;
  const step = steps[stepIdx];
  const isLastOfTrack = stepIdx >= steps.length - 1;

  // place：算 spotlight 矩形 + tooltip 位置（右→左→下→钳进视口）。
  const placeFor = useCallback((r: DOMRect) => {
    setSpot({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top = r.top;

    if (r.right + GAP + TOOLTIP_W <= vw - 8) {
      // 右侧放得下
      left = r.right + GAP;
    } else if (r.left - GAP - TOOLTIP_W >= 8) {
      // 左侧放得下
      left = r.left - GAP - TOOLTIP_W;
    } else {
      // 左右都不下 → 放下方，水平贴目标左缘
      left = r.left;
      top = r.bottom + GAP;
    }
    // 最终钳进视口（永不溢出/裁切）
    left = Math.max(8, Math.min(left, vw - TOOLTIP_W - 8));
    top = Math.max(8, Math.min(top, vh - TOOLTIP_EST_H - 8));
    setTooltipPos({ top: Math.round(top), left: Math.round(left) });
  }, []);

  // 降级：无锚目标（找不到/超时）→ 居中、整屏暗遮罩、不镂空。
  const degradeCenter = useCallback(() => {
    setSpot(null);
    setTooltipPos({
      top: Math.round(window.innerHeight / 2 - TOOLTIP_EST_H / 2),
      left: Math.round(window.innerWidth / 2 - TOOLTIP_W / 2),
    });
  }, []);

  // 进入每一步：先编排场景（before），再轮询等目标元素挂载 + 布局，算 spotlight。
  // 进入每一步：先编排场景（before），再**持续** RAF 追踪锚点矩形——
  // 既等模态/编辑器冷挂载（poll until found），又跟随面板展开过渡 / 异步内容加载导致的后续位移
  // （rect 变化即重新 placeFor），故 resize / 折叠面板展开 / 列表懒加载回流都不会让 spotlight 错位。
  useEffect(() => {
    if (!step) return;
    onOrchestrate(step.scene);
    // 切步先把 tooltip 移出视口，避免上一位置闪一下。
    setTooltipPos({ top: -9999, left: -9999 });

    let raf = 0;
    let waited = 0; // 尚未找到目标前的等待帧数
    let found = false;
    let lastKey = ""; // 上次 placeFor 的矩形指纹，变化才重排
    const MAX_WAIT = 90; // ~1.5s 仍找不到 → 降级居中、不崩

    const loop = () => {
      const el = document.querySelector(`[data-tour-id="${step.tourId}"]`) as HTMLElement | null;
      const r = el ? el.getBoundingClientRect() : null;
      // 防御：元素存在但尚未布局（rect 全 0）视为未就绪，继续等。
      if (r && r.width > 0 && r.height > 0) {
        found = true;
        const key = `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}`;
        if (key !== lastKey) {
          lastKey = key;
          placeFor(r as DOMRect);
        }
      } else if (!found) {
        waited += 1;
        if (waited >= MAX_WAIT) {
          degradeCenter();
          return; // 停止追踪（降级态固定）
        }
      } else {
        // 曾找到、现消失（如模态切换瞬间）→ 居中兜底，继续追踪（可能再出现）。
        degradeCenter();
        lastKey = "";
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // step.scene 来自模块常量、稳定；按 track/stepIdx 驱动即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, stepIdx]);

  // gsap 淡入整层（挂载时）。
  useLayoutEffect(() => {
    if (!overlayRef.current) return;
    gsap.fromTo(overlayRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power1.out" });
  }, []);

  if (!step) return null;

  const finish = () => onFinish();
  const next = () => {
    if (isLastOfTrack) finish();
    else setStepIdx((i) => i + 1);
  };
  const prev = () => setStepIdx((i) => Math.max(0, i - 1));
  const enterDeep = () => {
    setTrack("deep");
    setStepIdx(0);
  };

  const levelColor = LEVEL_COLOR[step.level];
  // 总览末步且允许深度轨 → 显「深入引导 →」（取代「完成」）。
  const showDeepCTA = track === "overview" && isLastOfTrack && canDeepTrack;

  return (
    <div
      ref={overlayRef}
      data-testid="onboarding-tour"
      data-track={track}
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
            transition: "top 0.18s ease, left 0.18s ease, width 0.18s ease, height 0.18s ease",
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
        {/* 头：层级标签（彩） + 第 N 步 / M */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span
            data-testid="tour-level"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.3,
              color: "#fff",
              background: levelColor,
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            {step.level}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
            第 {stepIdx + 1} 步 / {steps.length}
          </span>
        </div>

        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)", marginBottom: 14 }}>
          {step.body}
        </div>

        {/* 步骤点 */}
        <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
          {steps.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === stepIdx ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === stepIdx ? levelColor : "var(--border)",
                transition: "width 0.2s, background 0.2s",
              }}
            />
          ))}
        </div>

        {/* 操作行 */}
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
            {showDeepCTA ? (
              <button
                data-testid="tour-deep"
                onClick={enterDeep}
                style={{
                  padding: "6px 14px",
                  background: "#059669",
                  border: "none",
                  borderRadius: 7,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                深入引导 →
              </button>
            ) : (
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
                {isLastOfTrack ? "完成" : "下一步"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
