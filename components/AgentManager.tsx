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
import { toast } from "@/lib/stores/useToastStore";

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
  mode: "doc" | "coding";
};

const EMPTY_FORM: FormState = {
  name: "",
  role: "",
  model: "",
  skills: [],
  tools: [],
  thinkingLevel: "off",
  mode: "doc",
};

function fromProfile(p: AgentProfile): FormState {
  return {
    name: p.name,
    role: p.role,
    model: p.model,
    skills: p.skills,
    tools: p.tools,
    thinkingLevel: p.thinkingLevel,
    mode: p.mode ?? "doc",
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
  const visibleAgents = useMemo(
    () => (loadedProjectId === projectId ? agents : []),
    [loadedProjectId, projectId, agents],
  );

  // 选项源
  const [models, setModels] = useState<ModelOption[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);

  // 视图：列表（默认） | 新建表单（create）| 某档案的二级菜单（menu）。三者互斥。
  type View = { kind: "list" } | { kind: "create" } | { kind: "menu"; id: string };
  const [view, setView] = useState<View>({ kind: "list" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 二级菜单内：待确认删除标记；起会话开场白 / 提交中 / 错误
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [startMessage, setStartMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // 当前二级菜单对应的档案（视图为 menu 时）
  const menuAgent = useMemo(
    () => (view.kind === "menu" ? visibleAgents.find((a) => a.id === view.id) ?? null : null),
    [view, visibleAgents],
  );

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
    setForm(EMPTY_FORM);
    setFormError(null);
    setView({ kind: "create" });
  }, []);

  // 点卡片 → 打开该档案的二级菜单（载入其配置，复位起会话/删除局部态）
  const openMenu = useCallback((p: AgentProfile) => {
    setForm(fromProfile(p));
    setFormError(null);
    setConfirmDelete(false);
    setStartMessage("");
    setStartError(null);
    setView({ kind: "menu", id: p.id });
  }, []);

  const backToList = useCallback(() => {
    setView({ kind: "list" });
    setFormError(null);
    setConfirmDelete(false);
    setStartMessage("");
    setStartError(null);
  }, []);

  // 新建保存：name 必填 → create → 回列表
  const handleCreate = useCallback(async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      setFormError("name 不能为空");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await create(projectId, {
        name,
        role: form.role,
        model: form.model,
        skills: form.skills,
        tools: form.tools,
        thinkingLevel: form.thinkingLevel,
        mode: form.mode,
      });
      backToList();
      toast.success(`已创建 Agent「${name}」`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, form, create, projectId, backToList]);

  // 二级菜单保存配置：name 必填 → update（停留在菜单，给保存反馈）
  const handleUpdate = useCallback(async () => {
    if (saving || view.kind !== "menu") return;
    const name = form.name.trim();
    if (!name) {
      setFormError("name 不能为空");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await update(projectId, view.id, {
        name,
        role: form.role,
        model: form.model,
        skills: form.skills,
        tools: form.tools,
        thinkingLevel: form.thinkingLevel,
        mode: form.mode,
      });
      backToList();
      toast.success(`已保存「${name}」配置`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, view, form, update, projectId, backToList]);

  // 二级菜单删除（二次确认后）：remove → 回列表
  const handleRemove = useCallback(async () => {
    if (view.kind !== "menu") return;
    const id = view.id;
    const agentName = form.name.trim() || "Agent";
    setConfirmDelete(false);
    try {
      await remove(projectId, id);
      toast.success(`已删除 Agent「${agentName}」`);
    } catch (e) {
      // 删除原本吞错（后端 404 已被 store 视为成功）：真失败补 toast 兜底。
      toast.error(`删除 Agent 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    backToList();
  }, [view, form.name, remove, projectId, backToList]);

  // 二级菜单起会话：提交开场白 → startSession → 交给 AppShell 切换会话（关闭管理器）
  const handleStart = useCallback(async () => {
    if (view.kind !== "menu") return;
    const message = startMessage.trim();
    if (!message || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { sessionId } = await startSession(projectId, view.id, message);
      onSessionStarted(sessionId, projectRoot ?? "");
      toast.success(`已为「${form.name.trim() || "Agent"}」起会话`);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [view, startMessage, starting, startSession, projectId, onSessionStarted, projectRoot, form.name]);

  // model 单 string → 下拉选中值（拼回 provider/modelId）
  const selectedModelValue = useMemo(() => {
    const parsed = splitModel(form.model);
    return parsed ? joinModel(parsed.provider, parsed.modelId) : "";
  }, [form.model]);

  // 二级菜单视图但档案已不存在（被删/切项目）→ 回退列表，避免空菜单
  const showMenu = view.kind === "menu" && menuAgent !== null;
  const wide = view.kind === "list";

  const headerTitle =
    view.kind === "create"
      ? "新建 Agent"
      : view.kind === "menu" && menuAgent
        ? menuAgent.name
        : "Agent 管理";

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
          // 表单/二级菜单单列窄，卡片网格需更宽
          width: wide ? "min(820px, 94vw)" : "min(560px, 92vw)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {view.kind !== "list" && (
              <button
                data-testid="agent-back-btn"
                onClick={backToList}
                title="返回列表"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: "2px 4px",
                }}
              >
                ‹
              </button>
            )}
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {headerTitle}
            </div>
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
          {view.kind === "create" ? (
            <CreateForm
              form={form}
              setForm={setForm}
              models={models}
              skills={skills}
              skillsDisabled={!projectRoot}
              selectedModelValue={selectedModelValue}
              error={formError}
              saving={saving}
              onSave={handleCreate}
              onCancel={backToList}
            />
          ) : showMenu && menuAgent ? (
            <AgentMenu
              agent={menuAgent}
              form={form}
              setForm={setForm}
              models={models}
              skills={skills}
              skillsDisabled={!projectRoot}
              selectedModelValue={selectedModelValue}
              error={formError}
              saving={saving}
              onSave={handleUpdate}
              confirmDelete={confirmDelete}
              onAskDelete={() => setConfirmDelete(true)}
              onCancelDelete={() => setConfirmDelete(false)}
              onConfirmDelete={handleRemove}
              startMessage={startMessage}
              starting={starting}
              startError={startError}
              onChangeStartMessage={setStartMessage}
              onStart={handleStart}
            />
          ) : (
            <AgentList agents={visibleAgents} onCreate={openCreate} onOpenMenu={openMenu} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 列表区（一级菜单：正方形玻璃卡片网格，点卡进二级菜单） ─────────────── */

function AgentList({
  agents,
  onCreate,
  onOpenMenu,
}: {
  agents: AgentProfile[];
  onCreate: () => void;
  onOpenMenu: (p: AgentProfile) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))",
        gap: 12,
      }}
    >
      {/* 空状态零引导：无 Agent 时给一句「这是什么 + 下一步」 */}
      {agents.length === 0 && (
        <div style={{ gridColumn: "1 / -1", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, padding: "4px 2px" }}>
          还没有 Agent。Agent 是可自定义的协作角色（设定模型 / 技能 / 角色），点下方「新建 Agent」创建第一个。
        </div>
      )}
      {/* 新建入口：带「+」的空卡片 */}
      <button
        data-testid="agent-new-btn"
        onClick={onCreate}
        className="glass-card agent-card"
        style={{
          minHeight: 132,
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
        <AgentCard key={p.id} p={p} onOpen={onOpenMenu} />
      ))}
    </div>
  );
}

/* ── 单张玻璃名片（三段式 6 字段：身份行 + role 摘要 + meta 页脚，整卡可点进二级菜单） ── */

const THINKING_SHORT: Record<"low" | "medium" | "high", string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function AgentCard({ p, onOpen }: { p: AgentProfile; onOpen: (p: AgentProfile) => void }) {
  const mode = p.mode ?? "doc";
  const isCoding = mode === "coding";
  const roleText = p.role?.trim();
  const showSkills = p.skills.length > 0;
  const showTools = isCoding && p.tools.length > 0;
  const showThinking = p.thinkingLevel != null && p.thinkingLevel !== "off";
  const showMeta = showSkills || showTools || showThinking;

  return (
    <button
      data-testid="agent-item"
      data-agent-name={p.name}
      onClick={() => onOpen(p)}
      title={`配置 ${p.name}`}
      className="glass-card agent-card"
      style={{
        minHeight: 132,
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        overflow: "hidden",
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
      }}
    >
      {/* 身份行：头像 + 名/模式徽章 + 模型 */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0, width: "100%" }}>
        <div
          className="agent-avatar"
          style={{ width: 40, height: 40, fontSize: 18, background: agentColor(p.name) }}
        >
          {agentInitial(p.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* 名行：真名 + 模式文字徽章 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                flex: 1,
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
            </span>
            <span
              className={`agent-badge ${isCoding ? "agent-badge--coding" : "agent-badge--doc"}`}
              data-testid="agent-card-mode"
              data-mode={mode}
            >
              {isCoding ? "编码" : "文档"}
            </span>
          </div>
          {/* 模型行 */}
          {p.model ? (
            <span
              className="agent-badge--mono"
              style={{
                fontSize: 10,
                color: "var(--text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={p.model}
            >
              {splitModel(p.model)?.modelId ?? p.model}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>默认模型</span>
          )}
        </div>
      </div>

      {/* role 摘要（两行 line-clamp，空则整段不渲染） */}
      {roleText && (
        <p
          style={{
            margin: 0,
            fontSize: 11.5,
            lineHeight: 1.5,
            color: "var(--text-muted)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {p.role}
        </p>
      )}

      {/* meta 页脚（技能 / 工具 / 思考计数；全空则不渲染） */}
      {showMeta && (
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
          }}
        >
          {showSkills && (
            <span className="agent-badge agent-badge--meta" data-testid="agent-card-skills">
              {p.skills.length} 技能
            </span>
          )}
          {showTools && (
            <span
              className="agent-badge agent-badge--meta agent-badge--mono"
              data-testid="agent-card-tools"
            >
              {p.tools.length} 工具
            </span>
          )}
          {showThinking && (
            <span className="agent-badge agent-badge--meta" data-testid="agent-card-thinking">
              {THINKING_SHORT[p.thinkingLevel as "low" | "medium" | "high"]} 思考
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/* ── 二级菜单（配置现场改并保存 + 起会话 + 删除，覆盖独立编辑按钮与卡片覆盖层） ── */

function AgentMenu({
  agent,
  form,
  setForm,
  models,
  skills,
  skillsDisabled,
  selectedModelValue,
  error,
  saving,
  onSave,
  confirmDelete,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  startMessage,
  starting,
  startError,
  onChangeStartMessage,
  onStart,
}: {
  agent: AgentProfile;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  models: ModelOption[];
  skills: SkillOption[];
  skillsDisabled: boolean;
  selectedModelValue: string;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  confirmDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  startMessage: string;
  starting: boolean;
  startError: string | null;
  onChangeStartMessage: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <div data-testid="agent-menu" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 起会话区（行内开场白 → startSession，禁用 window.prompt D-B4-3） */}
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>起会话</div>
        <textarea
          data-testid="agent-start-input"
          value={startMessage}
          onChange={(e) => onChangeStartMessage(e.target.value)}
          onKeyDown={(e) => {
            // Enter 提交、Shift+Enter 换行（与对话框输入习惯一致）
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onStart();
            }
          }}
          placeholder={`用 ${agent.name} 起会话的第一条消息…`}
          rows={2}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
        {startError && (
          <div
            data-testid="agent-start-error"
            style={{ color: "#dc2626", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}
          >
            {startError}
          </div>
        )}
        <button
          data-testid="agent-start-submit"
          onClick={onStart}
          disabled={starting || !startMessage.trim()}
          style={{
            alignSelf: "flex-start",
            padding: "6px 16px",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: starting || !startMessage.trim() ? "not-allowed" : "pointer",
            opacity: starting || !startMessage.trim() ? 0.65 : 1,
          }}
        >
          {starting ? "起会话中…" : "起会话"}
        </button>
      </section>

      {/* 配置区（现场改并保存 → update） */}
      <section style={sectionStyle}>
        <div style={sectionTitleStyle}>配置</div>
        <AgentFields
          form={form}
          setForm={setForm}
          models={models}
          skills={skills}
          skillsDisabled={skillsDisabled}
          selectedModelValue={selectedModelValue}
        />
        {error && (
          <div
            data-testid="agent-form-error"
            style={{ color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}
          >
            {error}
          </div>
        )}
        <button
          data-testid="agent-save-btn"
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          style={{
            alignSelf: "flex-start",
            padding: "8px 20px",
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
          {saving ? "保存中…" : "保存配置"}
        </button>
      </section>

      {/* 删除区（二次确认显真名，覆盖 M1） */}
      <section style={{ ...sectionStyle, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        {confirmDelete ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
              删除 <span style={{ fontWeight: 600 }}>{agent.name}</span>？
              <span style={{ color: "var(--text-dim)" }}>
                {" "}
                将删除其档案目录（含 agent.md / memory.md），不可恢复。
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                data-testid="agent-delete-confirm"
                onClick={onConfirmDelete}
                style={{
                  padding: "6px 16px",
                  background: "#ef4444",
                  border: "none",
                  borderRadius: 6,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                确认删除
              </button>
              <button
                onClick={onCancelDelete}
                style={{
                  padding: "6px 16px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <button
            data-testid="agent-delete-btn"
            onClick={onAskDelete}
            title="删除 Agent"
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 6,
              fontSize: 12,
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
            删除 Agent
          </button>
        )}
      </section>
    </div>
  );
}

/* ── 新建表单（名称/角色必填 + 配置；保存走 create） ───────────────── */

function CreateForm({
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <AgentFields
        form={form}
        setForm={setForm}
        models={models}
        skills={skills}
        skillsDisabled={skillsDisabled}
        selectedModelValue={selectedModelValue}
      />

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

/* ── 共用字段（名称/角色/模型/技能/工具/思考强度，新建与二级菜单复用） ───── */

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text)",
};

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

function AgentFields({
  form,
  setForm,
  models,
  skills,
  skillsDisabled,
  selectedModelValue,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  models: ModelOption[];
  skills: SkillOption[];
  skillsDisabled: boolean;
  selectedModelValue: string;
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

      {/* mode（文档型 / 编码型，方案A）：决定起会话工具集 */}
      <div>
        <label style={labelStyle}>模式</label>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              { value: "doc", label: "文档型" },
              { value: "coding", label: "编码型" },
            ] as const
          ).map((opt) => {
            const on = form.mode === opt.value;
            return (
              <button
                key={opt.value}
                data-testid="agent-form-mode"
                data-mode={opt.value}
                data-selected={on}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    mode: opt.value,
                    // 切到编码型且未勾任何工具时默认全选内置编码工具（让用户看得见、避免零工具 D-MODE-05）
                    tools:
                      opt.value === "coding" && f.tools.length === 0
                        ? [...CODING_TOOL_NAMES]
                        : f.tools,
                  }))
                }
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
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            marginTop: 4,
            color: form.mode === "coding" ? "#dc2626" : "var(--text-dim)",
          }}
        >
          {form.mode === "coding"
            ? "编码型：使用下方勾选的内置工具（含 bash/write/edit），可直接读写磁盘、执行命令，不经提议确认。"
            : "文档型：使用受限工具集（read/grep/find/ls + 提议工具），改受管文档须经按块确认；不支持 bash/write/edit。"}
        </div>
      </div>

      {/* tools（内置编码工具固定集勾选）——仅 coding 模式生效；doc 模式置灰防呆 */}
      <div>
        <label style={labelStyle}>
          工具（内置编码工具）
          {form.mode === "doc" && (
            <span style={{ fontWeight: 400, color: "var(--text-dim)" }}> · 文档型不使用</span>
          )}
        </label>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            opacity: form.mode === "doc" ? 0.45 : 1,
          }}
        >
          {CODING_TOOL_NAMES.map((t) => {
            const on = form.tools.includes(t);
            const disabled = form.mode === "doc";
            return (
              <button
                key={t}
                data-testid="agent-form-tool"
                data-tool-name={t}
                data-selected={on}
                data-disabled={disabled}
                disabled={disabled}
                onClick={() => setForm((f) => ({ ...f, tools: toggleTool(f.tools, t) }))}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: on ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: on ? "rgba(37,99,235,0.10)" : "var(--bg)",
                  color: on ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  cursor: disabled ? "not-allowed" : "pointer",
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
    </div>
  );
}
