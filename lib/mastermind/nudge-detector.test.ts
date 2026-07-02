import { describe, expect, it } from "vitest";
import { computeNudges, type ComputeNudgesResult, type NudgeSnapshot } from "./nudge-detector";
import type {
  MastermindRun,
  MastermindRunStatus,
  MastermindStage,
  MastermindStageStatus,
} from "@/lib/domain/mastermind-run-store";

// ── fixtures ──────────────────────────────────────────────────────────────

/** 造一个 stage（只填 nudge-detector 关心的 order/agentName/status）。 */
function stage(order: number, status: MastermindStageStatus, agentName = `role${order}-deadbeef`): MastermindStage {
  return {
    order,
    agentId: `a${order}`,
    agentName,
    subTask: `task ${order}`,
    status,
    sessionId: null,
    artifactId: null,
    startedAt: null,
    finishedAt: null,
    retryCount: 0,
  };
}

/** 造一个 run（stageStatuses 顺序对应 order 1..N；roles 可选喂 plan.teammates[i].role）。 */
function run(
  id: string,
  status: MastermindRunStatus,
  stageStatuses: MastermindStageStatus[],
  roles?: string[],
): MastermindRun {
  return {
    id,
    projectId: "p",
    status,
    plan: {
      teammates: stageStatuses.map((_, i) => ({
        name: `n${i + 1}`,
        role: roles?.[i] ?? `role${i + 1}`,
        subTask: `t${i + 1}`,
        acceptanceCriteria: "ac",
      })),
      notes: "",
    },
    stages: stageStatuses.map((s, i) => stage(i + 1, s)),
    currentStageIndex: 0,
    createdAt: "2026-07-02T00:00:00Z",
    finishedAt: null,
    cancelRequested: false,
    failedReason: null,
  };
}

const NO_FIRED = new Set<string>();

/** 便捷断言：只发了一条、message 含指定子串。 */
function expectSingle(res: ComputeNudgesResult, substr: string): void {
  expect(res.nudges).toHaveLength(1);
  expect(res.nudges[0].message).toContain(substr);
}

// ── baseline-first（铁律 1）─────────────────────────────────────────────────

describe("baseline-first：首挂首轮只建基线、零发", () => {
  it("prev=null（含 stage 已 done、run running）→ 零发、快照=当前全量", () => {
    const runs = { r1: run("r1", "running", ["done", "pending"]) };
    const res = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    expect(res.nudges).toEqual([]);
    // 快照含 run + 两个 stage 的当前态。
    expect(res.snapshot["r1:run"]).toBe("running");
    expect(res.snapshot["r1:stage:1"]).toBe("done");
    expect(res.snapshot["r1:stage:2"]).toBe("pending");
  });

  it("prev=null 且 run 早已终态 done（stage 全 done）→ 零发（防历史 done 重放）", () => {
    const runs = { r1: run("r1", "done", ["done", "done"]) };
    const res = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    expect(res.nudges).toEqual([]);
    expect(res.snapshot["r1:run"]).toBe("done");
  });

  it("prev=null 且 run=partial（含 skipped）→ 零发", () => {
    const runs = { r1: run("r1", "partial", ["done", "skipped"]) };
    const res = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    expect(res.nudges).toEqual([]);
  });
});

// ── F5 / 切回模拟（承重命门）───────────────────────────────────────────────

describe("F5/切回模拟：新 detector 实例（prev=null）+ 满载历史 done 的 store → 零发", () => {
  it("刷新后首轮：一条 3 队员全 done 的 run，prev=null → 一条都不发（不重放整串）", () => {
    const runs = { r1: run("r1", "done", ["done", "done", "done"]) };
    // 模拟 remount：prev 归空。
    const res = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    expect(res.nudges).toEqual([]);
  });

  it("刷新后：基线建好，之后 store 冻结（无新翻转）→ 仍零发", () => {
    const runs = { r1: run("r1", "done", ["done", "done"]) };
    const base = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    // 下一 tick：状态没变、prev=基线 → 无翻转。
    const next = computeNudges({ prev: base.snapshot, runs, canFire: true, firedFinal: NO_FIRED });
    expect(next.nudges).toEqual([]);
    expect(next.snapshot).toEqual(base.snapshot);
  });
});

