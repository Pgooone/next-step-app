"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageView } from "@/components/MessageView";
import { computeFixedPopover } from "@/lib/pipeline/popover-position";
import { friendlyAgentName } from "@/lib/mastermind/friendly-name";
import { usePopoverPortalHost } from "@/lib/pipeline/use-popover-portal-host";
// D-R7B-07：领域层含 node:fs，UI 只 import type + fetch JSON。第 8.6 轮 T5：收超集 StageCardStage
// （status 含 "skipped"，协变兼容第七轮窄 PipelineRunStage）。
import type { StageCardStage } from "@/lib/pipeline/stage-card-stage";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

/**
 * 阶段二级菜单（T6，§3.10）：左键点 stage 卡弹出的悬浮浮层（非整页跳转），受控显隐由父卡 menuOpen 控。
 *
 * 四区：
 *   区1 只读 transcript —— fetch `/api/sessions/{sid}/context` 取 `context.messages`，构 toolResultsMap
 *        后裸渲 MessageView（**不传** onFork/onNavigate/onEditContent/entryId → 纯只读；不挂 ChatInput/send，
 *        绝不复用 ChatWindow，它顶层 useAgentSession+SSE 会复活会话绕 acquireSlot）。sessionId===null（未起）不发请求。
 *   区2 产物 —— stage.artifactId 在时给「打开受管文档」按钮，落 onOpenArtifact(artifactId)。
 *   区3 底部 agent 切换条 —— **全枚举** stages，sessionId==null 项置灰 disabled，可点项切「当前查看的 stage」（内部 state）。
 *   区4「进入完整对话」—— sessionId!=null 时显（done/历史也显，re-attach 解冻合法），落 onOpenSession(sessionId)。
 *
 * hover 浮窗（StageHoverPreview）与本 click 菜单分属两套独立 state，互不合并。
 */
const MENU_WIDTH = 380;

