"use client";

import { create } from "zustand";
import type { Artifact } from "@/lib/domain/artifact-service";
import type { PendingChange } from "@/lib/domain/pending-change-service";

/**
 * ArtifactPanel 的前端状态（D3，§5.4）。承载：
 * - 当前打开的 artifact（元数据 + 当前版本 content）与其未确认变更（pendingChanges）；
 * - 视图模式 inline（行内高亮）/ diff（并排 Diff）；
 * - editTarget：划选「引用到对话框」的桥梁（ArtifactPanel 写 quoteText → ChatWindow 引用条读）。
 *
 * **刻意不持久化**（无 localStorage）：以上全是会话内瞬态，刷新归零合理；
 * 也因此天然无 SSR hydration 问题（store 仅在 client 组件里被读），不复刻 useProjectStore 的 hydrate。
 *
 * ⚠️ 但「无 localStorage」只消除 hydration mismatch，**不**消除另一类订阅稳定性坑：
 * 派生 selector 若每次返回**新的数组/对象引用**（如下方 `selectPendingBlocks` 的 flatMap+filter），
 * 直接 `useArtifactStore(selector)` 会让 useSyncExternalStore 快照恒不等 → 无限重渲染。
 * 此类派生 selector 订阅侧必须用 `useShallow` 包裹（D-D3-10，真浏览器 E2E 暴露、单测/逻辑层抓不到）。
 *
 * 纯渲染层（D-D3-1）：**不做** resolve / 逐块确认 / 版本切换；那些是 D4 / §5.5 / §5.6。
 */

/** 划选引用目标：哪个 artifact 的哪段文本被引用到对话框（AC⑥）。 */
export type EditTarget = {
  targetArtifactId: string;
  quoteText: string;
};

interface ArtifactState {
  /** 当前打开的 artifact id（未打开为 null）。 */
  selectedArtifactId: string | null;
  /** 当前 artifact 元数据 + 当前版本完整内容（加载中 / 未打开为 null）。 */
  artifact: (Artifact & { content: string }) | null;
  /** 当前 artifact 的未确认块级变更（无变更为空数组）。 */
  pendingChanges: PendingChange[];
  /** 视图模式：行内高亮 / 并排 Diff（AC⑤ 手动切换、AC④ 降级时自动切 diff）。 */
  viewMode: "inline" | "diff";
  /** 加载中标志（拉 artifact + pending 时）。 */
  loading: boolean;
  /** 加载错误（如 artifact 不存在）。 */
  error: string | null;
  /** 划选引用目标（AC⑥）；无引用为 null。 */
  editTarget: EditTarget | null;
  /**
   * 「请求聚焦并排 Diff」单调递增信号（AC④，D-D4-3 选 B）。PendingChangeCard 按 D 键时 +1；
   * AppShell 监听其变化 → 展开右侧面板（卡片在 ChatWindow 内、够不到 AppShell 的 rightPanelOpen 本地 state，
   * 故经此信号解耦：卡片只发信号、AppShell 只消费，nonce 单调无需清理）。
   */
  diffFocusNonce: number;

  /** 打开一个 artifact：拉取其当前内容 + pending 变更，重置视图为 inline。 */
  open: (artifactId: string) => Promise<void>;
  /**
   * 重拉当前 artifact 的内容 + pending 变更（D4：逐块 resolve 后刷新）。
   * 与 open 区别：**不重置 viewMode、不亮 loading 骨架**——resolve 后仅静默更新数据，
   * 让面板里行内高亮按新 state 自然消失（D3 已 state 过滤）、并排 Diff 视图保持不跳变。
   * 无打开的 artifact 时为空操作。
   */
  refresh: () => Promise<void>;
  /** 关闭当前 artifact（清空内容与 pending；保留 editTarget——引用可跨关闭存活）。 */
  close: () => void;
  /** 手动切换视图模式（AC⑤「查看 Diff」按钮）。 */
  setViewMode: (mode: "inline" | "diff") => void;
  /** 写入划选引用（AC⑥「引用到对话框」）。 */
  setEditTarget: (target: EditTarget | null) => void;
  /** 请求聚焦并排 Diff（D 键）：切 viewMode='diff' 并 +1 diffFocusNonce 触发 AppShell 展开面板。 */
  requestDiffFocus: () => void;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  selectedArtifactId: null,
  artifact: null,
  pendingChanges: [],
  viewMode: "inline",
  loading: false,
  error: null,
  editTarget: null,
  diffFocusNonce: 0,

  open: async (artifactId) => {
    set({ selectedArtifactId: artifactId, loading: true, error: null, viewMode: "inline" });
    try {
      // artifact 内容与 pending 变更两个只读端点并行拉取（D-D3-2）。
      const [artRes, pendRes] = await Promise.all([
        fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`),
        fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/pending`),
      ]);
      if (!artRes.ok) {
        const data = (await artRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${artRes.status}`);
      }
      const artifact = (await artRes.json()) as Artifact & { content: string };
      // pending 拉取失败不致命（无变更是正常态）——降级为空数组、仍渲染正文。
      const pendingChanges = pendRes.ok ? ((await pendRes.json()) as PendingChange[]) : [];
      set({ artifact, pendingChanges, loading: false });
    } catch (e) {
      set({ artifact: null, pendingChanges: [], loading: false, error: String(e) });
    }
  },

  refresh: async () => {
    const artifactId = get().selectedArtifactId;
    if (!artifactId) return;
    try {
      const [artRes, pendRes] = await Promise.all([
        fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`),
        fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/pending`),
      ]);
      if (!artRes.ok) return; // 静默：刷新失败不破坏当前视图（resolve 本身的成败由卡片提示）
      const artifact = (await artRes.json()) as Artifact & { content: string };
      const pendingChanges = pendRes.ok ? ((await pendRes.json()) as PendingChange[]) : [];
      set({ artifact, pendingChanges });
    } catch {
      // 静默：保留现状
    }
  },

  close: () =>
    set({
      selectedArtifactId: null,
      artifact: null,
      pendingChanges: [],
      viewMode: "inline",
      error: null,
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setEditTarget: (target) => set({ editTarget: target }),

  requestDiffFocus: () => set((s) => ({ viewMode: "diff", diffFocusNonce: s.diffFocusNonce + 1 })),
}));

/**
 * 派生：当前 artifact 全部 pending 变更里 state==="pending" 的 DiffBlock 扁平列表。
 * 行内高亮只叠加 pending 块（confirmed/rejected 不显示，docs/03:91）；降级判定也用它计数。
 * ⚠️ flatMap+filter 每次返回**新数组**，订阅侧**必须** `useArtifactStore(useShallow(selectPendingBlocks))`，
 * 直接 `useArtifactStore(selectPendingBlocks)` 会无限重渲染（D-D3-10）。
 */
export const selectPendingBlocks = (s: ArtifactState) =>
  s.pendingChanges.flatMap((pc) => pc.diffBlocks).filter((b) => b.state === "pending");
