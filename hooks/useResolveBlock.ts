"use client";

import { useCallback } from "react";
import { useArtifactStore } from "@/lib/stores/useArtifactStore";
import { toast } from "@/lib/stores/useToastStore";

/**
 * 单块 resolve 的共用 hook（第七轮 T3/T4）：抽自 `PendingChangeCard.resolve` 的「单块确认/拒绝」核心，
 * 供内联段就地 ✓/✗（ArtifactPanel.HlSegment，T3）与对话框卡片（PendingChangeCard，T4 改用）共用，
 * 避免两份 fetch 逻辑漂移。
 *
 * 契约与 PendingChangeCard 现状一致：
 * - 端点：`POST /api/artifacts/{artifactId}/pending/{changeId}/resolve`
 * - body：`{ action, blockId }`（带 blockId = 仅 resolve 该块；全块由卡片自己省略 blockId，不走本 hook）
 * - 成功后调 `useArtifactStore.getState().refresh()`（静默重拉，行内高亮按新 state 自然消失）
 * - 失败 toast.error；红线②：写盘仍只在服务端 `resolveAndMaterialize`（全块非 pending 时）触发，
 *   前端绝不直接改 content。
 *
 * 返回 `resolveBlock(changeId, blockId, action)`：成功 true / 失败 false。
 */
export function useResolveBlock(artifactId: string) {
  return useCallback(
    async (changeId: string, blockId: string, action: "confirm" | "reject"): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(artifactId)}/pending/${encodeURIComponent(changeId)}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, blockId }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(`操作失败：${data.error ?? `HTTP ${res.status}`}`);
          return false;
        }
        await useArtifactStore.getState().refresh();
        toast.success(action === "confirm" ? "已确认该块" : "已拒绝该块");
        return true;
      } catch (e) {
        toast.error(`操作失败：${String(e)}`);
        return false;
      }
    },
    [artifactId],
  );
}
