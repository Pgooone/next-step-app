"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "@/lib/stores/useProjectStore";
import type { Project } from "@/lib/domain/project-registry";

/**
 * 卡片副信息：Project 现仅有 createdAt（无独立「最近活动」字段），
 * 故诚实展示创建时间。抽成函数便于日后若引入真实活动时间时只改这一处（待 D-V1.1 决策）。
 */
function formatActivity(p: Project): { label: string; value: string } {
  const d = new Date(p.createdAt);
  const value = Number.isNaN(d.getTime())
    ? p.createdAt
    : d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return { label: "创建于", value };
}

export function ProjectHome() {
  const { projects, refresh } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, refresh: s.refresh })),
  );

  // 新建表单
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 待确认删除的项目 id（卡片内联二次确认）
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const openCreate = useCallback(() => {
    setCreateOpen(true);
    setCreateError(null);
    setConfirmId(null);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setName("");
    setRoot("");
    setCreateError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      // create 成功后 store 内部会 select 新项目 → 入口分流自动切到工作台
      await useProjectStore.getState().create({ name, root });
      closeCreate();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [creating, name, root, closeCreate]);

  const handleEnter = useCallback((p: Project) => {
    // 选中即进工作台（入口分流据 currentProjectId 切换）
    useProjectStore.getState().select(p.id);
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    setConfirmId(null);
    try {
      await useProjectStore.getState().remove(id);
    } catch {
      // 删除失败保持原状（后端 404 已被 store 视为成功）
    }
  }, []);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "48px 24px 64px" }}>
        {/* 标题区 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28, gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
              Next-Step
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
              选择一个项目进入工作台，或新建一个项目。
            </div>
          </div>
          {!createOpen && (
            <button
              onClick={openCreate}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "8px 14px",
                background: "var(--accent)", border: "none", borderRadius: 8,
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <line x1="5" y1="1" x2="5" y2="9" /><line x1="1" y1="5" x2="9" y2="5" />
              </svg>
              新建项目
            </button>
          )}
        </div>

        {/* 新建表单（展开时） */}
        {createOpen && (
          <div
            style={{
              marginBottom: 24, padding: 16,
              background: "var(--bg-panel)", border: "1px solid var(--accent)", borderRadius: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>新建项目</div>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setCreateError(null); }}
              onKeyDown={(e) => { if (e.key === "Escape") closeCreate(); }}
              placeholder="项目名称"
              style={{
                width: "100%", fontSize: 13, padding: "8px 10px",
                border: "1px solid var(--border)", borderRadius: 7,
                outline: "none", background: "var(--bg)", color: "var(--text)",
                boxSizing: "border-box", marginBottom: 8,
              }}
            />
            <input
              value={root}
              onChange={(e) => { setRoot(e.target.value); setCreateError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void handleCreate(); }
                if (e.key === "Escape") closeCreate();
              }}
              placeholder="/path/to/project"
              style={{
                width: "100%", fontSize: 13, fontFamily: "var(--font-mono)", padding: "8px 10px",
                border: "1px solid var(--border)", borderRadius: 7,
                outline: "none", background: "var(--bg)", color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
            {createError && (
              <div style={{ marginTop: 8, color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                {createError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !name.trim() || !root.trim()}
                style={{
                  padding: "7px 16px",
                  background: "var(--accent)", border: "none", borderRadius: 7,
                  color: "#fff", fontSize: 12, fontWeight: 600,
                  cursor: creating || !name.trim() || !root.trim() ? "not-allowed" : "pointer",
                  opacity: creating || !name.trim() || !root.trim() ? 0.6 : 1,
                }}
              >
                {creating ? "创建中…" : "创建"}
              </button>
              <button
                onClick={closeCreate}
                style={{
                  padding: "7px 16px",
                  background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7,
                  color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 卡片墙 */}
        {projects.length === 0 && !createOpen ? (
          <div
            style={{
              padding: "56px 24px", textAlign: "center",
              border: "1px dashed var(--border)", borderRadius: 12,
              color: "var(--text-muted)", fontSize: 13,
            }}
          >
            还没有项目。点击右上角「新建项目」开始。
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {projects.map((p) => {
              const activity = formatActivity(p);
              const confirming = confirmId === p.id;
              return (
                <div
                  key={p.id}
                  data-testid="project-card"
                  onClick={() => { if (!confirming) handleEnter(p); }}
                  style={{
                    position: "relative",
                    padding: 16,
                    background: confirming ? "rgba(239,68,68,0.05)" : "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    cursor: confirming ? "default" : "pointer",
                    transition: "border-color 0.15s, background 0.15s, transform 0.1s",
                  }}
                  onMouseEnter={(e) => { if (!confirming) { e.currentTarget.style.borderColor = "var(--accent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  {confirming ? (
                    /* 内联二次确认：点明仅移除注册、不删磁盘、重加可恢复 */
                    <div onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>
                        移除「{p.name}」？
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
                        仅从列表移除注册项，<strong style={{ color: "var(--text)" }}>不会删除磁盘上的 <code style={{ fontFamily: "var(--font-mono)" }}>.pi/</code> 数据</strong>（agent、产物、会话仍在）。重新添加同一路径即可恢复。
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => void handleRemove(p.id)}
                          style={{
                            padding: "6px 14px",
                            background: "#ef4444", border: "none", borderRadius: 7,
                            color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          移除
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          style={{
                            padding: "6px 14px",
                            background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7,
                            color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 删除按钮 */}
                      <button
                        data-testid="remove-project-btn"
                        onClick={(e) => { e.stopPropagation(); setConfirmId(p.id); }}
                        title="移除项目"
                        style={{
                          position: "absolute", top: 10, right: 10,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 28, height: 28, padding: 0,
                          background: "none", border: "none", borderRadius: 7,
                          color: "var(--text-dim)", cursor: "pointer",
                          transition: "color 0.12s, background 0.12s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>

                      {/* 项目名 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 28, marginBottom: 10 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.name}
                        </span>
                      </div>

                      {/* 路径 */}
                      <div
                        style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 8 }}
                        title={p.root}
                      >
                        {p.root}
                      </div>

                      {/* 副信息：创建于 */}
                      <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                        {activity.label} {activity.value}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
