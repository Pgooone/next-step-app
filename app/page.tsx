"use client";

import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ProjectHome } from "@/components/ProjectHome";
import {
  useProjectStore,
  selectCurrentProjectId,
  pickRootView,
} from "@/lib/stores/useProjectStore";

/**
 * 入口分流（M6 / D-V1.1-02）：单页内按 currentProjectId 二选一渲染，不引入路由。
 * 未选项目 → 项目墙 ProjectHome；已选 → 现有工作台 AppShell。
 *
 * hydrate 时序：store 初始 currentProjectId 故意为 null（与 SSR 一致，避免 hydration mismatch），
 * 挂载后才从 localStorage 恢复。未恢复完成前先渲染占位，避免首屏闪 ProjectHome
 * 破坏「刷新后停在工作台」的体验。
 */
function RootRouter() {
  const [hydrated, setHydrated] = useState(false);
  const currentProjectId = useProjectStore(selectCurrentProjectId);

  useEffect(() => {
    useProjectStore.getState().hydrate();
    setHydrated(true);
  }, []);

  const view = pickRootView(currentProjectId, hydrated);
  if (view === "loading") return null;
  if (view === "home") return <ProjectHome />;
  return <AppShell />;
}

export default function Home() {
  return (
    <Suspense>
      <RootRouter />
    </Suspense>
  );
}
