"use client";

import { create } from "zustand";

/** toast 类型：成功 / 失败 / 警告。颜色与默认存活时长由类型决定。 */
export type ToastType = "success" | "error" | "warning";

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

/** 各类型默认存活毫秒：失败停留更久（用户需要读清错误）。 */
const DURATION: Record<ToastType, number> = {
  success: 3200,
  warning: 4000,
  error: 5000,
};

interface ToastState {
  toasts: Toast[];
  /** 弹一条 toast；返回其 id。到点自动消失，也可手动 dismiss。 */
  show: (toast: { type: ToastType; message: string }) => number;
  /** 手动关闭某条（清除其自动消失计时）。 */
  dismiss: (id: number) => void;
}

let seq = 0;
/** 自动消失计时器表（不放进 state：非渲染数据，且需在 dismiss/卸载时清除）。 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number) {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: ({ type, message }) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    const timer = setTimeout(() => get().dismiss(id), DURATION[type]);
    timers.set(id, timer);
    return id;
  },

  dismiss: (id) => {
    clearTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 便捷封装：组件里 `toast.success("…")` 比 `useToastStore.getState().show({...})` 短。 */
export const toast = {
  success: (message: string) => useToastStore.getState().show({ type: "success", message }),
  error: (message: string) => useToastStore.getState().show({ type: "error", message }),
  warning: (message: string) => useToastStore.getState().show({ type: "warning", message }),
};
