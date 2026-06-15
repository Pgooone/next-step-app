/**
 * 并发闸门单测（AC⑤ ≤3）：用桩计数器脱离进程级 registry。
 * - 活跃数 < limit → 立即放行；
 * - 活跃数 ≥ limit → 等待，待计数降下后放行；
 * - 持续 ≥ limit → 超时抛错。
 */
import { describe, expect, it } from "vitest";

import { acquireSlot } from "./concurrency-gate";

describe("acquireSlot", () => {
  it("活跃数 < limit → 立即放行", async () => {
    const count = 1;
    await expect(
      acquireSlot({ activeCount: () => count, limit: 3, timeoutMs: 1000, pollMs: 5 }),
    ).resolves.toBeUndefined();
    expect(count).toBe(1); // 不改变计数（计数源是外部 registry）
  });

  it("活跃数 ≥ limit 但随后降下 → 等待后放行", async () => {
    let count = 3;
    const p = acquireSlot({ activeCount: () => count, limit: 3, timeoutMs: 1000, pollMs: 5 });
    // 一小会后释放一个槽
    setTimeout(() => {
      count = 2;
    }, 30);
    await expect(p).resolves.toBeUndefined();
  });

  it("活跃数持续 ≥ limit → 超时抛错", async () => {
    const count = 5;
    await expect(
      acquireSlot({ activeCount: () => count, limit: 3, timeoutMs: 40, pollMs: 5 }),
    ).rejects.toThrow(/上限/);
  });
});
