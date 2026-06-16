"use client";

import { useEffect, useState } from "react";
import type { Artifact } from "@/lib/domain/artifact-service";

/**
 * 极简「打开产物」入口（D3）：列当前项目下受管 artifact（GET /api/projects/[id]/artifacts），
 * 点击一项 → onPick(id) 让 AppShell 在右侧面板用 ArtifactPanel 打开。
 * 仿既有模态范式（AgentManager / DispatchPanel）。纯选择器，不做创建 / 编辑（超 D3 范围）。
 */
export function ArtifactPicker({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  onPick: (artifactId: string) => void;
  onClose: () => void;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts`)
      .then(async (r) => {
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<Artifact[]>;
      })
      .then(setArtifacts)
      .catch((e) => setError(String(e)));
  }, [projectId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 600,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 92vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          打开产物
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflow: "auto", padding: 8 }}>
          {error ? (
            <div style={{ padding: 16, color: "#f87171", fontSize: 13 }}>{error}</div>
          ) : artifacts === null ? (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>加载中…</div>
          ) : artifacts.length === 0 ? (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              当前项目暂无受管产物。
            </div>
          ) : (
            artifacts.map((a) => (
              <button
                key={a.id}
                data-testid={`artifact-item-${a.id}`}
                onClick={() => onPick(a.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  background: "none",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
                  {a.kind} · v{a.currentVersion}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
