"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useProjectStore,
  selectCurrentProject,
} from "@/lib/stores/useProjectStore";
import { toast } from "@/lib/stores/useToastStore";
import type { Project } from "@/lib/domain/project-registry";

/** 把绝对路径缩短为 …/倒数两段，用于下拉里每项的副标题。 */
function shortenPath(p: string): string {
  const sep = p.includes("/") ? "/" : "\\";
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join(sep);
}

interface Props {
  /** 选中 / 切换项目后回调（用于走 AppShell 现有切 cwd 关旧会话逻辑）。 */
  onProjectSelected?: (root: string | null) => void;
}

export function ProjectSwitcher({ onProjectSelected }: Props) {
  const { projects, refresh, select, remove } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      refresh: s.refresh,
      select: s.select,
      remove: s.remove,
    })),
  );
  const current = useProjectStore(selectCurrentProject);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 新建表单状态
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 待确认删除的项目 id（内联确认条）
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // 外部点击关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreateOpen(false);
        setCreateIfMissing(false);
        setConfirmId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback(
    (p: Project) => {
      select(p.id);
      setOpen(false);
      setConfirmId(null);
      onProjectSelected?.(p.root);
    },
    [select, onProjectSelected],
  );

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await useProjectStore.getState().create({ name, root, createIfMissing });
      setCreateOpen(false);
      setName("");
      setRoot("");
      setCreateIfMissing(false);
      setOpen(false);
      onProjectSelected?.(project.root);
      toast.success(`已创建项目「${project.name}」`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [creating, name, root, createIfMissing, onProjectSelected]);

  const handleRemoveConfirm = useCallback(
    async (id: string) => {
      const wasCurrent = useProjectStore.getState().currentProjectId === id;
      const projName = projects.find((p) => p.id === id)?.name ?? "项目";
      setConfirmId(null);
      try {
        await remove(id);
        if (wasCurrent) onProjectSelected?.(null);
        toast.success(`已删除项目「${projName}」`);
      } catch (e) {
        // 删除原本吞错（后端 404 已被 store 视为成功）：真失败补 toast 兜底。
        toast.error(`删除项目失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [remove, onProjectSelected, projects],
  );

  return (
    <div ref={containerRef} style={{ position: "relative", marginBottom: 8 }}>
      {/* 触发按钮：显示当前项目名 */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 10px",
          background: current ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
          border: current ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 12,
          color: "var(--text)",
          textAlign: "left",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: current ? "var(--accent)" : "var(--text-dim)" }}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: current ? 500 : 400,
            color: current ? "var(--text)" : "var(--text-dim)",
          }}
          title={current?.root ?? ""}
        >
          {current ? current.name : "选择项目…"}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-dim)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
            overflow: "hidden",
          }}
        >
          {projects.length === 0 && !createOpen && (
            <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-muted)" }}>
              暂无项目
            </div>
          )}

          {projects.map((p) => (
            <div
              key={p.id}
              style={{
                borderBottom: "1px solid var(--border)",
                background: confirmId === p.id ? "rgba(239,68,68,0.06)" : p.id === current?.id ? "var(--bg-selected)" : "none",
              }}
            >
              {confirmId === p.id ? (
                /* 内联二次确认条：注明仅移除注册项、不删磁盘 */
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.45, marginBottom: 6 }}>
                    移除 <span style={{ fontWeight: 600 }}>{p.name}</span>？
                    <span style={{ color: "var(--text-dim)" }}> 仅移除注册项，不删除磁盘文件。</span>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleRemoveConfirm(p.id); }}
                      style={{
                        flex: 1, padding: "4px 0",
                        background: "#ef4444", border: "none", borderRadius: 5,
                        color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      移除
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                      style={{
                        flex: 1, padding: "4px 0",
                        background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5,
                        color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button
                    onClick={() => handleSelect(p)}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 0,
                      padding: "8px 10px",
                      background: "none",
                      border: "none",
                      color: p.id === current?.id ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                      {p.id === current?.id && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <polyline points="1.5 5 4 7.5 8.5 2.5" />
                        </svg>
                      )}
                      <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </span>
                    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.root}>
                      {shortenPath(p.root)}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmId(p.id); }}
                    title="移除项目"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 28, height: 28, marginRight: 6, padding: 0,
                      background: "none", border: "none",
                      color: "var(--text-dim)", cursor: "pointer",
                      borderRadius: 6, flexShrink: 0,
                      transition: "color 0.12s, background 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* 新建项目 */}
          {!createOpen ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCreateOpen(true);
                setCreateError(null);
                setConfirmId(null);
                setTimeout(() => nameInputRef.current?.focus(), 0);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                width: "100%", padding: "8px 10px",
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                textAlign: "left", fontSize: 11,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <line x1="5" y1="1" x2="5" y2="9" />
                <line x1="1" y1="5" x2="9" y2="5" />
              </svg>
              <span>新建项目…</span>
            </button>
          ) : (
            <div style={{ padding: "8px 10px", borderTop: projects.length > 0 ? "1px solid var(--border)" : "none" }}>
              <input
                ref={nameInputRef}
                value={name}
                onChange={(e) => { setName(e.target.value); setCreateError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setCreateOpen(false); setName(""); setRoot(""); setCreateIfMissing(false); setCreateError(null); }
                }}
                placeholder="项目名称"
                style={{
                  width: "100%", fontSize: 11, padding: "5px 8px",
                  border: "1px solid var(--accent)", borderRadius: 5,
                  outline: "none", background: "var(--bg)", color: "var(--text)",
                  boxSizing: "border-box", marginBottom: 5,
                }}
              />
              <input
                value={root}
                onChange={(e) => { setRoot(e.target.value); setCreateError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void handleCreate(); }
                  if (e.key === "Escape") { setCreateOpen(false); setName(""); setRoot(""); setCreateIfMissing(false); setCreateError(null); }
                }}
                placeholder="/path/to/project"
                style={{
                  width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px",
                  border: "1px solid var(--accent)", borderRadius: 5,
                  outline: "none", background: "var(--bg)", color: "var(--text)",
                  boxSizing: "border-box",
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, fontSize: 11, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={createIfMissing}
                  onChange={(e) => setCreateIfMissing(e.target.checked)}
                  style={{ width: 12, height: 12, cursor: "pointer" }}
                />
                目录不存在则自动创建
              </label>
              {createIfMissing && (
                <div style={{ marginTop: 4, fontSize: 11, color: "#16a34a", lineHeight: 1.35 }}>
                  将自动创建该目录后进入项目
                </div>
              )}
              {createError && (
                <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                  {createError}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <button
                  onClick={() => void handleCreate()}
                  disabled={creating || !name.trim() || !root.trim()}
                  style={{
                    flex: 1, padding: "4px 0",
                    background: "var(--accent)", border: "none", borderRadius: 5,
                    color: "#fff", fontSize: 11, fontWeight: 600,
                    cursor: creating || !name.trim() || !root.trim() ? "not-allowed" : "pointer",
                    opacity: creating || !name.trim() || !root.trim() ? 0.65 : 1,
                  }}
                >
                  {creating ? "创建中…" : "创建"}
                </button>
                <button
                  onClick={() => { setCreateOpen(false); setName(""); setRoot(""); setCreateIfMissing(false); setCreateError(null); }}
                  style={{
                    flex: 1, padding: "4px 0",
                    background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5,
                    color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
