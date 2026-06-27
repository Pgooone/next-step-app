"use client";

import { useEffect, useState } from "react";
import { MessageView } from "@/components/MessageView";
// D-R7B-07：领域层（pipeline-run-store）含 node:fs，只能 import type，绝不 value-import
// （否则 "use client" 链把 node:fs 拖进客户端 bundle → 全站 500）。会话记录经 fetch JSON 取。
import type { PipelineRunStage } from "@/lib/domain/pipeline-run-store";
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
export default function StageSessionMenu({
  stage,
  stages,
  onOpenSession,
  onOpenArtifact,
  onSelectStage,
  onClose,
}: {
  stage: PipelineRunStage;
  stages: PipelineRunStage[];
  onOpenSession?: (sessionId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onSelectStage?: (stage: PipelineRunStage) => void;
  onClose?: () => void;
}) {
  // 当前查看的 stage：初始 = 传入 stage；区3 切换它（菜单自管理，onSelectStage 仅作可选回调透出）。
  const [viewStage, setViewStage] = useState<PipelineRunStage>(stage);
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

  const selectStage = (s: PipelineRunStage) => {
    setViewStage(s);
    onSelectStage?.(s);
  };

  return (
    <div
      data-testid="stage-session-menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 60,
        width: 380,
        maxWidth: "100%",
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
      {/* 头部：名 + 序号 + 关闭 */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
        <span style={{ fontWeight: 700, fontSize: "0.86rem", color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {viewStage.agentName ?? viewStage.agentId}
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

      {/* 区1 只读 transcript（≤ ~320px 可滚动） */}
      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: "0.55rem",
          maxHeight: 320,
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
                title={disabled ? "该阶段尚未开始" : s.agentName ?? s.agentId}
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
                {String(s.order).padStart(2, "0")} {s.agentName ?? s.agentId}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
