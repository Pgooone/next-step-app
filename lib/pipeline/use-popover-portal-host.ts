"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

/**
 * 第 8.6 轮第二期 · M3（D-R8.6-15）—— 浮层 Portal 宿主。
 *
 * 背景：第一期 T5 的 `gsap.from` 入场补间在 `.brow` 卡片残留 identity transform → `.brow` 成为
 * `position:fixed` 后代的**包含块** → 渲在 `.brow` 内的 StageHoverPreview / StageSessionMenu 浮框飞离卡片
 * +320px（应贴卡 6px）。修法 = createPortal 到 **body 级 wrapper**，脱离 `.brow` 包含块、fixed 恢复相对视口
 * （`computeFixedPopover` 算法与 `anchorRef.getBoundingClientRect` 一字不动）。
 *
 * wrapper 精确形态（评审坐实方案 c，D-R8.6-15）：
 *   - className = `pipeline-board t-kimi-{theme}`——命中 PipelineBoardStyles 的纯 `<style>` 选择器、
 *     `var(--pop/--line/--task/--run-accent…)` token 有值（否则浮框白屏，M3-P1 隐藏命门）；
 *     **绝不含 `board` 类**（`.pipeline-board.board` 才带 background/padding、会在 body 上画异物）。
 *   - position 默认 static、**无 transform/filter/contain/isolation**（防「包含块讽刺」重演）。
 *   - 每浮框实例 useEffect 自建自毁（unmount 时 remove）；theme 变化时更新 className（跟 useTheme 真源、
 *     看板 modal 与主脑内联两宿主亮暗一致）。
 *   - SSR 安全：仅在客户端（mounted 后、`typeof document` 存在）创建；未就绪返回 null → 调用方不渲 Portal。
 *
 * 返回：可作为 createPortal 目标的 body 级容器（就绪前为 null）。
 */
export function usePopoverPortalHost(): HTMLElement | null {
  const { theme } = useTheme();
  const [host, setHost] = useState<HTMLElement | null>(null);

  // 自建自毁：mount 建一个 body 级 wrapper、unmount 移除。空依赖 → 每实例一份、生命周期绑组件。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.createElement("div");
    // 明确不设任何 position/transform/filter/contain/isolation（默认 static）→ 不成 fixed 后代的包含块。
    document.body.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
      setHost(null);
    };
  }, []);

  // theme 跟手：className 随 useTheme 真源切换（两宿主亮暗 token 一致）。className 只含 pipeline-board +
  // 主题类，绝不含 board（避免 body 上画出带背景/内边距的异物）。
  useEffect(() => {
    if (!host) return;
    host.className = `pipeline-board t-kimi-${theme}`;
  }, [host, theme]);

  return host;
}
