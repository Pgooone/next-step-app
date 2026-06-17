import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "./useToastStore";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("show：弹一条并返回唯一 id", () => {
  it("写入 toasts，返回递增 id，多条堆叠且 id 不重复", () => {
    const id1 = useToastStore.getState().show({ type: "success", message: "甲" });
    const id2 = useToastStore.getState().show({ type: "error", message: "乙" });

    expect(id1).not.toBe(id2);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(2);
    expect(toasts.map((t) => t.message)).toEqual(["甲", "乙"]);
    expect(toasts[0]).toMatchObject({ id: id1, type: "success" });
    expect(toasts[1]).toMatchObject({ id: id2, type: "error" });
  });
});

describe("自动消失计时", () => {
  it("success 到 3.2s 后自动移除", () => {
    useToastStore.getState().show({ type: "success", message: "x" });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(3199);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("error 停留更久（3.2s 时仍在，5s 后消失）", () => {
    useToastStore.getState().show({ type: "error", message: "boom" });
    vi.advanceTimersByTime(3200);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1800);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe("dismiss：手动关闭", () => {
  it("按 id 移除指定条，不影响其它", () => {
    const id1 = useToastStore.getState().show({ type: "success", message: "甲" });
    const id2 = useToastStore.getState().show({ type: "success", message: "乙" });

    useToastStore.getState().dismiss(id1);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(id2);
  });

  it("手动 dismiss 后清除其自动计时器（不会二次触发报错/误删后来同位条）", () => {
    const id = useToastStore.getState().show({ type: "success", message: "x" });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    // 推进到原本的自动消失点：计时器应已被清，state 不应被再次改动
    expect(() => vi.advanceTimersByTime(4000)).not.toThrow();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("dismiss 不存在的 id 是安全的 no-op", () => {
    useToastStore.getState().show({ type: "success", message: "x" });
    expect(() => useToastStore.getState().dismiss(999999)).not.toThrow();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe("toast 便捷封装", () => {
  it("toast.success / error / warning 映射到对应类型", () => {
    toast.success("a");
    toast.error("b");
    toast.warning("c");
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual([
      "success",
      "error",
      "warning",
    ]);
  });
});
