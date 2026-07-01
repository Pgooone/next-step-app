/**
 * run-controllers 进程级「runId → AbortController」注册表单测。
 *
 * 覆盖 set/get/delete 基本语义 + **AC-2.5 承重（resume 重建 controller）**：pause 时 approve/resume 的
 * `.finally(deleteRunController)` 已删 controller，resume 须 new AbortController + setRunController 重建、
 * 且 getRunController 返回**新** controller（旧的已失效）——证「删后可再注册」这条 resume 依赖的机制成立。
 * 挂 globalThis 单例，afterEach 清理避免用例间串扰。
 */
import { afterEach, describe, expect, it } from "vitest";

import { setRunController, getRunController, deleteRunController } from "./run-controllers";

afterEach(() => {
  // 清理本测试注册的 controller，避免 globalThis 单例跨用例串扰。
  for (const id of ["r1", "r-resume", "r-abort"]) deleteRunController(id);
});

describe("run-controllers set/get/delete", () => {
  it("set 后 get 返回同一 controller；delete 后 get 返 undefined", () => {
    const c = new AbortController();
    setRunController("r1", c);
    expect(getRunController("r1")).toBe(c);
    deleteRunController("r1");
    expect(getRunController("r1")).toBeUndefined();
  });

  it("未注册的 runId → get 返 undefined（cancel 路由 ?. no-op 依赖）", () => {
    expect(getRunController("never-registered")).toBeUndefined();
  });
});

describe("AC-2.5 resume 重建 controller（删后可再注册、返回新的）", () => {
  it("set→delete（模拟 pause 的 .finally 清理）→ 再 set 新 controller → get 返新的、非旧的", () => {
    const first = new AbortController();
    setRunController("r-resume", first);
    expect(getRunController("r-resume")).toBe(first);

    // 模拟 approve/resume 的 runMastermind .finally(deleteRunController)：pause return 后 controller 被删。
    deleteRunController("r-resume");
    expect(getRunController("r-resume")).toBeUndefined();

    // resume 路由重建：new AbortController + setRunController（对称，承重·D-R8.6-11）。
    const second = new AbortController();
    setRunController("r-resume", second);

    // get 返回**新** controller；abort 新的不影响旧的（各自独立 signal）。
    expect(getRunController("r-resume")).toBe(second);
    expect(getRunController("r-resume")).not.toBe(first);
    second.abort();
    expect(getRunController("r-resume")!.signal.aborted).toBe(true);
    expect(first.signal.aborted).toBe(false); // 旧 controller 未被新 abort 波及
  });
});
