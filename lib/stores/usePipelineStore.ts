"use client";

import { create } from "zustand";
// D-R7B-07：领域层含 node:fs，只能 import type，绝不 value-import（否则 "use client" 链把 node:fs
// 拖进客户端 bundle → 全站 500）。领域**数据**经 fetch JSON 取。
import type { PipelineBlueprint, PipelineStageSpec } from "@/lib/domain/pipeline-store";
import type { PipelineRun } from "@/lib/domain/pipeline-run-store";

/** 建/改蓝图的可写入参（id/createdAt/updatedAt 由后端 store 填）。 */
export type BlueprintInput = {
  name: string;
  stages: Pick<PipelineStageSpec, "order" | "agentId" | "subTaskTemplate">[];
};

interface PipelineState {
  blueprints: PipelineBlueprint[];
  runs: PipelineRun[];
  currentRun: PipelineRun | null;
  /** 当前数据属于哪个项目；与请求项目不匹配时视为空，避免跨项目串显（仿 useAgentStore）。 */
  loadedProjectId: string | null;
  loading: boolean;
  error: string | null;

  loadBlueprints: (projectId: string) => Promise<void>;
  /** 传 pipelineId → PUT 整体替换，否则 POST 新建。成功后本地合并。 */
  saveBlueprint: (
    projectId: string,
    input: BlueprintInput,
    pipelineId?: string,
  ) => Promise<PipelineBlueprint>;
  deleteBlueprint: (projectId: string, pipelineId: string) => Promise<void>;
  startRun: (projectId: string, pipelineId: string) => Promise<PipelineRun>;
  loadRuns: (projectId: string, pipelineId: string) => Promise<void>;
  selectRun: (run: PipelineRun | null) => void;
  /** 单次拉取 currentRun 并写回（定时器在组件）。失败静默由调用方 catch。 */
  pollCurrentRun: () => Promise<void>;
  /** T6 端点，前瞻契约（当前会 404，UI 占位）。 */
  cancelRun: (runId: string) => Promise<void>;
  /** 复位：清 currentRun，让组件 effect 停轮询。 */
  stopPolling: () => void;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/pipelines`;

/** 统一读 JSON：非 2xx 抛出后端 error 文本（错误形态 { error, code? }）。 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  blueprints: [],
  runs: [],
  currentRun: null,
  loadedProjectId: null,
  loading: false,
  error: null,

  loadBlueprints: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const blueprints = await readJson<PipelineBlueprint[]>(await fetch(base(projectId)));
      set({ blueprints, loadedProjectId: projectId, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
      throw e;
    }
  },

  saveBlueprint: async (projectId, input, pipelineId) => {
    const url = pipelineId
      ? `${base(projectId)}/${encodeURIComponent(pipelineId)}`
      : base(projectId);
    const bp = await readJson<PipelineBlueprint>(
      await fetch(url, {
        method: pipelineId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    // 本地合并：已存在则替换、否则追加（保持 updatedAt 倒序由下次 loadBlueprints 兜，本地简单 unshift）。
    set((s) => {
      const exists = s.blueprints.some((b) => b.id === bp.id);
      return {
        blueprints: exists
          ? s.blueprints.map((b) => (b.id === bp.id ? bp : b))
          : [bp, ...s.blueprints],
      };
    });
    return bp;
  },

  deleteBlueprint: async (projectId, pipelineId) => {
    const res = await fetch(`${base(projectId)}/${encodeURIComponent(pipelineId)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    set((s) => ({ blueprints: s.blueprints.filter((b) => b.id !== pipelineId) }));
  },

  startRun: async (projectId, pipelineId) => {
    const run = await readJson<PipelineRun>(
      await fetch(`${base(projectId)}/${encodeURIComponent(pipelineId)}/runs`, {
        method: "POST",
      }),
    );
    set((s) => ({ runs: [run, ...s.runs], currentRun: run }));
    return run;
  },

  loadRuns: async (projectId, pipelineId) => {
    const runs = await readJson<PipelineRun[]>(
      await fetch(`${base(projectId)}/${encodeURIComponent(pipelineId)}/runs`),
    );
    set({ runs });
  },

  selectRun: (run) => set({ currentRun: run }),

  pollCurrentRun: async () => {
    const run = get().currentRun;
    if (!run) return;
    const next = await readJson<PipelineRun>(
      await fetch(`/api/pipeline-runs/${encodeURIComponent(run.id)}`),
    );
    set((s) => ({
      currentRun: next,
      runs: s.runs.map((r) => (r.id === next.id ? next : r)),
    }));
  },

  cancelRun: async (runId) => {
    const res = await fetch(`/api/pipeline-runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
  },

  stopPolling: () => set({ currentRun: null }),
}));

/**
 * currentRun 是否仍需轮询：run.status==='running'，或任一阶段 queued/running/pending。
 * 终态(done/failed)且无活跃阶段 → 不轮询。纯函数，供组件 effect 用。
 */
export function selectNeedsPolling(run: PipelineRun | null): boolean {
  if (!run) return false;
  if (run.status === "running") return true;
  return run.stages.some(
    (s) => s.statusDetail === "queued" || s.status === "running" || s.status === "pending",
  );
}
