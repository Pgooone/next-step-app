"use client";

import { useToastStore, type ToastType } from "@/lib/stores/useToastStore";

/** 各类型的强调色（左边条 + 图标）；背景统一用面板色，适配深浅色。 */
const ACCENT: Record<ToastType, string> = {
  success: "#16a34a",
  error: "#dc2626",
  warning: "#d97706",
};

const ICON: Record<ToastType, string> = {
  success: "M20 6 9 17l-5-5",
  error: "M18 6 6 18M6 6l12 12",
  warning: "M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
};

/**
 * 全局 toast 渲染器：固定右下角、多条向上堆叠。
 * 挂载于 app/layout.tsx（独立 client 组件，不污染 server layout）。
 * 卸载安全：仅订阅 store，无自管副作用；计时器由 store 持有。
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 8,
        maxWidth: "calc(100vw - 32px)",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            width: 320,
            maxWidth: "100%",
            padding: "10px 12px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${ACCENT[t.type]}`,
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            fontSize: 12,
            color: "var(--text)",
            pointerEvents: "auto",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke={ACCENT[t.type]}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginTop: 1 }}
          >
            <path d={ICON[t.type]} />
          </svg>
          <span style={{ flex: 1, lineHeight: 1.45, wordBreak: "break-word" }}>{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="关闭"
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--text-dim)",
              lineHeight: 1,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
