import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMain,
  getOwner,
  isMastermind,
  markMastermind,
  pruneMissing,
  readMap,
  removeOwner,
  sessionsForAgent,
  setMain,
  setOwner,
  type SessionMap,
} from "./session-agent-map";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "ns-sessmap-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const mapFile = () => join(cwd, ".pi", "ns-session-map.json");

describe("session-agent-map · 文件不存在", () => {
  it("readMap 在文件不存在时返回空映射", () => {
    expect(readMap(cwd)).toEqual({ mainSessionId: null, bySession: {}, mastermindSessions: [] });
  });

  it("getOwner / getMain 在无映射时返回 null", () => {
    expect(getOwner(cwd, "s1")).toBeNull();
    expect(getMain(cwd)).toBeNull();
  });
});

describe("session-agent-map · 持久化往返", () => {
  it("setOwner 写入后读回一致（含跨实例读，证落盘）", () => {
    setOwner(cwd, "s1", "agent-A");
    expect(getOwner(cwd, "s1")).toBe("agent-A");
    // 直接重新 readMap（不复用内存）证明确实写盘
    expect(readMap(cwd).bySession).toEqual({ s1: "agent-A" });
  });

  it("setMain 写入后读回一致", () => {
    setMain(cwd, "main-1");
    expect(getMain(cwd)).toBe("main-1");
    expect(readMap(cwd).mainSessionId).toBe("main-1");
  });

  it("owner 与 main 并存、互不干扰", () => {
    setMain(cwd, "main-1");
    setOwner(cwd, "s1", "agent-A");
    setOwner(cwd, "s2", "agent-B");
    const map = readMap(cwd);
    expect(map.mainSessionId).toBe("main-1");
    expect(map.bySession).toEqual({ s1: "agent-A", s2: "agent-B" });
  });
});

describe("session-agent-map · 增删 owner / main", () => {
  it("setOwner 覆盖同一会话的旧归属", () => {
    setOwner(cwd, "s1", "agent-A");
    setOwner(cwd, "s1", "agent-B");
    expect(getOwner(cwd, "s1")).toBe("agent-B");
  });

  it("removeOwner 删除某会话归属，其余保留", () => {
    setOwner(cwd, "s1", "agent-A");
    setOwner(cwd, "s2", "agent-B");
    removeOwner(cwd, "s1");
    expect(getOwner(cwd, "s1")).toBeNull();
    expect(getOwner(cwd, "s2")).toBe("agent-B");
  });

  it("removeOwner 对不存在的会话无副作用", () => {
    setOwner(cwd, "s1", "agent-A");
    removeOwner(cwd, "nope");
    expect(readMap(cwd).bySession).toEqual({ s1: "agent-A" });
  });

  it("setMain(null) 清除主对话", () => {
    setMain(cwd, "main-1");
    setMain(cwd, null);
    expect(getMain(cwd)).toBeNull();
  });
});

describe("session-agent-map · sessionsForAgent 反查（方案B 逐出用）", () => {
  it("找全某 agent 名下全部会话（一 agent 多会话）", () => {
    setOwner(cwd, "s1", "agent-A");
    setOwner(cwd, "s2", "agent-A");
    setOwner(cwd, "s3", "agent-B");
    expect(sessionsForAgent(cwd, "agent-A").sort()).toEqual(["s1", "s2"]);
    expect(sessionsForAgent(cwd, "agent-B")).toEqual(["s3"]);
  });

  it("不含主对话（mainSessionId 不在 bySession，零误伤）", () => {
    setMain(cwd, "main-1");
    setOwner(cwd, "s1", "agent-A");
    expect(sessionsForAgent(cwd, "agent-A")).toEqual(["s1"]);
    // 即便查的 id 恰等于 main id 也不会误命中（main 不进 bySession）
    expect(sessionsForAgent(cwd, "main-1")).toEqual([]);
  });

  it("无该 agent / 空映射 → 返回空数组", () => {
    expect(sessionsForAgent(cwd, "ghost")).toEqual([]);
    setOwner(cwd, "s1", "agent-A");
    expect(sessionsForAgent(cwd, "other")).toEqual([]);
  });
});

