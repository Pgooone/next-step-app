"use client";

import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";
import { useAgentStore, selectAgentsForProject } from "@/lib/stores/useAgentStore";
import type { PipelineBlueprint } from "@/lib/domain/pipeline-store"; // 仅类型

type StageDraft = { order: number; agentId: string; subTaskTemplate: string };

/** 删/增/移后把 order 重排为 1..N 连续（后端要求 order 须 1..N 连续唯一）。 */
function renumber(stages: StageDraft[]): StageDraft[] {
  return stages.map((s, i) => ({ ...s, order: i + 1 }));
}

/**
 * 蓝图编辑器（§3.10）：手填 N 阶段（选 agent + 多行 subTaskTemplate + 上/下移排序 + 增删）+ 保存 POST/PUT。
 * 校验权威在后端 store，前端只做必填即时反馈。
 */
export default function PipelineEditor({
  projectId,
  pipelineId,
  onSaved,
  onCancel,
}: {
  projectId: string;
  pipelineId?: string;
  onSaved: (blueprint?: PipelineBlueprint) => void;
  onCancel: () => void;
}) {
  // agent 列表：复用 selectAgentsForProject（自带 loadedProjectId!==projectId → [] 守卫）。
  const agents = useAgentStore(useShallow((s) => selectAgentsForProject(s, projectId)));
  const refreshAgents = useAgentStore((s) => s.refresh);
  useEffect(() => {
    refreshAgents(projectId).catch(() => {});
  }, [projectId, refreshAgents]);

  const saveBlueprint = usePipelineStore((s) => s.saveBlueprint);

  const [name, setName] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([
    { order: 1, agentId: "", subTaskTemplate: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addStage = () =>
    setStages((prev) => renumber([...prev, { order: prev.length + 1, agentId: "", subTaskTemplate: "" }]));

  const removeStage = (idx: number) =>
    setStages((prev) => renumber(prev.filter((_, i) => i !== idx)));

  const move = (idx: number, dir: -1 | 1) =>
    setStages((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return renumber(next);
    });

  const patchStage = (idx: number, patch: Partial<StageDraft>) =>
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) {
      setError("请填写流水线名称");
      return;
    }
    if (stages.some((s) => !s.agentId)) {
      setError("每个阶段都需选择 Agent");
      return;
    }
    if (stages.some((s) => !s.subTaskTemplate.trim())) {
      setError("每个阶段都需填写子任务");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const bp = await saveBlueprint(
        projectId,
        {
          name: name.trim(),
          stages: stages.map((s) => ({
            order: s.order,
            agentId: s.agentId,
            subTaskTemplate: s.subTaskTemplate,
          })),
        },
        pipelineId,
      );
      onSaved(bp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>
          流水线名称 <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          data-testid="pipeline-name"
          data-tour-id="pipeline-editor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：CS2 饰品监控流水线"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={labelStyle}>阶段（按顺序执行）</label>
        {stages.map((s, idx) => (
          <div
            key={idx}
            data-testid="pipeline-stage-row"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-hover)",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 22,
                }}
              >
                {String(s.order).padStart(2, "0")}
              </span>
              <select
                data-testid="pipeline-stage-agent"
                value={s.agentId}
                onChange={(e) => patchStage(idx, { agentId: e.target.value })}
                style={{ ...inputStyle, flex: 1, cursor: "pointer" }}
              >
                <option value="">选择 Agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                title="上移"
                style={{ ...iconBtnStyle, opacity: idx === 0 ? 0.35 : 1 }}
              >
                ↑
              </button>
              <button
                onClick={() => move(idx, 1)}
                disabled={idx === stages.length - 1}
                title="下移"
                style={{ ...iconBtnStyle, opacity: idx === stages.length - 1 ? 0.35 : 1 }}
              >
                ↓
              </button>
              <button
                onClick={() => removeStage(idx)}
                disabled={stages.length <= 1}
                title="删除阶段"
                style={{ ...iconBtnStyle, opacity: stages.length <= 1 ? 0.35 : 1 }}
              >
                ✕
              </button>
            </div>
            <textarea
              data-testid="pipeline-stage-subtask"
              value={s.subTaskTemplate}
              onChange={(e) => patchStage(idx, { subTaskTemplate: e.target.value })}
              placeholder="该阶段交给此 Agent 的子任务（多行）…"
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
        ))}
        <button
          data-testid="pipeline-add-stage"
          onClick={addStage}
          style={{
            padding: "7px 0",
            background: "var(--bg-hover)",
            border: "1px dashed var(--border)",
            borderRadius: 7,
            color: "var(--text-muted)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          + 添加阶段
        </button>
      </div>

      {error && (
        <div data-testid="pipeline-editor-error" style={{ color: "#dc2626", fontSize: 12, lineHeight: 1.4 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid="pipeline-save"
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            padding: "9px 0",
            background: "var(--accent)",
            border: "none",
            borderRadius: 7,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.65 : 1,
          }}
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "9px 16px",
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

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  flexShrink: 0,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
};
