"use client";

import { create } from "zustand";
// D-R7B-07：领域层（mastermind-run-store）含 node:fs，只能 import type，绝不 value-import
// （否则 "use client" 链把 node:fs 拖进客户端 bundle → 全站 500）。运行数据经 fetch JSON 取。
import type { MastermindRun } from "@/lib/domain/mastermind-run-store";
// useToastStore 是纯客户端 store（零 node:fs），静态 value-import 安全、不违 D-R7B-07。
// 用相对路径：vitest.config 未配 `@/` 别名，value-import 须运行期可解析（import type 才可用 `@/`）。
import { toast } from "./useToastStore";

/** paused 态抉择动作（对齐 resume/route.ts 的 ResumeAction）。 */
export type MastermindResumeAction = "retry" | "reassign" | "skip" | "abort";

interface MastermindState {
  /**
   * 按 runId 索引（多 run 并存：打回后旧 failed 卡 + 新卡同存于一条对话）。母版单 currentRun 会互相覆盖，
   * 故改 Record；ChatWindow 从 transcript 派生 runId 后逐个 ensureRun 写进这里（见 derive-run-ids.ts）。
   */
  runs: Record<string, MastermindRun>;

  /** 幂等首拉（与轮询分离）：无条件 GET 一次写回 runs[runId]，供 awaiting/paused 首帧拿到 plan/failureOptions。 */
  ensureRun: (runId: string) => Promise<void>;
  /** 批量轮询：遍历当前所有 running run 各 GET 一次写回（单宿主一个 setInterval 调它，见 MastermindPollDriver）。 */
  pollRunning: () => Promise<void>;

  /** 计划卡「确认放行」：POST approve，用响应体乐观写回；非 2xx → re-fetch 覆盖（吸收 409/422 不对称）。 */
  approve: (projectId: string, runId: string) => Promise<void>;
  /** 计划卡「否决」：POST reject（旧 run→failed 只读）。 */
  reject: (projectId: string, runId: string) => Promise<void>;
  /** 计划卡「打回」：POST revise（旧 run→failed；新 run 由主脑下次 submit_plan 在新消息产生，别原位替换）。 */
  revise: (projectId: string, runId: string) => Promise<void>;
  /** paused 抉择：POST resume（retry/skip/abort 只带 action；reassign 额外带 newAgentId）。 */
  resume: (
    projectId: string,
    runId: string,
    action: MastermindResumeAction,
    newAgentId?: string,
  ) => Promise<void>;
  /** 取消运行：POST /api/mastermind-runs/[runId]/cancel（跨项目、无 projectId）。 */
  cancel: (runId: string) => Promise<void>;
}

/** 项目态动作 base（approve/reject/revise/resume）。 */
const projectBase = (projectId: string, runId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/mastermind/runs/${encodeURIComponent(runId)}`;

/** 跨项目 base（GET / cancel），无 projectId。 */
const runBase = (runId: string) => `/api/mastermind-runs/${encodeURIComponent(runId)}`;

/** 统一读 JSON：非 2xx 抛后端 error 文本（错误形态 { error, code? }，绝不 import PipelineError）。 */
async function readJson(res: Response): Promise<MastermindRun> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as MastermindRun;
}

export const useMastermindStore = create<MastermindState>((set, get) => ({
  runs: {},

  ensureRun: async (runId) => {
    // 幂等首拉：无条件 GET（awaiting/paused 服务端不自改、但首帧必须拿到 plan.teammates/failureOptions）。
    const run = await readJson(await fetch(runBase(runId)));
    set((s) => ({ runs: { ...s.runs, [run.id]: run } }));
  },

  pollRunning: async () => {
    // 只轮询 running 子集（selectMastermindNeedsPolling 判据）；逐个 GET，各自失败静默不互相阻断。
    const running = Object.values(get().runs).filter(selectMastermindNeedsPolling);
    await Promise.all(
      running.map(async (r) => {
        try {
          const next = await readJson(await fetch(runBase(r.id)));
          set((s) => ({ runs: { ...s.runs, [next.id]: next } }));
        } catch {
          // 单条轮询失败静默（下一 tick 重试）。
        }
      }),
    );
  },

  approve: async (projectId, runId) => {
    await postWithRefetch(set, `${projectBase(projectId, runId)}/approve`, runId);
  },

  reject: async (projectId, runId) => {
    await postWithRefetch(set, `${projectBase(projectId, runId)}/reject`, runId);
  },

  revise: async (projectId, runId) => {
    await postWithRefetch(set, `${projectBase(projectId, runId)}/revise`, runId);
  },

  resume: async (projectId, runId, action, newAgentId) => {
    await postWithRefetch(set, `${projectBase(projectId, runId)}/resume`, runId, {
      action,
      ...(newAgentId ? { newAgentId } : {}),
    });
  },

  cancel: async (runId) => {
    await postWithRefetch(set, `${runBase(runId)}/cancel`, runId);
  },
}));

/**
 * POST 一个动作端点，成功用响应体乐观写回 runs[runId]；**任意非 2xx → re-fetch GET 覆盖 + toast**
 * （统一吸收 approve 的裸 409{CONFLICT} 与 reject/revise/resume 的 422，见 t5-brief Trap 5）。
 * 单独抽出便于单测「409/422 都触发 re-fetch」。
 */
async function postWithRefetch(
  set: (fn: (s: MastermindState) => Partial<MastermindState>) => void,
  url: string,
  runId: string,
  body?: unknown,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (res.ok) {
    const run = (await res.json()) as MastermindRun;
    set((s) => ({ runs: { ...s.runs, [run.id]: run } }));
    return;
  }
  // 非 2xx（含 409/422/404）：状态已在服务端变化 → re-fetch 权威态覆盖本地 + 提示，不静默失败。
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  try {
    const fresh = await readJson(await fetch(runBase(runId)));
    set((s) => ({ runs: { ...s.runs, [fresh.id]: fresh } }));
  } catch {
    // re-fetch 也失败（如 404 已删）：保留本地态，仅报错。
  }
  toast.warning(data.error ?? "操作未生效，状态可能已变化");
}

/**
 * 该 run 是否仍需轮询：**仅 running**（单判据）。
 * 6 态里只 running 是服务端持续自改（编排器每阶段 write）；awaiting/paused 等用户 POST（响应体乐观写回
 * 即最新态，reconcileOrphan 对这两态 early-return）；done/failed/partial 终态。首拉（ensureRun）独立于此。
 * 纯函数，供组件 effect + store 内批量轮询用。
 */
export function selectMastermindNeedsPolling(run: MastermindRun | null | undefined): boolean {
  return run?.status === "running";
}
