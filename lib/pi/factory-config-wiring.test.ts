/**
 * factory-config ↔ acquireSlot 接线单测（用例 11，T5 盲区补）。
 *
 * 现有 concurrency-gate.test.ts 三个用例都**显式传 limit**、绕开 `?? readMaxConcurrent()` 默认分支，
 * 故无证据证明「不传 limit 时 acquireSlot 真读了 readMaxConcurrent」。本文件单独
 * `vi.mock("./factory-config", () => ({ readMaxConcurrent: () => 5 }))`，与 factory-config.test.ts
 * 的 node:fs mock **彻底隔离**（不同文件、各自 file-scoped hoist），坐实 concurrency-gate.ts:40 新分支真被走到。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./factory-config", () => ({
  readMaxConcurrent: () => 5,
}));

import { acquireSlot } from "./concurrency-gate";

describe("acquireSlot 接线 readMaxConcurrent（不传 limit）", () => {
  it("11a. 活跃 4 < 配置 5 → 立即放行（默认源真取自 readMaxConcurrent）", async () => {
    await expect(
      acquireSlot({ activeCount: () => 4, timeoutMs: 200, pollMs: 5 }),
    ).resolves.toBeUndefined();
  });

  it("11b. 活跃 5 ≥ 配置 5 → 拦截、超时抛错", async () => {
    await expect(
      acquireSlot({ activeCount: () => 5, timeoutMs: 40, pollMs: 5 }),
    ).rejects.toThrow(/上限 5/);
  });
});
