"use client";

import { create } from "zustand";
import type { AgentProfile } from "@/lib/domain/agent-profile-store";

/** create / update 提交给后端的白名单字段（与 AgentProfileInput 对齐）。 */
export type AgentProfileInput = {
  name: string;
  role?: string;
  model?: string;
  skills?: string[];
  tools?: string[];
  thinkingLevel?: "off" | "low" | "medium" | "high";
};

/**
 * profile 可选的内置编码工具固定集（D-30，源 rpc-manager.ts:299 / PRESET_FULL）。
 * MCP / 技能附加工具属会话级、配置期不可知，故只此固定集供勾选。
 */
export const CODING_TOOL_NAMES: readonly string[] = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

/**
 * 把单 string model 按首个 `/` 拆为 `{provider, modelId}`（modelId 可含 `/`，D-25）。
 * 空 / 无 `/` → 返回 null（表单下拉视为「未选模型」）。纯函数，便于单测。
 */
export function splitModel(model: string): { provider: string; modelId: string } | null {
  const i = model.indexOf("/");
  if (i <= 0 || i === model.length - 1) return null;
  return { provider: model.slice(0, i), modelId: model.slice(i + 1) };
}

/** 由下拉选中的 provider/modelId 拼回单 string；任一为空则空串（→ B2 modelFallback）。纯函数。 */
export function joinModel(provider: string, modelId: string): string {
  if (!provider || !modelId) return "";
  return `${provider}/${modelId}`;
}

/** 勾选切换：tool 在集合中则移除、否则加入；输出保持 CODING_TOOL_NAMES 顺序。纯函数。 */
export function toggleTool(selected: string[], tool: string): string[] {
  const set = new Set(selected);
  if (set.has(tool)) set.delete(tool);
  else set.add(tool);
  return CODING_TOOL_NAMES.filter((t) => set.has(t));
}

interface AgentState {
  agents: AgentProfile[];
  /** 当前 agents 属于哪个项目；与请求项目不匹配时视为空，避免跨项目串显。 */
  loadedProjectId: string | null;
  /** 拉取某项目的档案列表；标记 loadedProjectId。 */
  refresh: (projectId: string) => Promise<void>;
  /** 新建档案：POST(201) 成功后 refresh。失败抛出（含后端 422 的 error 文本）。 */
  create: (projectId: string, input: AgentProfileInput) => Promise<AgentProfile>;
  /** 修改档案：PATCH 成功后 refresh。失败抛出（含 422 文本）。 */
  update: (
    projectId: string,
    agentId: string,
    patch: Partial<AgentProfileInput>,
  ) => Promise<AgentProfile>;
  /** 删除档案：DELETE(204)，404 容忍（仿 useProjectStore）；成功后 refresh。 */
  remove: (projectId: string, agentId: string) => Promise<void>;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/agents`;

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loadedProjectId: null,

  refresh: async (projectId) => {
    const res = await fetch(base(projectId));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const agents = (await res.json()) as AgentProfile[];
    set({ agents, loadedProjectId: projectId });
  },

  create: async (projectId, input) => {
    const res = await fetch(base(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<AgentProfile> & {
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    await get().refresh(projectId);
    return data as AgentProfile;
  },

  update: async (projectId, agentId, patch) => {
    const res = await fetch(`${base(projectId)}/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<AgentProfile> & {
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    await get().refresh(projectId);
    return data as AgentProfile;
  },

  remove: async (projectId, agentId) => {
    const res = await fetch(`${base(projectId)}/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    });
    // 后端 DELETE 成功为 204 无 body；404 视为已删除（仿 useProjectStore）
    if (!res.ok && res.status !== 404) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    await get().refresh(projectId);
  },
}));

/**
 * 派生：当前项目的档案列表。loadedProjectId 与传入 projectId 不匹配（含 null）
 * 时返回空数组，确保切项目期间不串显上一个项目的数据。纯函数语义，便于单测。
 */
export function selectAgentsForProject(s: AgentState, projectId: string | null): AgentProfile[] {
  if (!projectId || s.loadedProjectId !== projectId) return [];
  return s.agents;
}
