"use client";

import { create } from "zustand";
// 类型单一真相源：复用 domain 定义（docs/03 权威）。import type 编译期擦除，
// 不会把服务端 node:fs 拖进客户端 bundle（同 useDispatchStore import DispatchTask）。
import type { SessionMap } from "@/lib/domain/session-agent-map";

export type { SessionMap } from "@/lib/domain/session-agent-map";

interface SessionMapState {
  /** 当前已加载的映射（未加载 / 已切换项目时为空映射）。 */
  map: SessionMap;
  /** 当前 map 属于哪个项目；与请求项目不匹配时视为陌生，避免跨项目串显（仿 useDispatchStore）。 */
  loadedProjectId: string | null;
  /** 拉取该项目映射（GET，后端含惰性清理），写入 state 并标记 loadedProjectId。失败抛出。 */
  refresh: (projectId: string) => Promise<SessionMap>;
  /** 设/清主对话（PATCH 后 refresh）。 */
  setMain: (projectId: string, sessionId: string | null) => Promise<void>;
  /** 设某会话归属某 agent（PATCH 后 refresh）。 */
  setOwner: (projectId: string, sessionId: string, agentId: string) => Promise<void>;
  /** 删某会话归属（PATCH agentId=null 后 refresh）。 */
  removeOwner: (projectId: string, sessionId: string) => Promise<void>;
  /** 清空已加载映射（切项目 / 卸载前调用）。 */
  reset: () => void;
}

const emptyMap = (): SessionMap => ({ mainSessionId: null, bySession: {}, mastermindSessions: [] });

const mapBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/session-map`;

/** 共用：PATCH 一次后 refresh（保证 state 与盘一致，仿 useProjectStore 的写后 refresh）。 */
async function patch(projectId: string, body: unknown): Promise<void> {
  const res = await fetch(mapBase(projectId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

export const useSessionMapStore = create<SessionMapState>((set, get) => ({
  map: emptyMap(),
  loadedProjectId: null,

  refresh: async (projectId) => {
    const res = await fetch(mapBase(projectId));
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const map = (await res.json()) as SessionMap;
    set({ map, loadedProjectId: projectId });
    return map;
  },

  setMain: async (projectId, sessionId) => {
    await patch(projectId, { mainSessionId: sessionId });
    await get().refresh(projectId);
  },

  setOwner: async (projectId, sessionId, agentId) => {
    await patch(projectId, { sessionId, agentId });
    await get().refresh(projectId);
  },

  removeOwner: async (projectId, sessionId) => {
    await patch(projectId, { sessionId, agentId: null });
    await get().refresh(projectId);
  },

  reset: () => set({ map: emptyMap(), loadedProjectId: null }),
}));

/**
 * 派生：当前项目的映射。loadedProjectId 与传入 projectId 不匹配（含 null）时返回空映射，
 * 确保切项目期间不串显上一个项目的归属。纯函数，便于单测。
 */
export function selectMapForProject(
  map: SessionMap,
  loadedProjectId: string | null,
  projectId: string | null,
): SessionMap {
  if (!projectId || loadedProjectId !== projectId)
    return { mainSessionId: null, bySession: {}, mastermindSessions: [] };
  return map;
}

/** 派生：某会话的归属 agentId（无则 null）。纯函数。 */
export function selectOwner(map: SessionMap, sessionId: string): string | null {
  return map.bySession[sessionId] ?? null;
}