// ── 翻转恰在首轮后发且仅一次 ────────────────────────────────────────────────

describe("stage 翻转 pending/running→done：首轮后发、且仅一次", () => {
  it("baseline 后 stage1 pending→done → 发一条阶段小结（第 1 个队员）", () => {
    const before = { r1: run("r1", "running", ["running", "pending"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "running", ["done", "pending"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "第 1 个队员");
    expect(res.nudges[0].kind).toBe("stage");
    // 快照推进了 stage:1。
    expect(res.snapshot["r1:stage:1"]).toBe("done");
  });

  it("同一 done 不重发：再跑一 tick（状态不变、prev 已推进）→ 零发", () => {
    const before = { r1: run("r1", "running", ["running", "pending"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "running", ["done", "pending"]) };
    const fire = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    const again = computeNudges({ prev: fire.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expect(again.nudges).toEqual([]);
  });

  it("role 优先作显示名（plan.teammates[order-1].role）", () => {
    const before = { r1: run("r1", "running", ["running"], ["日本市场研究员"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "running", ["done"], ["日本市场研究员"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "日本市场研究员");
  });
});

// ── busy hold / 下轮补发（gate 语义）───────────────────────────────────────

describe("canFire=false（主脑忙）：本轮零发、快照原样保留、下轮补发", () => {
  it("翻转发生时忙 → 零发且快照不推进；下轮空闲 → 补发", () => {
    const before = { r1: run("r1", "running", ["running"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: false, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "running", ["done"]) };
    // 忙：零发、快照 == 上轮（未推进）。
    const busy = computeNudges({ prev: base.snapshot, runs: after, canFire: false, firedFinal: NO_FIRED });
    expect(busy.nudges).toEqual([]);
    expect(busy.snapshot).toEqual(base.snapshot);
    // 空闲：补发。
    const free = computeNudges({ prev: busy.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(free, "第 1 个队员");
  });
});

// ── 一 tick 至多一条（铁律 2）+ stage/run 同帧顺序 ──────────────────────────

describe("一 tick 至多发一条：多翻转只发首条、余下留 prev 下轮补发", () => {
  it("两 stage 同帧翻 done → 只发第 1 条（第 1 个队员），第 2 条下轮补", () => {
    const before = { r1: run("r1", "running", ["running", "running"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "running", ["done", "done"]) };
    const first = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(first, "第 1 个队员");
    // 快照只推进 stage:1，stage:2 仍是上轮的 running。
    expect(first.snapshot["r1:stage:1"]).toBe("done");
    expect(first.snapshot["r1:stage:2"]).toBe("running");
    // 下一 tick 补发第 2 条。
    const second = computeNudges({ prev: first.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(second, "第 2 个队员");
  });

  it("stage 与 run 终态同帧翻转 → 先发阶段小结（stage 在 run 前），下轮再发终态汇总", () => {
    // 最后一个 stage 与 run 同帧翻 done（末阶段完成即 run done 常见）。
    const before = { r1: run("r1", "running", ["running"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "done", ["done"]) };
    const first = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(first, "第 1 个队员"); // 阶段小结优先
    expect(first.nudges[0].kind).toBe("stage");
    // run key 未推进（仍 running）；下轮发终态汇总。
    expect(first.snapshot["r1:run"]).toBe("running");
    const second = computeNudges({ prev: first.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(second, "汇总收尾");
    expect(second.nudges[0].kind).toBe("final");
    expect(second.firedFinalKeys).toEqual(["r1:__final__"]);
  });
});

// ── 终态汇总 running→done/partial ─────────────────────────────────────────

describe("run running→done/partial：发终态汇总（带 runId）、含 firedFinalKeys", () => {
  it("running→done → 汇总收尾 + firedFinalKeys=[r1:__final__]", () => {
    // stage 已 done（上轮就 done、非本帧翻），只 run 从 running→done。
    const before = { r1: run("r1", "running", ["done"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "done", ["done"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "汇总收尾");
    expect(res.nudges[0].message).toContain("runId=r1");
    expect(res.firedFinalKeys).toEqual(["r1:__final__"]);
  });

  it("running→partial → 同样发汇总收尾", () => {
    const before = { r1: run("r1", "running", ["done"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "partial", ["done"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "汇总收尾");
  });

  it("firedFinal 已含该 key → 不再发汇总（双保险）", () => {
    const before = { r1: run("r1", "running", ["done"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "done", ["done"]) };
    const res = computeNudges({
      prev: base.snapshot,
      runs: after,
      canFire: true,
      firedFinal: new Set(["r1:__final__"]),
    });
    expect(res.nudges).toEqual([]);
  });
});

// ── resume paused→running→done 只发一次汇总 ────────────────────────────────

describe("resume paused→running→done：汇总只发一次", () => {
  it("完整轨迹：running→paused(提醒)→running→done(汇总一次)，再冻结不重发", () => {
    // baseline：running。
    const s0 = { r1: run("r1", "running", ["done", "running"]) };
    let snapshot: NudgeSnapshot = computeNudges({ prev: null, runs: s0, canFire: true, firedFinal: NO_FIRED }).snapshot;
    const fired = new Set<string>();

    // 1) running→paused → 提醒（非 final、不进 firedFinal）。
    const s1 = { r1: run("r1", "paused", ["done", "failed"]) };
    const r1res = computeNudges({ prev: snapshot, runs: s1, canFire: true, firedFinal: fired });
    expectSingle(r1res, "运行已暂停");
    expect(r1res.firedFinalKeys).toEqual([]);
    snapshot = r1res.snapshot;

    // 2) 用户 resume：paused→running（无关翻转、不发）。
    const s2 = { r1: run("r1", "running", ["done", "running"]) };
    const r2res = computeNudges({ prev: snapshot, runs: s2, canFire: true, firedFinal: fired });
    expect(r2res.nudges).toEqual([]);
    snapshot = r2res.snapshot;

    // 3) 第二 stage 完成 → 阶段小结。
    const s3 = { r1: run("r1", "running", ["done", "done"]) };
    const r3res = computeNudges({ prev: snapshot, runs: s3, canFire: true, firedFinal: fired });
    expectSingle(r3res, "第 2 个队员");
    snapshot = r3res.snapshot;

    // 4) run→done → 汇总一次（关键：prev[run]=paused，仍能触发，因用「首次进入终态」判据）。
    const s4 = { r1: run("r1", "done", ["done", "done"]) };
    const r4res = computeNudges({ prev: snapshot, runs: s4, canFire: true, firedFinal: fired });
    expectSingle(r4res, "汇总收尾");
    expect(r4res.firedFinalKeys).toEqual(["r1:__final__"]);
    for (const k of r4res.firedFinalKeys) fired.add(k);
    snapshot = r4res.snapshot;

    // 5) 冻结再跑：无翻转 + firedFinal 命中 → 零发。
    const r5res = computeNudges({ prev: snapshot, runs: s4, canFire: true, firedFinal: fired });
    expect(r5res.nudges).toEqual([]);
  });
});

// ── paused 发提醒、failed 不发 ─────────────────────────────────────────────

describe("run→paused 发提醒；run→failed（用户主动）不发", () => {
  it("running→paused → 提醒一句", () => {
    const before = { r1: run("r1", "running", ["failed"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "paused", ["failed"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "运行已暂停");
    expect(res.firedFinalKeys).toEqual([]);
  });

  it("running→failed（用户 cancel/reject）→ 零发", () => {
    const before = { r1: run("r1", "running", ["running"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "failed", ["failed"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expect(res.nudges).toEqual([]);
  });

  it("paused 提醒只发一次（首次进入 paused）：再跑一 tick 仍 paused → 零发", () => {
    const before = { r1: run("r1", "running", ["failed"]) };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = { r1: run("r1", "paused", ["failed"]) };
    const fire = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    const again = computeNudges({ prev: fire.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expect(again.nudges).toEqual([]);
  });
});

// ── 多 run 隔离 ────────────────────────────────────────────────────────────

describe("多 run 并存：key 含 runId 天然不串", () => {
  it("两 run 各自 stage 翻 done → 各发各的（一 tick 一条、下轮补另一条），互不污染", () => {
    const before = {
      r1: run("r1", "running", ["running"]),
      r2: run("r2", "running", ["running"]),
    };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    // r1、r2 同帧各翻 done。
    const after = {
      r1: run("r1", "running", ["done"]),
      r2: run("r2", "running", ["done"]),
    };
    const first = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    // runId 排序稳定（r1<r2）→ 先 r1。
    expect(first.nudges).toHaveLength(1);
    expect(first.nudges[0].runId).toBe("r1");
    // r1 快照推进、r2 未动。
    expect(first.snapshot["r1:stage:1"]).toBe("done");
    expect(first.snapshot["r2:stage:1"]).toBe("running");
    const second = computeNudges({ prev: first.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expect(second.nudges).toHaveLength(1);
    expect(second.nudges[0].runId).toBe("r2");
  });

  it("r1 终态汇总的 firedFinal 不影响 r2 汇总", () => {
    const before = {
      r1: run("r1", "running", ["done"]),
      r2: run("r2", "running", ["done"]),
    };
    const base = computeNudges({ prev: null, runs: before, canFire: true, firedFinal: NO_FIRED });
    const after = {
      r1: run("r1", "done", ["done"]),
      r2: run("r2", "done", ["done"]),
    };
    // r1 已发过汇总（firedFinal 含 r1）→ 只该发 r2。
    const res = computeNudges({
      prev: base.snapshot,
      runs: after,
      canFire: true,
      firedFinal: new Set(["r1:__final__"]),
    });
    expect(res.nudges).toHaveLength(1);
    expect(res.nudges[0].runId).toBe("r2");
    expect(res.nudges[0].kind).toBe("final");
  });
});

// ── run 在基线之后才出现（会话中途 submit_plan·ADR D-R8.6-16 修复回归）──────
// 旧实现无翻转时 snapshot 原样返回 prev → 基线后诞生的 run 的 key 永远「首见」、
// 每次翻转都被略过 → nudge 全哑（真浏览器端到端揪出、原单测全绿漏网）。

describe("run 在基线后出现：吸收为自身基线、后续翻转正常发（D-R8.6-16）", () => {
  it("完整序列（verifier repro）：空基线 → run 出现 → stage 翻 done 发小结 → run 翻 done 发汇总", () => {
    // tick1：首挂 messages 未加载、runIds=[] → 空基线。
    const t1 = computeNudges({ prev: null, runs: {}, canFire: true, firedFinal: NO_FIRED });
    expect(t1.nudges).toEqual([]);
    expect(t1.snapshot).toEqual({});
    // tick2：run 出现（running/running）→ 吸收为基线、不发。
    const s2 = { r1: run("r1", "running", ["running", "running"]) };
    const t2 = computeNudges({ prev: t1.snapshot, runs: s2, canFire: true, firedFinal: NO_FIRED });
    expect(t2.nudges).toEqual([]);
    expect(t2.snapshot["r1:run"]).toBe("running"); // 吸收铁证（旧实现这里是 undefined）
    expect(t2.snapshot["r1:stage:2"]).toBe("running");
    // tick3：stage2 翻 done → 发阶段小结（旧实现：永远略过）。
    const s3 = { r1: run("r1", "running", ["running", "done"]) };
    const t3 = computeNudges({ prev: t2.snapshot, runs: s3, canFire: true, firedFinal: NO_FIRED });
    expect(t3.nudges).toHaveLength(1);
    expect(t3.nudges[0].kind).toBe("stage");
    expect(t3.nudges[0].message).toContain("第 2 个队员");
    // tick4：stage1 done + run done → 先补 stage1 小结、再下一 tick 发汇总。
    const s4 = { r1: run("r1", "done", ["done", "done"]) };
    const t4 = computeNudges({ prev: t3.snapshot, runs: s4, canFire: true, firedFinal: NO_FIRED });
    expect(t4.nudges[0].kind).toBe("stage");
    const t5 = computeNudges({ prev: t4.snapshot, runs: s4, canFire: true, firedFinal: NO_FIRED });
    expect(t5.nudges[0].kind).toBe("final");
    expect(t5.firedFinalKeys).toEqual(["r1:__final__"]);
  });

  it("run 出现时 stage 已 done（轮询迟到/历史态）→ 吸收不重放；此后另一 stage 翻 done 只发那一条", () => {
    const base = computeNudges({ prev: null, runs: {}, canFire: true, firedFinal: NO_FIRED });
    // run 首见即带一个 done（历史态）：吸收、不发。
    const s2 = { r1: run("r1", "running", ["done", "running"]) };
    const t2 = computeNudges({ prev: base.snapshot, runs: s2, canFire: true, firedFinal: NO_FIRED });
    expect(t2.nudges).toEqual([]);
    // stage2 翻 done → 只发 stage2（stage1 历史 done 不补发）。
    const s3 = { r1: run("r1", "running", ["done", "done"]) };
    const t3 = computeNudges({ prev: t2.snapshot, runs: s3, canFire: true, firedFinal: NO_FIRED });
    expect(t3.nudges).toHaveLength(1);
    expect(t3.nudges[0].message).toContain("第 2 个队员");
  });

  it("忙（canFire=false）时新 run 出现 → 照样吸收（快照含新 key）；空闲后翻转正常发", () => {
    const base = computeNudges({ prev: null, runs: {}, canFire: true, firedFinal: NO_FIRED });
    const s2 = { r1: run("r1", "running", ["running"]) };
    const busy = computeNudges({ prev: base.snapshot, runs: s2, canFire: false, firedFinal: NO_FIRED });
    expect(busy.nudges).toEqual([]);
    expect(busy.snapshot["r1:stage:1"]).toBe("running"); // 忙时也吸收
    const s3 = { r1: run("r1", "running", ["done"]) };
    const free = computeNudges({ prev: busy.snapshot, runs: s3, canFire: true, firedFinal: NO_FIRED });
    expectSingle(free, "第 1 个队员");
  });

  it("第二个 run 中途加入（多 run 混合）：老 run 挂起翻转不丢、新 run 吸收后翻转可发", () => {
    // 基线：r1 running。
    const s1 = { r1: run("r1", "running", ["running"]) };
    const base = computeNudges({ prev: null, runs: s1, canFire: true, firedFinal: NO_FIRED });
    // r1 翻 done（忙、挂起）+ r2 同 tick 出现。
    const s2 = { r1: run("r1", "running", ["done"]), r2: run("r2", "running", ["running"]) };
    const busy = computeNudges({ prev: base.snapshot, runs: s2, canFire: false, firedFinal: NO_FIRED });
    expect(busy.nudges).toEqual([]);
    expect(busy.snapshot["r1:stage:1"]).toBe("running"); // 挂起翻转保旧值
    expect(busy.snapshot["r2:stage:1"]).toBe("running"); // 新 run 已吸收
    // 空闲：先补 r1 的挂起小结。
    const free1 = computeNudges({ prev: busy.snapshot, runs: s2, canFire: true, firedFinal: NO_FIRED });
    expect(free1.nudges[0].runId).toBe("r1");
    // r2 翻 done → 发 r2。
    const s3 = { r1: run("r1", "running", ["done"]), r2: run("r2", "running", ["done"]) };
    const free2 = computeNudges({ prev: free1.snapshot, runs: s3, canFire: true, firedFinal: NO_FIRED });
    expect(free2.nudges[0].runId).toBe("r2");
  });
});

// ── 未拉回的 run（切片有 key、值 undefined）不崩、不发 ─────────────────────

describe("鲁棒性：runs 切片含未拉回（undefined）的 runId", () => {
  it("undefined run 略过、不崩", () => {
    const runs = { r1: undefined, r2: run("r2", "running", ["running"]) };
    const base = computeNudges({ prev: null, runs, canFire: true, firedFinal: NO_FIRED });
    expect(base.snapshot["r2:run"]).toBe("running");
    expect(base.snapshot["r1:run"]).toBeUndefined();
    // r2 翻 done。
    const after = { r1: undefined, r2: run("r2", "running", ["done"]) };
    const res = computeNudges({ prev: base.snapshot, runs: after, canFire: true, firedFinal: NO_FIRED });
    expectSingle(res, "第 1 个队员");
  });
});