export default function StageSessionMenu({
  stage,
  stages,
  onOpenSession,
  onOpenArtifact,
  onSelectStage,
  onClose,
  anchorRef,
}: {
  stage: StageCardStage;
  stages: StageCardStage[];
  onOpenSession?: (sessionId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onSelectStage?: (stage: StageCardStage) => void;
  onClose?: () => void;
  /** 锚父卡（.brow）的 ref，用于 getBoundingClientRect 算 fixed 坐标（N2 脱离 overflow:hidden 裁切）。 */
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  // 当前查看的 stage：初始 = 传入 stage；区3 切换它（菜单自管理，onSelectStage 仅作可选回调透出）。
  const [viewStage, setViewStage] = useState<StageCardStage>(stage);

  // T7 P1 a11y：菜单容器 ref——用于 focus 管理 + 外点关判定。
  const menuRef = useRef<HTMLDivElement | null>(null);

  // T7 P1 a11y：打开即把焦点移入菜单（focus 管理），并监听 Esc 关 + 外点关。
  // 外点用 pointerdown（早于 click，避免与父卡 onClick 冒泡竞争重开）；锚卡自身点击也算「外部」→ 关闭。
  useEffect(() => {
    menuRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (menuRef.current && t && !menuRef.current.contains(t)) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    // 捕获阶段监听，先于父卡 onClick 处理，确保外点即关。
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  // N2：fixed 坐标在 useLayoutEffect 测量后存 state（渲染期/SSR 不能同步 getBoundingClientRect）。
  // maxHeightCap = 80vh，helper 再按选中侧可用空间钳到 min(80vh, 可用)。
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
    const cap = typeof window !== "undefined" ? window.innerHeight * 0.8 : 600;
    const p = computeFixedPopover(rect, MENU_WIDTH, cap);
    setPlacement({ left: p.left, top: p.top, bottom: p.bottom, maxHeight: p.maxHeight });
  }, [anchorRef]);

  const [messages, setMessages] = useState<AgentMessage[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);

  const sid = viewStage.sessionId;

  useEffect(() => {
    if (sid === null) {
      setMessages(null);
      setNotFound(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setMessages(null);
    fetch(`/api/sessions/${encodeURIComponent(sid)}/context`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setMessages([]);
          return;
        }
        const data = (await res.json()) as { context?: { messages?: AgentMessage[] } };
        if (cancelled) return;
        setMessages((data.context?.messages ?? []) as AgentMessage[]);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  // 构 toolResultsMap（仿 ChatWindow.tsx:371-376）：toolCallId → ToolResultMessage。
  const toolResultsMap = new Map<string, ToolResultMessage>();
  if (messages) {
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        toolResultsMap.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
  }

  const selectStage = (s: StageCardStage) => {
    setViewStage(s);
    onSelectStage?.(s);
  };

  // M3：Portal 到 body 级 `.pipeline-board t-kimi-{theme}` wrapper——同 StageHoverPreview，脱离 `.brow`
  // （GSAP transform 造的包含块）、fixed 恢复相对视口 + token 有值。host 未就绪（SSR/首帧）不渲。
  const host = usePopoverPortalHost();
  if (!host) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-testid="stage-session-menu"
      role="dialog"
      aria-modal="false"
      aria-label={`阶段 ${viewStage.order} 会话菜单`}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // 冗余兜底：焦点在菜单内时 Esc 也关（document 监听已覆盖，双保险）。
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose?.();
        }
      }}
      style={{
        position: "fixed",
        outline: "none",
        // 未测量出坐标前先隐藏（避免首帧落 0,0 闪一下）；above 用 bottom 锚、below 用 top 锚。
        top: placement ? (placement.top ?? undefined) : 0,
        bottom: placement?.bottom ?? undefined,
        left: placement?.left ?? 0,
        visibility: placement ? "visible" : "hidden",
        // M3 评审遗漏命门：Portal 到 body 后成 PipelineModal(z:1000) 同胞，须 >1000 才不被盖；
        // 取 1060（>hover 浮窗 1050 保相对序，<ModelsConfig z:1100 / OnboardingTour z:2000 / Toaster z:9999）。
        zIndex: 1060,
        width: MENU_WIDTH,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: placement?.maxHeight ?? "80vh",
        background: "var(--pop)",
        border: "1px solid var(--line)",
        borderRadius: 13,
        padding: "0.8rem",
        color: "var(--task)",
        boxShadow: "0 14px 38px rgba(0,0,0,0.22)",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
      }}
    >
      {/* 头部：名 + 序号 + 关闭（钉死不跟滚：flex none） */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flex: "none" }}>
        <span style={{ fontWeight: 700, fontSize: "0.86rem", color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {/* M5a：剥 uuid8 尾巴——优先 role（职衔）、否则 friendly 名。 */}
          {viewStage.role || friendlyAgentName(viewStage.agentName ?? viewStage.agentId)}
        </span>
        <span style={{ fontSize: "0.68rem", color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>
          阶段 {String(viewStage.order).padStart(2, "0")}
        </span>
        <button
          onClick={onClose}
          title="关闭"
          style={{
            background: "none",
            border: "none",
            color: "var(--sub)",
            cursor: "pointer",
            fontSize: "1rem",
            lineHeight: 1,
            padding: "0 0.2rem",
          }}
        >
          ×
        </button>
      </div>

      {/* 区1 只读 transcript（flex:1 填充、内部滚动；底部按钮钉死不跟滚） */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: "0.55rem",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {sid === null ? (
          <div style={{ fontSize: "0.75rem", color: "var(--sub)", padding: "0.8rem 0", textAlign: "center" }}>
            尚未开始
          </div>
        ) : notFound ? (
          <div style={{ fontSize: "0.75rem", color: "var(--sub)", padding: "0.8rem 0", textAlign: "center" }}>
            记录已不存在
          </div>
        ) : loading ? (
          <div style={{ fontSize: "0.75rem", color: "var(--sub)", padding: "0.8rem 0", textAlign: "center" }}>
            加载中…
          </div>
        ) : messages && messages.length > 0 ? (
          messages.map((mm, i) => (
            <MessageView key={i} message={mm} toolResults={toolResultsMap} modelNames={{}} />
          ))
        ) : (
          <div style={{ fontSize: "0.75rem", color: "var(--sub)", padding: "0.8rem 0", textAlign: "center" }}>
            暂无对话记录
          </div>
        )}
      </div>

      {/* 底部钉死区（不跟滚：flex none）：区2 产物 + 区4 进入对话 + 区3 切换条 */}
      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {/* 区2 产物 */}
        {viewStage.artifactId && (
          <button
            data-testid="stage-menu-open-artifact"
            onClick={() => onOpenArtifact?.(viewStage.artifactId!)}
            style={menuActionStyle}
          >
            📄 打开受管文档
          </button>
        )}

        {/* 区4「进入完整对话」（done/历史也显示，re-attach 解冻合法） */}
        {sid !== null && (
          <button
            data-testid="stage-menu-open-session"
            onClick={() => onOpenSession?.(sid)}
            style={menuActionStyle}
          >
            进入完整对话 →
          </button>
        )}

        {/* 区3 底部 agent 切换条：全枚举 stages，sessionId==null 置灰 */}
        {stages.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {stages.map((s) => {
              const disabled = s.sessionId === null;
              const active = s.order === viewStage.order;
              return (
                <button
                  key={s.order}
                  disabled={disabled}
                  onClick={() => selectStage(s)}
                  title={disabled ? "该阶段尚未开始" : s.role || friendlyAgentName(s.agentName ?? s.agentId)}
                  style={{
                    fontSize: "0.66rem",
                    padding: "0.12rem 0.45rem",
                    borderRadius: 999,
                    border: active ? "1px solid var(--accent)" : "1px solid var(--line)",
                    background: active ? "var(--run-bg)" : "none",
                    color: disabled ? "var(--task)" : active ? "var(--accent)" : "var(--sub)",
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {String(s.order).padStart(2, "0")} {s.role || friendlyAgentName(s.agentName ?? s.agentId)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    host,
  );
}

const menuActionStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: "0.74rem",
  padding: "0.4rem 0.6rem",
  borderRadius: 9,
  border: "1px solid var(--line)",
  background: "none",
  color: "var(--accent)",
  cursor: "pointer",
};
