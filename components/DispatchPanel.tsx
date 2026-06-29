"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentProfile } from "@/lib/domain/agent-profile-store";
import { getFileName, joinFilePath } from "@/lib/file-paths";
import { agentColor, agentInitial, splitModel, useAgentStore } from "@/lib/stores/useAgentStore";
import {
  selectIsActive,
  selectTaskForProject,
  useDispatchStore,
  type Assignment,
  type DispatchStatus,
} from "@/lib/stores/useDispatchStore";
import { toast } from "@/lib/stores/useToastStore";

interface Props {
  projectId: string;
  /** 项目根目录（绝对路径，= cwd）；用于把 assignment 产物的相对路径拼成绝对路径再交给 FileViewer。 */
  projectRoot: string | null;
  /** 点击 assignment 产物链接时回调（绝对路径 + 文件名），由 AppShell 在 FileViewer 打开。 */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** 点击「受管文档」产物时回调（artifactId），由 AppShell 按 id 打开右侧 ArtifactPanel（T5）。 */
  onOpenArtifact: (artifactId: string) => void;
  /** 派发产出过受管文档、到终态时回调一次：让 file panel 的「受管文档」分组重取出现新 .md（T5）。 */
  onArtifactsChanged?: () => void;
  /** 派发到终态（done/failed）时回调一次：刷新左栏「会话分组」（不被 artifact 门控，T2/第五轮）。 */
  onSessionsChanged?: () => void;
}

/** 轮询间隔（ms）；任务进行中每 2s 拉一次进度。 */
const POLL_INTERVAL = 2000;
/** 派发可选 agent 数量上限（§5.3：2–3 个；并发上限 ≤ 3）。 */
const MAX_AGENTS = 3;
const MIN_AGENTS = 2;

const STATUS_META: Record<DispatchStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "待执行", color: "var(--text-muted)", bg: "var(--bg-hover)" },
  running: { label: "执行中", color: "#2563eb", bg: "rgba(37,99,235,0.10)" },
  done: { label: "已完成", color: "#16a34a", bg: "rgba(22,163,74,0.10)" },
  failed: { label: "失败", color: "#dc2626", bg: "rgba(239,68,68,0.10)" },
};

/**
 * 发起多 Agent 派发的有状态主体（无 modal 壳）。原 DispatchPanel 的全部逻辑搬迁至此，
 * 供 PipelineModal「快速派发」tab 内嵌复用（T7：合并入口，旧独立 Dispatch 入口/壳已删）。
 * padding 由调用方容器提供，故 return 为不带外层 padding 的 Fragment。
 */
