"use client";

import { create } from "zustand";
// 类型单一真相源：复用 domain 定义（docs/03 权威）。import type 编译期擦除，
// 不会把服务端 node:fs 拖进客户端 bundle（同 useAgentStore import AgentProfile）。
import type { DispatchTask } from "@/lib/domain/dispatch-store";

export type { DispatchStatus, Assignment, DispatchTask } from "@/lib/domain/dispatch-store";

/** 模态内发起派发时单条 assignment 的输入（agentId + 子任务）。 */
export type AssignmentInput = {
  agentId: string;
  subTask: string;
};

interface DispatchState {
  /** 当前正在跟踪的派发任务（未发起 / 已清空时为 null）。 */
  task: DispatchTask | null;
  /** 当前 task 属于哪个项目；与请求项目不匹配时视为空，避免跨项目串显（仿 useAgentStore）。 */
  loadedProjectId: string | null;
  /**
   * 发起派发：POST `/api/projects/[id]/dispatch`，body `{goal, assignments}`。
   * 成功后把返回的 DispatchTask 存入 state 并标记 loadedProjectId，返回 taskId 供轮询。
   * 失败抛出（含后端 error 文本）。
   */
  dispatch: (
    projectId: string,
    goal: string,
    assignments: AssignmentInput[],
  ) => Promise<{ taskId: string }>;
  /**
   * 轮询一次：GET `/api/dispatch/[taskId]`，刷新 task。
   * 仅当结果项目与 loadedProjectId 一致时才写入（防切项目后旧轮询串显）。失败抛出。
   */
  pollOnce: (projectId: string, taskId: string) => Promise<DispatchTask>;
  /** 清空当前跟踪的任务（关闭模态 / 重新发起前调用）。 */
  reset: () => void;
}

const dispatchBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/dispatch`;
const taskBase = (taskId: string) => `/api/dispatch/${encodeURIComponent(taskId)}`;

export const useDispatchStore = create<DispatchState>((set, get) => ({
  task: null,
  loadedProjectId: null,

  dispatch: async (projectId, goal, assignments) => {
    const res = await fetch(dispatchBase(projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, assignments }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<DispatchTask> & {
      error?: string;
    };
    if (!res.ok || !data.id) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    set({ task: data as DispatchTask, loadedProjectId: projectId });
    return { taskId: data.id };
  },

  pollOnce: async (projectId, taskId) => {
    const res = await fetch(taskBase(taskId));
    const data = (await res.json().catch(() => ({}))) as Partial<DispatchTask> & {
      error?: string;
    };
    if (!res.ok || !data.id) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const task = data as DispatchTask;
    // 仅当仍是同一项目时写入，避免切项目后旧轮询覆盖新状态
    if (get().loadedProjectId === projectId) set({ task });
    return task;
  },

  reset: () => set({ task: null, loadedProjectId: null }),
}));

/**
 * 派生：当前项目的派发任务。loadedProjectId 与传入 projectId 不匹配（含 null）
 * 时返回 null，确保切项目期间不串显上一个项目的任务。纯函数，便于单测。
 */
export function selectTaskForProject(
  task: DispatchTask | null,
  loadedProjectId: string | null,
  projectId: string | null,
): DispatchTask | null {
  if (!projectId || loadedProjectId !== projectId) return null;
  return task;
}

/**
 * 派生：任务是否仍在进行（用于决定是否继续轮询）。
 * pending / running 视为活跃；done / failed 视为终态。null 任务非活跃。纯函数。
 */
export function selectIsActive(task: DispatchTask | null): boolean {
  if (!task) return false;
  return task.status === "pending" || task.status === "running";
}
