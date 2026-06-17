"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentProfile } from "@/lib/domain/agent-profile-store";
import {
  agentColor,
  agentInitial,
  CODING_TOOL_NAMES,
  joinModel,
  splitModel,
  toggleTool,
  useAgentStore,
} from "@/lib/stores/useAgentStore";

interface Props {
  projectId: string;
  /** 项目根目录（= cwd），用于拉技能列表；无则技能多选禁用。 */
  projectRoot: string | null;
  onClose: () => void;
  /** B4：用某档案起会话成功后回调（sessionId + cwd），由 AppShell 接管会话切换/SSE。 */
  onSessionStarted: (sessionId: string, cwd: string) => void;
}

type ModelOption = { id: string; name: string; provider: string };
type SkillOption = { name: string; description?: string };

const THINKING_OPTIONS: { value: "off" | "low" | "medium" | "high"; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/** 表单可编辑字段（与 AgentProfileInput 对齐；model 以 provider/modelId 单 string 存）。 */
type FormState = {
  name: string;
  role: string;
  model: string;
  skills: string[];
  tools: string[];
  thinkingLevel: "off" | "low" | "medium" | "high";
};

const EMPTY_FORM: FormState = {
  name: "",
  role: "",
  model: "",
  skills: [],
  tools: [],
  thinkingLevel: "off",
};

function fromProfile(p: AgentProfile): FormState {
  return {
    name: p.name,
    role: p.role,
    model: p.model,
    skills: p.skills,
    tools: p.tools,
    thinkingLevel: p.thinkingLevel,
  };
}

export function AgentManager({ projectId, projectRoot, onClose, onSessionStarted }: Props) {
  const { agents, loadedProjectId, refresh, create, update, remove, startSession } = useAgentStore(
    useShallow((s) => ({
      agents: s.agents,
      loadedProjectId: s.loadedProjectId,
      refresh: s.refresh,
      create: s.create,
      update: s.update,
      remove: s.remove,
      startSession: s.startSession,
    })),
  );
  // loadedProjectId 不匹配时（切项目瞬间）视为空，避免串显
  const visibleAgents = loadedProjectId === projectId ? agents : [];

  // 选项源
  const [models, setModels] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);

  // 视图：列表 | 编辑表单（editingId=null 为新建）
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 待确认删除的档案 id（内联确认条）
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // B4：正在「用此档案起会话」的 id（展开行内首条 message 输入条）；提交中的 id；错误文本
  const [startId, setStartId] = useState<string | null>(null);
  const [startMessage, setStartMessage] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    refresh(projectId).catch(() => {});
  }, [projectId, refresh]);

  // 模型列表
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { modelList?: ModelOption[] }) => setModels(d.modelList ?? []))
      .catch(() => {});
  }, []);

  // 技能列表（依赖 projectRoot；无则不拉、多选禁用）
  useEffect(() => {
    if (!projectRoot) {
      setSkills([]);
      return;
    }
    fetch(`/api/skills?cwd=${encodeURIComponent(projectRoot)}`)
      .then((r) => r.json())
      .then((d: { skills?: SkillOption[] }) => setSkills(d.skills ?? []))
      .catch(() => {});
  }, [projectRoot]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing(true);
  }, []);

  const openEdit = useCallback((p: AgentProfile) => {
    setEditingId(p.id);
    setForm(fromProfile(p));
    setFormError(null);
    setEditing(true);
  }, []);

  const closeForm = useCallback(() => {
    setEditing(false);
    setEditingId(null);
    setFormError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError("name 不能为空");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      name,
      role: form.role,
      model: form.model,
      skills: form.skills,
      tools: form.tools,
      thinkingLevel: form.thinkingLevel,
    };
    try {
      if (editingId === null) await create(projectId, payload);
      else await update(projectId, editingId, payload);
      closeForm();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, form, editingId, create, update, projectId, closeForm]);

  const handleRemoveConfirm = useCallback(
    async (id: string) => {
      setConfirmId(null);
      try {
        await remove(projectId, id);
      } catch {
        // 删除失败保持原状（后端 404 已被 store 视为成功）
      }
    },
    [remove, projectId],
  );

  // B4：展开某档案的「起会话」输入条（同时关掉删除确认，避免两条并存）
  const openStart = useCallback((id: string) => {
    setConfirmId(null);
    setStartError(null);
    setStartMessage("");
    setStartId(id);
  }, []);

  const cancelStart = useCallback(() => {
    setStartId(null);
    setStartError(null);
    setStartMessage("");
  }, []);

  // B4：提交首条 message → 调端点起会话 → 成功后交给 AppShell 切换会话（关闭整个管理器）
  const handleStartSubmit = useCallback(
    async (id: string) => {
      const message = startMessage.trim();
      if (!message || startingId) return;
      setStartingId(id);
      setStartError(null);
      try {
        const { sessionId } = await startSession(projectId, id, message);
        onSessionStarted(sessionId, projectRoot ?? "");
      } catch (e) {
        setStartError(e instanceof Error ? e.message : String(e));
      } finally {
        setStartingId(null);
      }
    },
    [startMessage, startingId, startSession, projectId, onSessionStarted, projectRoot],
  );

  // model 单 string → 下拉选中值（拼回 provider/modelId）
  const selectedModelValue = useMemo(() => {
    const parsed = splitModel(form.model);
    return parsed ? joinModel(parsed.provider, parsed.modelId) : "";
  }, [form.model]);

  return (
    <div
      data-testid="agent-manager"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          // 编辑表单单列窄，卡片网格需更宽
          width: editing ? "min(560px, 92vw)" : "min(820px, 94vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            {editing ? (editingId === null ? "新建 Agent" : "编辑 Agent") : "Agent 管理"}
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* 主体 */}
        <div style={{ padding: 16, overflowY: "auto" }}>
          {editing ? (
            <AgentForm
              form={form}
              setForm={setForm}
              models={models}
              skills={skills}
              skillsDisabled={!projectRoot}
              selectedModelValue={selectedModelValue}
              error={formError}
              saving={saving}
              onSave={handleSave}
              onCancel={closeForm}
            />
          ) : (
            <AgentList
              agents={visibleAgents}
              confirmId={confirmId}
              startId={startId}
              startMessage={startMessage}
              startingId={startingId}
              startError={startError}
              onCreate={openCreate}
              onEdit={openEdit}
              onAskDelete={setConfirmId}
              onCancelDelete={() => setConfirmId(null)}
              onConfirmDelete={handleRemoveConfirm}
              onAskStart={openStart}
              onCancelStart={cancelStart}
              onChangeStartMessage={setStartMessage}
              onSubmitStart={handleStartSubmit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 列表区 ───────────────────────────────────────────────── */

function AgentList({
  agents,
  confirmId,
  startId,
  startMessage,
  startingId,
  startError,
  onCreate,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onAskStart,
  onCancelStart,
  onChangeStartMessage,
  onSubmitStart,
}: {
  agents: AgentProfile[];
  confirmId: string | null;
  startId: string | null;
  startMessage: string;
  startingId: string | null;
  startError: string | null;
  onCreate: () => void;
  onEdit: (p: AgentProfile) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
  onAskStart: (id: string) => void;
  onCancelStart: () => void;
  onChangeStartMessage: (v: string) => void;
  onSubmitStart: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 12,
      }}
    >
      {/* 新建入口：带「+」的空卡片 */}
      <button
        data-testid="agent-new-btn"
        onClick={onCreate}
        className="glass-card"
        style={{
          aspectRatio: "1",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: 12,
          borderStyle: "dashed",
          color: "var(--text-muted)",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <line x1="5" y1="1" x2="5" y2="9" />
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600 }}>新建 Agent</span>
      </button>

      {agents.map((p) => (
        <AgentCard
          key={p.id}
          p={p}
          confirming={confirmId === p.id}
          starting={startId === p.id}
          startMessage={startMessage}
          startSubmitting={startingId === p.id}
          startError={startId === p.id ? startError : null}
          onEdit={onEdit}
          onAskDelete={onAskDelete}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          onAskStart={onAskStart}
          onCancelStart={onCancelStart}
          onChangeStartMessage={onChangeStartMessage}
          onSubmitStart={onSubmitStart}
        />
      ))}
    </div>
  );
}

/* ── 单张正方形玻璃卡片（一级菜单：真名 + 首字母色块 + 操作） ─────────── */

function AgentCard({
  p,
  confirming,
  starting,
  startMessage,
  startSubmitting,
  startError,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onAskStart,
  onCancelStart,
  onChangeStartMessage,
  onSubmitStart,
}: {
  p: AgentProfile;
  confirming: boolean;
  starting: boolean;
  startMessage: string;
  startSubmitting: boolean;
  startError: string | null;
  onEdit: (p: AgentProfile) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
  onAskStart: (id: string) => void;
  onCancelStart: () => void;
  onChangeStartMessage: (v: string) => void;
  onSubmitStart: (id: string) => void;
}) {
  return (
    <div
      data-testid="agent-item"
      data-agent-name={p.name}
      className="glass-card"
      style={{
        position: "relative",
        aspectRatio: "1",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 首字母色块 + 真名（一级展示，始终在底层） */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: agentColor(p.name),
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {agentInitial(p.name)}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={p.name}
      >
        {p.name}
      </div>

      {/* 操作按钮区（卡片底部，常规态显示；确认/起会话态被覆盖层遮住） */}
      <div style={{ marginTop: "auto", display: "flex", gap: 6 }}>
        <button
          data-testid="agent-start-btn"
          onClick={() => onAskStart(p.id)}
          title="用此档案起会话"
          style={{
            flex: 1,
            padding: "5px 0",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          起会话
        </button>
        <button
          data-testid="agent-edit-btn"
          onClick={() => onEdit(p)}
          title="编辑"
          style={{
            padding: "5px 9px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          编辑
        </button>
        <button
          data-testid="agent-delete-btn"
          onClick={() => onAskDelete(p.id)}
          title="删除 Agent"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            padding: 0,
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-dim)",
            cursor: "pointer",
            borderRadius: 6,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>

      {/* 起会话覆盖层（B4：内联收首条 message，禁用 window.prompt D-B4-3） */}
      {starting && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.4, marginBottom: 6 }}>
            用 <span style={{ fontWeight: 600 }}>{p.name}</span> 起会话：
          </div>
          <textarea
            data-testid="agent-start-input"
            autoFocus
            value={startMessage}
            onChange={(e) => onChangeStartMessage(e.target.value)}
            onKeyDown={(e) => {
              // Enter 提交、Shift+Enter 换行（与对话框输入习惯一致）
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmitStart(p.id);
              }
            }}
            placeholder="第一条消息…"
            rows={3}
            style={{
              ...inputStyle,
              flex: 1,
              resize: "none",
              fontFamily: "inherit",
              marginBottom: 6,
            }}
          />
          {startError && (
            <div
              data-testid="agent-start-error"
              style={{ color: "#dc2626", fontSize: 10, lineHeight: 1.4, marginBottom: 6, overflowWrap: "anywhere" }}
            >
              {startError}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              data-testid="agent-start-submit"
              onClick={() => onSubmitStart(p.id)}
              disabled={startSubmitting || !startMessage.trim()}
              style={{
                flex: 1,
                padding: "5px 0",
                background: "var(--accent)",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                cursor: startSubmitting || !startMessage.trim() ? "not-allowed" : "pointer",
                opacity: startSubmitting || !startMessage.trim() ? 0.65 : 1,
              }}
            >
              {startSubmitting ? "起会话中…" : "起会话"}
            </button>
            <button
              onClick={onCancelStart}
              style={{
                flex: 1,
                padding: "5px 0",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 删除确认覆盖层（M1：显真名，无 UUID 路径） */}
      {confirming && (
        <div style={overlayStyle}>
          <div style={{ flex: 1, fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>
            删除 <span style={{ fontWeight: 600 }}>{p.name}</span>？
            <span style={{ color: "var(--text-dim)" }}>
              {" "}
              将删除其档案目录（含 agent.md / memory.md），不可恢复。
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              data-testid="agent-delete-confirm"
              onClick={() => onConfirmDelete(p.id)}
              style={{
                flex: 1,
                padding: "5px 0",
                background: "#ef4444",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              确认删除
            </button>
            <button
              onClick={onCancelDelete}
              style={{
                flex: 1,
                padding: "5px 0",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 卡片内覆盖层（起会话 / 删除确认）：盖住整张卡片，承载二次交互。 */
const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg)",
  borderRadius: 12,
};

/* ── 表单区 ───────────────────────────────────────────────── */

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "7px 9px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: "none",
  background: "var(--bg)",
  color: "var(--text)",
  boxSizing: "border-box",
};

function AgentForm({
  form,
  setForm,
  models,
  skills,
  skillsDisabled,
  selectedModelValue,
  error,
  saving,
  onSave,
  onCancel,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  models: ModelOption[];
  skills: SkillOption[];
  skillsDisabled: boolean;
  selectedModelValue: string;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const toggleSkill = (name: string) => {
    setForm((f) => {
      const set = new Set(f.skills);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return { ...f, skills: [...set] };
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* name（必填） */}
      <div>
        <label style={labelStyle}>
          名称 <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          data-testid="agent-form-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="例如：方案设计员"
          style={inputStyle}
        />
      </div>

      {/* role（多行） */}
      <div>
        <label style={labelStyle}>角色描述</label>
        <textarea
          data-testid="agent-form-role"
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          placeholder="这个 Agent 的职责与风格…"
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {/* model（下拉，允许留空） */}
      <div>
        <label style={labelStyle}>模型</label>
        <select
          data-testid="agent-form-model"
          value={selectedModelValue}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          <option value="">（默认模型）</option>
          {models.map((m) => {
            const value = `${m.provider}/${m.id}`;
            return (
              <option key={value} value={value}>
                {m.name} · {m.provider}
              </option>
            );
          })}
        </select>
      </div>

      {/* skills（多选） */}
      <div>
        <label style={labelStyle}>技能</label>
        {skillsDisabled ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            当前项目无可用根目录，无法加载技能列表。
          </div>
        ) : skills.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>该项目暂无可选技能。</div>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              maxHeight: 140,
              overflowY: "auto",
            }}
          >
            {skills.map((s) => {
              const on = form.skills.includes(s.name);
              return (
                <button
                  key={s.name}
                  data-testid="agent-form-skill"
                  data-skill-name={s.name}
                  data-selected={on}
                  onClick={() => toggleSkill(s.name)}
                  title={s.description}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 14,
                    border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: on ? "rgba(37,99,235,0.10)" : "var(--bg)",
                    color: on ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* tools（内置编码工具固定集勾选） */}
      <div>
        <label style={labelStyle}>工具（内置编码工具）</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {CODING_TOOL_NAMES.map((t) => {
            const on = form.tools.includes(t);
            return (
              <button
                key={t}
                data-testid="agent-form-tool"
                data-tool-name={t}
                data-selected={on}
                onClick={() => setForm((f) => ({ ...f, tools: toggleTool(f.tools, t) }))}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: on ? "rgba(37,99,235,0.10)" : "var(--bg)",
                  color: on ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* thinkingLevel（单选） */}
      <div>
        <label style={labelStyle}>思考强度</label>
        <div style={{ display: "flex", gap: 6 }}>
          {THINKING_OPTIONS.map((opt) => {
            const on = form.thinkingLevel === opt.value;
            return (
              <button
                key={opt.value}
                data-testid="agent-form-thinking"
                data-thinking={opt.value}
                data-selected={on}
                onClick={() => setForm((f) => ({ ...f, thinkingLevel: opt.value }))}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 6,
                  border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: on ? "rgba(37,99,235,0.10)" : "var(--bg)",
                  color: on ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 错误（含后端 422） */}
      {error && (
        <div
          data-testid="agent-form-error"
          style={{ color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}
        >
          {error}
        </div>
      )}

      {/* 操作 */}
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <button
          data-testid="agent-save-btn"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          style={{
            flex: 1,
            padding: "8px 0",
            background: "var(--accent)",
            border: "none",
            borderRadius: 7,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: saving || !form.name.trim() ? "not-allowed" : "pointer",
            opacity: saving || !form.name.trim() ? 0.65 : 1,
          }}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "8px 0",
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
