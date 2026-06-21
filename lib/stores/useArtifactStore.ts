"use client";

import { create } from "zustand";
import { toast } from "./useToastStore";
import type { Artifact, ArtifactVersion } from "@/lib/domain/artifact-service";
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
 * 渲染仍只读（D-D5-1：D5 不引入手动编辑器、不新增绕过 PendingChange 的写路径）。
 * **D5 版本管理**（§5.6）：versions 列表 + selectVersion（null=跟随最新 / 选历史版只读看快照）+
 * rollback（带 If-Match 乐观锁、成功后 refresh 并复位到最新）。无 SSE（D-D5-2 选 A：自己触发的
 * 操作后直接 refresh），不动 useAgentSession 的 SSE switch。
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
  /**
   * 「点对话框 diff 块跳转到原文」的目标块 id（T2/A3）。配合 focusBlockNonce 解耦：
   * 卡片只发信号、ArtifactPanel 据此 scrollIntoView 到对应 data-block-id 段。无打开/未跳转为 null。
   */
  focusBlockId: string | null;
  /**
   * 跳转信号单调递增计数（T2/A3）：requestBlockFocus 每次 +1。复刻 diffFocusNonce 解耦范式，
   * 同一块连点也能重新触发；标量字段、不返回新数组，订阅侧无 D-D3-10 useShallow 风险。
   */
  focusBlockNonce: number;

  // ---- D5 版本管理（§5.6）----
  /** 当前 artifact 的版本元数据列表（含 content，按 version 升序）；未拉取/未打开为空数组。 */
  versions: ArtifactVersion[];
  /** 选中查看的版本号：null = 跟随最新（currentVersion，叠 pending 高亮/Diff）；非 null = 只读看该历史版。 */
  selectedVersion: number | null;
  /** 选中历史版时的只读内容（selectedVersion 为 null 时为 null）。 */
  historyContent: string | null;
  /** rollback 进行中（禁用按钮防重复点）。 */
  rollbackBusy: boolean;
  /** rollback 错误（如 409 冲突）；null 为无错。 */
  rollbackError: string | null;

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
  /**
   * 请求跳转到原文对应块（A3，点对话框 diff 块）：切 viewMode='inline'（跳转落点是行内高亮段）、
   * 写 focusBlockId、+1 focusBlockNonce。复刻 requestDiffFocus 范式，ArtifactPanel/AppShell 各自消费。
   */
  requestBlockFocus: (blockId: string) => void;

  /** 拉当前 artifact 的版本列表（GET .../versions）。无打开的 artifact 时为空操作。 */
  listVersions: () => Promise<void>;
  /**
   * 选择查看的版本（D5）：null 或选中 currentVersion → 回到跟随最新（清历史内容）；
   * 否则拉 GET .../versions/[v] 取该版完整内容只读展示（D-D5-4：历史版无 pending 高亮/Diff）。
   */
  selectVersion: (version: number | null) => Promise<void>;
  /**
   * 回滚到目标版（D5 §5.6 AC④⑥）：带 If-Match=当前 artifact.version（乐观锁），
   * 成功后 refresh() 拉新内容/pending + 复位 selectedVersion=null（回到最新）；409 等失败写 rollbackError。
   */
  rollback: (toVersion: number) => Promise<void>;
  /**
   * 彻底删除一个受管 artifact（第四轮）：target = id ?? selectedArtifactId。
   * target 为当前打开项时带 If-Match=artifact.version（乐观锁）；DELETE /api/artifacts/[id]。
   * 成功后仅当 target===selectedArtifactId 才 close()（删非当前打开项不误清右栏）；
   * 409/404/其它失败走 toast。结构操作、不走 propose（D-V4-02）。返回是否删成功（供入口决定是否刷新）。
   */
  delete: (id?: string) => Promise<boolean>;
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
  focusBlockId: null,
  focusBlockNonce: 0,
  versions: [],
  selectedVersion: null,
  historyContent: null,
  rollbackBusy: false,
  rollbackError: null,

  open: async (artifactId) => {
    // 打开新 artifact：版本态全部归零（不跨 artifact 留旧版本/历史内容）。
    set({
      selectedArtifactId: artifactId,
      loading: true,
      error: null,
      viewMode: "inline",
      versions: [],
      selectedVersion: null,
      historyContent: null,
      rollbackError: null,
    });
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
      versions: [],
      selectedVersion: null,
      historyContent: null,
      rollbackError: null,
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setEditTarget: (target) => set({ editTarget: target }),

  requestDiffFocus: () => set((s) => ({ viewMode: "diff", diffFocusNonce: s.diffFocusNonce + 1 })),

  requestBlockFocus: (blockId) =>
    set((s) => ({ viewMode: "inline", focusBlockId: blockId, focusBlockNonce: s.focusBlockNonce + 1 })),

  listVersions: async () => {
    const artifactId = get().selectedArtifactId;
    if (!artifactId) return;
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/versions`);
      if (!res.ok) return; // 静默：版本列表拉不到不破坏当前视图
      const versions = (await res.json()) as ArtifactVersion[];
      set({ versions });
    } catch {
      // 静默：保留现状
    }
  },

  selectVersion: async (version) => {
    const { selectedArtifactId, artifact } = get();
    if (!selectedArtifactId) return;
    // null 或选回当前版 → 跟随最新（清历史内容、恢复 pending 高亮/Diff，D-D5-4）。
    if (version == null || (artifact && version === artifact.currentVersion)) {
      set({ selectedVersion: null, historyContent: null });
      return;
    }
    try {
      const res = await fetch(
        `/api/artifacts/${encodeURIComponent(selectedArtifactId)}/versions/${version}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = `加载历史版失败：${data.error ?? `HTTP ${res.status}`}`;
        // 失败兜底：rollbackError 所在面板可能已关/滚出视口，补一条 toast（保留局部态）。
        set({ rollbackError: msg });
        toast.error(msg);
        return;
      }
      const ver = (await res.json()) as ArtifactVersion;
      set({ selectedVersion: version, historyContent: ver.content, rollbackError: null });
    } catch (e) {
      const msg = `加载历史版失败：${String(e)}`;
      set({ rollbackError: msg });
      toast.error(msg);
    }
  },

  rollback: async (toVersion) => {
    const { selectedArtifactId, artifact, rollbackBusy } = get();
    if (!selectedArtifactId || !artifact || rollbackBusy) return;
    set({ rollbackBusy: true, rollbackError: null });
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(selectedArtifactId)}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 乐观锁（AC⑥）：If-Match = 当前读到的 version；服务端 ≠ 则 409。
          "If-Match": String(artifact.version),
        },
        body: JSON.stringify({ version: toVersion }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = `回滚失败：${data.error ?? `HTTP ${res.status}`}`;
        // 失败兜底：rollbackError 所在面板可能已关/滚出视口，补一条 toast（保留局部态）。
        set({ rollbackError: msg });
        toast.error(msg);
        return;
      }
      // 成功：复位到跟随最新 + refresh() 拉新内容/pending（D-D5-2 选 A，前端自刷新、无 SSE）。
      // 版本列表由 ArtifactPanel 监听 currentVersion 变化统一重拉（rollback 使 currentVersion+1）。
      set({ selectedVersion: null, historyContent: null });
      await get().refresh();
      toast.success(`已回滚到 v${toVersion}`);
    } catch (e) {
      const msg = `回滚失败：${String(e)}`;
      set({ rollbackError: msg });
      toast.error(msg);
    } finally {
      set({ rollbackBusy: false });
    }
  },

  delete: async (id) => {
    const { selectedArtifactId, artifact } = get();
    const target = id ?? selectedArtifactId;
    if (!target) return false;
    const isOpen = target === selectedArtifactId;
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(target)}`, {
        method: "DELETE",
        // 删当前打开项时带乐观锁（删非当前打开项不带，并发面小，D-V4 gap 4）。
        headers: isOpen && artifact ? { "If-Match": String(artifact.version) } : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`删除失败：${data.error ?? `HTTP ${res.status}`}`);
        return false;
      }
      // 成功：仅当删的是当前打开项才清右栏（删他项不误清，T2 红线）。
      if (isOpen) get().close();
      toast.success("已删除");
      return true;
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
      return false;
    }
  },
}));

/**
 * 派生：当前 artifact 全部 pending 变更里 state==="pending" 的 DiffBlock 扁平列表。
 * 行内高亮只叠加 pending 块（confirmed/rejected 不显示，docs/03:91）；降级判定也用它计数。
 * ⚠️ flatMap+filter 每次返回**新数组**，订阅侧**必须** `useArtifactStore(useShallow(selectPendingBlocks))`，
 * 直接 `useArtifactStore(selectPendingBlocks)` 会无限重渲染（D-D3-10）。
 */
export const selectPendingBlocks = (s: ArtifactState) =>
  s.pendingChanges.flatMap((pc) => pc.diffBlocks).filter((b) => b.state === "pending");