export function DispatchContent({
  projectId,
  projectRoot,
  onOpenFile,
  onOpenArtifact,
  onArtifactsChanged,
  onSessionsChanged,
}: Props) {
  // agent 列表复用 useAgentStore（项目下档案的权威来源）
  const { agents, agentsLoadedId, refreshAgents } = useAgentStore(
    useShallow((s) => ({
      agents: s.agents,
      agentsLoadedId: s.loadedProjectId,
      refreshAgents: s.refresh,
    })),
  );
  // loadedProjectId 不匹配时（切项目瞬间）视为空，避免串显（同 AgentManager）
  const visibleAgents = agentsLoadedId === projectId ? agents : [];

  const { task, taskLoadedId, dispatch, pollOnce, reset } = useDispatchStore(
    useShallow((s) => ({
      task: s.task,
      taskLoadedId: s.loadedProjectId,
      dispatch: s.dispatch,
      pollOnce: s.pollOnce,
      reset: s.reset,
    })),
  );
  const visibleTask = selectTaskForProject(task, taskLoadedId, projectId);

  // 发起表单状态：goal + 选中的 agentId 集合 + 每个 agent 的子任务文本
  const [goal, setGoal] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subTasks, setSubTasks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refreshAgents(projectId).catch(() => {});
  }, [projectId, refreshAgents]);

  // 轮询：任务进行中每 POLL_INTERVAL 拉一次；终态或卸载/关闭时停止（定时器放组件，便于清理）
  const pollRef = useRef(pollOnce);
  pollRef.current = pollOnce;
  useEffect(() => {
    if (!visibleTask || !selectIsActive(visibleTask)) return;
    const taskId = visibleTask.id;
    const timer = setInterval(() => {
      pollRef.current(projectId, taskId).catch(() => {});
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [projectId, visibleTask?.id, visibleTask?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // T5：派发到终态（done/failed）且本次产出过受管文档 → 通知一次 AppShell 刷新 file panel 受管分组。
  // 用 ref 记已通知过的 taskId，避免轮询多次落到终态时重复 bump（每个任务只触发一次）。
  const notifiedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visibleTask || selectIsActive(visibleTask)) return; // 仅终态
    if (notifiedTaskRef.current === visibleTask.id) return; // 已通知过
    const producedArtifact = visibleTask.assignments.some((a) => a.artifactId);
    if (!producedArtifact) return;
    notifiedTaskRef.current = visibleTask.id;
    onArtifactsChanged?.();
  }, [visibleTask?.id, visibleTask?.status, onArtifactsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  // T2（第五轮）：派发到终态（done/failed）即通知刷新「会话分组」。与上面 onArtifactsChanged
  // 不同——这里**不被 producedArtifact 门控**：coding/纯文本 worker（artifactId 恒空）跑完也要
  // 刷新左栏 agent 分组（否则各 agent 会话堆「其它会话」、M7·5.3 类 FAIL 复发）。独立 ref 按 taskId 去重。
  const notifiedSessionsTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visibleTask || selectIsActive(visibleTask)) return; // 仅终态
    if (notifiedSessionsTaskRef.current === visibleTask.id) return; // 已通知过
    notifiedSessionsTaskRef.current = visibleTask.id;
    onSessionsChanged?.();
  }, [visibleTask?.id, visibleTask?.status, onSessionsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAgent = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_AGENTS) return prev; // 上限内静默忽略（按钮也会禁用）
      return [...prev, id];
    });
  }, []);

  const handleDispatch = useCallback(async () => {
    if (submitting) return;
    const g = goal.trim();
    if (!g) {
      setError("请填写派发目标");
      return;
    }
    if (selectedIds.length < MIN_AGENTS) {
      setError(`请至少选择 ${MIN_AGENTS} 个 Agent`);
      return;
    }
    const assignments = selectedIds.map((agentId) => ({
      agentId,
      subTask: (subTasks[agentId] ?? "").trim(),
    }));
    if (assignments.some((a) => !a.subTask)) {
      setError("每个选中的 Agent 都需填写子任务");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await dispatch(projectId, g, assignments);
      toast.success("派发已发起");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // 失败兜底：error 在面板内，面板关掉就看不到，补一条 toast（保留局部态）。
      toast.error(`派发失败：${msg}`);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, goal, selectedIds, subTasks, dispatch, projectId]);

  // F15「重跑本次」：只清当前任务回到发起表单，保留已填 goal/选择，便于微调重发。
  const handleRestart = useCallback(() => {
    reset();
    setError(null);
  }, [reset]);

  // F15「新建空白派发」：清任务 + 清空本地表单 state（goal/选中/子任务），从头发起。
  const handleRestartBlank = useCallback(() => {
    reset();
    setGoal("");
    setSelectedIds([]);
    setSubTasks({});
    setError(null);
  }, [reset]);

  return (
    <>
      {visibleTask ? (
        <DispatchSummary
          goal={visibleTask.goal}
          status={visibleTask.status}
          assignments={visibleTask.assignments}
          agents={visibleAgents}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
          onOpenArtifact={onOpenArtifact}
          onRerun={handleRestart}
          onRestartBlank={handleRestartBlank}
        />
      ) : (
        <DispatchForm
          agents={visibleAgents}
          goal={goal}
          setGoal={setGoal}
          selectedIds={selectedIds}
          subTasks={subTasks}
          setSubTasks={setSubTasks}
          onToggleAgent={toggleAgent}
          error={error}
          submitting={submitting}
          onDispatch={handleDispatch}
        />
      )}
    </>
  );
}

