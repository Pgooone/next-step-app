/**
 * gsap 插件集中注册（第七轮 T5 · A1 全屏 FLIP 动画）。
 *
 * 模块顶层注册一次 useGSAP + Flip，供客户端组件 import（如 AppShell 的全屏浮层）。
 * 纯注册、不碰 DOM、不执行动画 → SSR 安全（registerPlugin 只是登记，不访问 window/document）。
 * 仅可在 'use client' 组件里 import（layout.tsx 等 Server Component 绝不引）。
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(useGSAP, Flip);

export { gsap, useGSAP, Flip };
