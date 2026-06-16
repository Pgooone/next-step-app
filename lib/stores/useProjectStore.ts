"use client";

import { create } from "zustand";
import type { Project } from "@/lib/domain/project-registry";

const STORAGE_KEY = "next-step:current-project-id";

/** 读取持久化的当前项目 id（SSR / 无 localStorage 时返回 null）。纯函数，便于单测。 */
export function loadPersistedId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

/** 写入当前项目 id；传 null 时清除。纯函数，便于单测。 */
export function persistId(id: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (id === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, id);
}

/**
 * 按 id 在项目列表中解析当前项目；查不到（含 id 为 null）则回退 null。
 * 纯函数，是「持久化 id → 当前项目 + 回退」逻辑的单测锚点。
 */
export function resolveCurrentProject(
  projects: Project[],
  currentProjectId: string | null,
): Project | null {
  if (!currentProjectId) return null;
  return projects.find((p) => p.id === currentProjectId) ?? null;
}

/** 入口要渲染的三种视图（M6 单页分流，D-V1.1-02）。 */
export type RootView = "loading" | "home" | "shell";

/**
 * 入口分流：未 hydrate 完成前先渲染稳定占位（避免首屏闪 ProjectHome，
 * 破坏「刷新后停在工作台」）；hydrate 后无选中 → 项目墙，有选中 → 工作台。
 * 纯函数，是 M6 入口分流逻辑的单测锚点。
 */
export function pickRootView(currentProjectId: string | null, hydrated: boolean): RootView {
  if (!hydrated) return "loading";
  return currentProjectId === null ? "home" : "shell";
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  /**
   * 从 localStorage 恢复 currentProjectId（client-only，挂载后调一次）。
   * 初始 state 故意不读 localStorage，使 SSR 与客户端首屏一致（都 null），
   * 避免 hydration mismatch；恢复推迟到挂载后由此 action 完成。
   */
  hydrate: () => void;
  /** 拉取项目列表；若持久化的 currentProjectId 在新列表中已不存在则回退无选中。 */
  refresh: () => Promise<void>;
  /** 选中 / 取消选中（null）项目，并持久化。 */
  select: (id: string | null) => void;
  /** 新建项目：POST 后 refresh，再选中新项目。失败时抛出（含后端 422 的 error 文本）。 */
  create: (input: { name: string; root: string }) => Promise<Project>;
  /** 删除项目：仅移除注册项（后端不删盘）；若删的是当前项目则取消选中。 */
  remove: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  // 初始为 null（不在创建期读 localStorage），SSR/client 首屏一致；挂载后 hydrate() 恢复
  currentProjectId: null,

  hydrate: () => set({ currentProjectId: loadPersistedId() }),

  refresh: async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projects = (await res.json()) as Project[];
    // 持久化的当前项目若已不在列表中，回退无选中
    const current = get().currentProjectId;
    if (current && !projects.some((p) => p.id === current)) {
      persistId(null);
      set({ projects, currentProjectId: null });
    } else {
      set({ projects });
    }
  },

  select: (id) => {
    persistId(id);
    set({ currentProjectId: id });
  },

  create: async (input) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<Project> & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const project = data as Project;
    await get().refresh();
    get().select(project.id);
    return project;
  },

  remove: async (id) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    if (get().currentProjectId === id) get().select(null);
    await get().refresh();
  },
}));

/** 派生：当前选中的项目对象（无则 null）。 */
export const selectCurrentProject = (s: ProjectState): Project | null =>
  resolveCurrentProject(s.projects, s.currentProjectId);

/** 派生：当前选中项目的 id（无则 null）。 */
export const selectCurrentProjectId = (s: ProjectState): string | null => s.currentProjectId;

/** 派生：当前项目的 root（= cwd）；无选中则 null。 */
export const selectCurrentRoot = (s: ProjectState): string | null =>
  selectCurrentProject(s)?.root ?? null;