/* ── 发起表单 ───────────────────────────────────────────────── */

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

function DispatchForm({
  agents,
  goal,
  setGoal,
  selectedIds,
  subTasks,
  setSubTasks,
  onToggleAgent,
  error,
  submitting,
  onDispatch,
}: {
  agents: AgentProfile[];
  goal: string;
  setGoal: (v: string) => void;
  selectedIds: string[];
  subTasks: Record<string, string>;
  setSubTasks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onToggleAgent: (id: string) => void;
  error: string | null;
  submitting: boolean;
  onDispatch: () => void;
}) {
  const canDispatch =
    !submitting && goal.trim() !== "" && selectedIds.length >= MIN_AGENTS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* goal（必填） */}
      <div>
        <label style={labelStyle}>
          派发目标 <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <textarea
          data-testid="dispatch-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="描述这次派发要达成的目标…"
          rows={2}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {/* 选 agent（2–3 个）+ 各写子任务 */}
      <div>
        <label style={labelStyle}>
          选择 Agent（{selectedIds.length}/{MAX_AGENTS}，至少 {MIN_AGENTS} 个）
        </label>
        {/* C7：解释「最多 3 个」来自全局并发上限（非子任务上限），并指出可在配置文件调整。 */}
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 8 }}>
          最多 3 个：受并发上限约束，可在 ~/.pi/factory-config.json 调整。
        </div>
        {/* F6：串行执行提示——选中顺序即执行顺序。 */}
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 8 }}>
          将按勾选顺序串行执行，上游产物自动喂给下游。
        </div>
        {/* F8：有 Agent 但未选时引导先勾选才能填子任务（与下方「暂无 Agent 档案」空态互斥）。 */}
        {agents.length > 0 && selectedIds.length === 0 && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 8 }}>
            勾选 Agent 后可填写各自的子任务。
          </div>
        )}
        {agents.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            当前项目暂无 Agent 档案，请先在「Agents」中创建。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map((p) => {
              const on = selectedIds.includes(p.id);
              const atLimit = !on && selectedIds.length >= MAX_AGENTS;
              const isCoding = (p.mode ?? "doc") === "coding";
              const modelId = p.model ? splitModel(p.model)?.modelId ?? p.model : null;
              return (
                <div
                  key={p.id}
                  data-testid="dispatch-agent-item"
                  data-agent-name={p.name}
                  data-selected={on}
                  className="glass-card"
                  style={{
                    borderRadius: 8,
                    borderColor: on ? "var(--accent)" : undefined,
                    background: on ? "var(--accent-soft)" : undefined,
                    overflow: "hidden",
                  }}
                >
                  <button
                    data-testid="dispatch-agent-toggle"
                    onClick={() => onToggleAgent(p.id)}
                    disabled={atLimit}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "9px 12px",
                      background: "none",
                      border: "none",
                      textAlign: "left",
                      cursor: atLimit ? "not-allowed" : "pointer",
                      opacity: atLimit ? 0.5 : 1,
                    }}
                  >
                    {/* F6：已选时显执行序号（= selectedIds 中的位次，绝非档案库序），用纯数字避豆腐块 */}
                    <span
                      aria-hidden
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: on ? "none" : "1px solid var(--border)",
                        background: on ? "var(--accent)" : "var(--bg)",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {on ? selectedIds.indexOf(p.id) + 1 : ""}
                    </span>
                    {/* 头像（复用 .agent-avatar，缩到 32，身份色 + 首字母，无环） */}
                    <span
                      className="agent-avatar"
                      style={{ width: 32, height: 32, fontSize: 13, background: agentColor(p.name) }}
                    >
                      {agentInitial(p.name)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {/* 名 + 模式徽章 */}
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
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
                        >
                          {isCoding ? "编码" : "文档"}
                        </span>
                      </span>
                      {/* 模型 · role（1 行 ellipsis） */}
                      {(modelId || p.role) && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "var(--text-dim)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: 2,
                          }}
                          title={[modelId, p.role].filter(Boolean).join(" · ")}
                        >
                          {modelId && (
                            <span style={{ fontFamily: "var(--font-mono)" }}>{modelId}</span>
                          )}
                          {modelId && p.role ? " · " : ""}
                          {p.role}
                        </span>
                      )}
                    </span>
                  </button>
                  {on && (
                    <div style={{ padding: "0 12px 10px 12px" }}>
                      <input
                        data-testid="dispatch-subtask"
                        data-agent-id={p.id}
                        value={subTasks[p.id] ?? ""}
                        onChange={(e) =>
                          setSubTasks((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder="给这个 Agent 的子任务…"
                        style={inputStyle}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          data-testid="dispatch-error"
          style={{ color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere" }}
        >
          {error}
        </div>
      )}

      <button
        data-testid="dispatch-submit"
        onClick={onDispatch}
        disabled={!canDispatch}
        style={{
          padding: "9px 0",
          background: "var(--accent)",
          border: "none",
          borderRadius: 7,
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: canDispatch ? "pointer" : "not-allowed",
          opacity: canDispatch ? 1 : 0.65,
        }}
      >
        {submitting ? "发起中…" : "发起派发"}
      </button>
    </div>
  );
}

/* ── 汇总视图 ───────────────────────────────────────────────── */

function DispatchSummary({
  goal,
  status,
  assignments,
  agents,
  projectRoot,
  onOpenFile,
  onOpenArtifact,
  onRerun,
  onRestartBlank,
}: {
  goal: string;
  status: DispatchStatus;
  assignments: Assignment[];
  agents: AgentProfile[];
  projectRoot: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
  onOpenArtifact: (artifactId: string) => void;
  onRerun: () => void;
  onRestartBlank: () => void;
}) {
  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  // output 是相对 projectRoot 的路径；FileViewer 经 /api/files 以绝对路径读，故拼成绝对路径再打开。
  const openOutput = (output: string) => {
    const abs = projectRoot ? joinFilePath(projectRoot, output) : output;
    onOpenFile(abs, getFileName(abs));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 目标 + 总状态 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={labelStyle}>派发目标</span>
          <StatusBadge status={status} testid="dispatch-overall-status" />
        </div>
        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{goal}</div>
      </div>

      {/* assignment 列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {assignments.map((a, i) => (
          <div
            key={`${a.agentId}-${i}`}
            data-testid="dispatch-assignment"
            data-status={a.status}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-hover)",
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {nameOf(a.agentId)}
              </span>
              <StatusBadge status={a.status} />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {a.subTask}
            </div>
            {/* T5：有受管文档(artifactId)则只露这一个入口、按 id 打开右侧 ArtifactPanel；
                否则退回回执文件链接（coding/纯文本 worker，经 FileViewer 打开 .pi/artifacts/*.md）。
                output 在有 artifactId 时仅作内部保底、不再额外渲染。 */}
            {(() => {
              const isArtifact = !!a.artifactId;
              if (!isArtifact && !a.output) return null;
              return (
                <div style={{ marginTop: 8 }}>
                  <button
                    data-testid="dispatch-output-link"
                    data-output={a.output ?? ""}
                    data-artifact-id={a.artifactId ?? ""}
                    onClick={() => (isArtifact ? onOpenArtifact(a.artifactId!) : openOutput(a.output!))}
                    title={isArtifact ? "打开受管文档" : `打开产物：${a.output}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      maxWidth: "100%",
                      padding: "4px 10px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--accent)",
                      fontSize: 11,
                      fontFamily: isArtifact ? "inherit" : "var(--font-mono)",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isArtifact ? "受管文档" : a.output}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        ))}
      </div>

      {/* F15：拆两按钮——「重跑本次」保留预填、「新建空白派发」清空表单从头来。 */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid="dispatch-restart"
          onClick={onRerun}
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
          重跑本次
        </button>
        <button
          data-testid="dispatch-restart-blank"
          onClick={onRestartBlank}
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
          新建空白派发
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status, testid }: { status: DispatchStatus; testid?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      data-testid={testid}
      data-status={status}
      style={{
        flexShrink: 0,
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        color: meta.color,
        background: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}
