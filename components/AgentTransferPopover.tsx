"use client";

import { useState } from "react";
import {
  buildTransferMessage,
  defaultTransferSelection,
  type TransferHistoryItem,
} from "@/lib/agent-transfer";
import type { TextAttachment } from "@/lib/chat-file-attach";

/** 待选 agent 的极简视图（id / 名 / 色点）。 */
export interface TransferAgent {
  id: string;
  name: string;
  color: string;
}

interface Props {
  agents: TransferAgent[];
  history: TransferHistoryItem[];
  attachments: TextAttachment[];
  /** 确认转交：组装好的载荷作目标会话首条消息。 */
  onConfirm: (agentId: string, message: string) => void;
  onClose: () => void;
}

/**
 * M8 · 主对话 @agent 转交浮层。两阶段：
 *  1) pick —— 列出该项目 agent，选一个；
 *  2) compose —— 勾选「全主对话历史 / 已附文件」（默认据有无勾选），确认投递。
 * 纯展示 + 本地勾选态；载荷组装与默认值走 lib/agent-transfer 纯函数。
 */
export function AgentTransferPopover({ agents, history, attachments, onConfirm, onClose }: Props) {
  const [picked, setPicked] = useState<TransferAgent | null>(null);
  const initial = defaultTransferSelection(history.length > 0, attachments.length > 0);
  const [includeHistory, setIncludeHistory] = useState(initial.includeHistory);
  const [includeFiles, setIncludeFiles] = useState(initial.includeFiles);

  const message = picked
    ? buildTransferMessage({ history, attachments, includeHistory, includeFiles })
    : "";

  return (
    <div
      data-testid="agent-transfer-popover"
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        zIndex: 600,
        width: 320,
        maxWidth: "90vw",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 -6px 24px rgba(0,0,0,0.14)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          color: "var(--text-muted)",
          fontWeight: 600,
        }}
      >
        <span>{picked ? `转交给 ${picked.name}` : "转交给 Agent"}</span>
        <button
          onClick={onClose}
          aria-label="关闭"
          style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 2 }}
        >
          ✕
        </button>
      </div>

      {!picked ? (
        <div style={{ maxHeight: 260, overflowY: "auto", padding: 4 }}>
          {agents.length === 0 ? (
            <div style={{ padding: "12px", color: "var(--text-dim)", textAlign: "center" }}>
              该项目还没有 Agent，先到 Agents 里新建
            </div>
          ) : (
            agents.map((a) => (
              <button
                key={a.id}
                data-testid="transfer-agent-option"
                data-agent-name={a.name}
                onClick={() => setPicked(a)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: 7,
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>选择转交内容：</div>
          <label
            data-testid="transfer-include-history"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: history.length ? "pointer" : "not-allowed", opacity: history.length ? 1 : 0.5 }}
          >
            <input
              type="checkbox"
              checked={includeHistory}
              disabled={history.length === 0}
              onChange={(e) => setIncludeHistory(e.target.checked)}
            />
            <span>全主对话历史（{history.length} 条）</span>
          </label>
          <label
            data-testid="transfer-include-files"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: attachments.length ? "pointer" : "not-allowed", opacity: attachments.length ? 1 : 0.5 }}
          >
            <input
              type="checkbox"
              checked={includeFiles}
              disabled={attachments.length === 0}
              onChange={(e) => setIncludeFiles(e.target.checked)}
            />
            <span>已附文件（{attachments.length} 个）</span>
          </label>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setPicked(null)}
              style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
            >
              返回
            </button>
            <button
              data-testid="transfer-confirm"
              disabled={!message}
              onClick={() => onConfirm(picked.id, message)}
              style={{
                padding: "6px 16px",
                background: message ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 7,
                color: message ? "#fff" : "var(--text-dim)",
                cursor: message ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              转交
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