describe("session-agent-map · 主脑 marker（第 8.6 轮 D-R8.6-09）", () => {
  it("markMastermind 后跨实例 readMap 重读：isMastermind=true + 裸字段含 sid（防 getter/setter typo 双错抵消）", () => {
    markMastermind(cwd, "mm-1");
    // getter
    expect(isMastermind(cwd, "mm-1")).toBe(true);
    expect(isMastermind(cwd, "other")).toBe(false);
    // 裸字段（不复用内存，跨实例重读证落盘）
    expect(readMap(cwd).mastermindSessions).toContain("mm-1");
  });

  it("markMastermind 不碰 bySession（owner-map 红线）", () => {
    setOwner(cwd, "s1", "agent-A");
    markMastermind(cwd, "mm-1");
    expect(readMap(cwd).bySession).toEqual({ s1: "agent-A" }); // 未被 marker 改动
    expect(getOwner(cwd, "s1")).toBe("agent-A");
  });

  it("markMastermind 幂等（同 sid 多次只一条、无副作用）", () => {
    markMastermind(cwd, "mm-1");
    markMastermind(cwd, "mm-1");
    expect(readMap(cwd).mastermindSessions).toEqual(["mm-1"]);
  });

  it("字段保留往返：写含 mastermindSessions 后 setMain/setOwner（RMW）不抹 mastermindSessions", () => {
    markMastermind(cwd, "mm-1");
    // 两个走 readMap→改→writeMap 的 RMW 操作，必须保留 mastermindSessions（命门：readMap 重建保字段）
    setMain(cwd, "main-1");
    setOwner(cwd, "s1", "agent-A");
    const map = readMap(cwd);
    expect(map.mastermindSessions).toEqual(["mm-1"]); // 未被 setMain/setOwner 抹掉
    expect(map.mainSessionId).toBe("main-1");
    expect(map.bySession).toEqual({ s1: "agent-A" });
  });

  it("pruneMissing：已死的主脑 sid 从 mastermindSessions 剔除、存活保留", () => {
    const map: SessionMap = {
      mainSessionId: null,
      bySession: {},
      mastermindSessions: ["alive-mm", "dead-mm"],
    };
    const pruned = pruneMissing(map, new Set(["alive-mm"]));
    expect(pruned.mastermindSessions).toEqual(["alive-mm"]);
  });
});

describe("session-agent-map · 惰性清理（pruneMissing 纯函数）", () => {
  it("丢弃 bySession 中已不存在的会话项，存活项保留", () => {
    const map: SessionMap = {
      mainSessionId: null,
      bySession: { s1: "agent-A", s2: "agent-B", dead: "agent-C" },
      mastermindSessions: [],
    };
    const pruned = pruneMissing(map, new Set(["s1", "s2"]));
    expect(pruned.bySession).toEqual({ s1: "agent-A", s2: "agent-B" });
  });

  it("mainSessionId 已不存在时清为 null", () => {
    const map: SessionMap = { mainSessionId: "dead", bySession: {}, mastermindSessions: [] };
    expect(pruneMissing(map, new Set(["alive"])).mainSessionId).toBeNull();
  });

  it("mainSessionId 仍存活时保留", () => {
    const map: SessionMap = { mainSessionId: "alive", bySession: {}, mastermindSessions: [] };
    expect(pruneMissing(map, new Set(["alive"])).mainSessionId).toBe("alive");
  });

  it("存活集合为空时清空所有项（映射不残留）", () => {
    const map: SessionMap = {
      mainSessionId: "main-1",
      bySession: { s1: "agent-A" },
      mastermindSessions: [],
    };
    expect(pruneMissing(map, new Set())).toEqual({
      mainSessionId: null,
      bySession: {},
      mastermindSessions: [],
    });
  });

  it("pruneMissing 不修改入参（纯函数）", () => {
    const map: SessionMap = { mainSessionId: "m", bySession: { s1: "a", dead: "b" }, mastermindSessions: [] };
    pruneMissing(map, new Set(["s1"]));
    expect(map.bySession).toEqual({ s1: "a", dead: "b" });
    expect(map.mainSessionId).toBe("m");
  });
});

describe("session-agent-map · 原子写", () => {
  it("写入后 .pi 目录不残留 .tmp 临时文件", () => {
    setOwner(cwd, "s1", "agent-A");
    setMain(cwd, "main-1");
    const piDir = join(cwd, ".pi");
    const leftovers = readdirSync(piDir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(existsSync(mapFile())).toBe(true);
  });
});

describe("session-agent-map · 损坏文件兜底", () => {
  it("内容损坏时 readMap 回退空映射（不抛）", () => {
    setOwner(cwd, "s1", "agent-A");
    // 写入损坏内容
    writeFileSync(mapFile(), "{ not json", "utf-8");
    expect(readMap(cwd)).toEqual({ mainSessionId: null, bySession: {}, mastermindSessions: [] });
  });
});
