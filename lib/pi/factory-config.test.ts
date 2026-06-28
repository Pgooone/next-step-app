/**
 * factory-config 单测（V1.2 第七轮 T5 / D-V1.2-41）——「全局并发上限」读盘容错。
 *
 * 用例 1-10 测 `readMaxConcurrent` 本体：`vi.mock("node:fs")` 控 existsSync/readFileSync，
 * **不能** mock 被测函数自己（否则测不到真实现）。`acquireSlot` 接线（用例 11）放
 * `factory-config-wiring.test.ts`（单独 `vi.mock("./factory-config")`），与本文件 mock 隔离，
 * 避免 mock 串味（lead 修正第 3 条：1-10 不可被 factory-config 整体替身污染成假绿）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_MAX, HARD_CAP, readMaxConcurrent } from "./factory-config";

const mockExists = vi.mocked(existsSync);
// 生产代码只调 readFileSync(file, "utf-8")（返回 string）；按 string 重载收窄，
// 避免 vi.mocked 推到 Buffer 重载后 mockReturnValue 校验 NonSharedBuffer 失败。
const mockRead = vi.mocked(readFileSync as (path: string, enc: string) => string);

/** 模拟「文件存在且内容为 content」。 */
function withFile(content: string) {
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue(content);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readMaxConcurrent", () => {
  it("1. 缺省：文件不存在 → DEFAULT_MAX(3)", () => {
    mockExists.mockReturnValue(false);
    expect(readMaxConcurrent()).toBe(DEFAULT_MAX);
    expect(readMaxConcurrent()).toBe(3);
  });

  it("2. 空文件（trim 后空）→ 3", () => {
    withFile("   \n  ");
    expect(readMaxConcurrent()).toBe(3);
  });

  it("3. 损坏-JSON 解析失败 → 3（不抛）", () => {
    withFile("{ not json");
    expect(() => readMaxConcurrent()).not.toThrow();
    expect(readMaxConcurrent()).toBe(3);
  });

  it("4. 损坏-顶层非对象（数字/null/数组）→ 3", () => {
    for (const raw of ["42", "null", "[]"]) {
      withFile(raw);
      expect(readMaxConcurrent()).toBe(3);
    }
  });

  it("5. 损坏-字段缺失 / 非数字（字符串）→ 3", () => {
    withFile(JSON.stringify({ foo: 1 }));
    expect(readMaxConcurrent()).toBe(3);
    withFile(JSON.stringify({ maxConcurrentSessions: "5" }));
    expect(readMaxConcurrent()).toBe(3);
  });

  it("6. 非整数 / Infinity（小数 2.7 / 1e309→Infinity）→ 3", () => {
    withFile(JSON.stringify({ maxConcurrentSessions: 2.7 }));
    expect(readMaxConcurrent()).toBe(3);
    // 1e309 写进 JSON 字面量合法、parse 出 Infinity，Number.isInteger(Infinity)===false → 回退。
    withFile('{ "maxConcurrentSessions": 1e309 }');
    expect(readMaxConcurrent()).toBe(3);
  });

  it("7. 越界 clamp 下界：0 / -5 → 1", () => {
    withFile(JSON.stringify({ maxConcurrentSessions: 0 }));
    expect(readMaxConcurrent()).toBe(1);
    withFile(JSON.stringify({ maxConcurrentSessions: -5 }));
    expect(readMaxConcurrent()).toBe(1);
  });

  it("8. 越界 clamp 上界：500 → HARD_CAP(100)", () => {
    withFile(JSON.stringify({ maxConcurrentSessions: 500 }));
    expect(readMaxConcurrent()).toBe(HARD_CAP);
    expect(readMaxConcurrent()).toBe(100);
  });

  it("9. 合法正常值：5 → 5", () => {
    withFile(JSON.stringify({ maxConcurrentSessions: 5 }));
    expect(readMaxConcurrent()).toBe(5);
  });

  it("10. 边界值：1 → 1、100 → 100（取本身，= 新 HARD_CAP 上界）", () => {
    withFile(JSON.stringify({ maxConcurrentSessions: 1 }));
    expect(readMaxConcurrent()).toBe(1);
    withFile(JSON.stringify({ maxConcurrentSessions: 100 }));
    expect(readMaxConcurrent()).toBe(100);
  });
});
