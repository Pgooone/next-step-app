import { describe, expect, it } from "vitest";
import { groupSessionsByOwner, makeAgentResolver } from "./session-grouping";
import type { SessionInfo } from "./types";
import type { SessionMap } from "./domain/session-agent-map";
import type { AgentProfile } from "./domain/agent-profile-store";

/** 造一条最小 SessionInfo（只填分组用到的字段）。 */
function sess(id: string): SessionInfo {
  return {
    id,
    path: `/x/${id}.jsonl`,
    cwd: "/proj",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

/** 造一个最小 AgentProfile（只填 id/name）。 */
function agent(id: string, name: string): AgentProfile {
  return {
    id,
    projectId: "p",
    name,
    role: "",
    model: "",
    skills: [],
    tools: [],
    thinkingLevel: "off",
    agentMdPath: "",
    memoryPath: "",
  };
}

/** 测试用 resolver：固定色，名取自表。 */
const resolver =
  (names: Record<string, string>) => (agentId: string) =>
    names[agentId] ? { name: names[agentId], color: "#abc" } : null;

describe("groupSessionsByOwner", () => {
  it("空映射 → 全部进 others，main 为 null，无 agent 分组", () => {
    const sessions = [sess("a"), sess("b")];
    const map: SessionMap = { mainSessionId: null, bySession: {} };
    const g = groupSessionsByOwner(sessions, map, resolver({}));
    expect(g.main).toBeNull();
    expect(g.agentGroups).toEqual([]);
    expect(g.others.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("mainSessionId 命中 → 进 main 区、不进其它区", () => {
    const sessions = [sess("main"), sess("x")];
    const map: SessionMap = { mainSessionId: "main", bySession: {} };
    const g = groupSessionsByOwner(sessions, map, resolver({}));
    expect(g.main?.id).toBe("main");
    expect(g.others.map((s) => s.id)).toEqual(["x"]);
  });

  it("主对话即便也有 owner，也只进 main 区（不重复进 agent 分组）", () => {
    const sessions = [sess("m")];
    const map: SessionMap = { mainSessionId: "m", bySession: { m: "agent-1" } };
    const g = groupSessionsByOwner(sessions, map, resolver({ "agent-1": "甲" }));
    expect(g.main?.id).toBe("m");
    expect(g.agentGroups).toEqual([]);
    expect(g.others).toEqual([]);
  });

  it("mainSessionId 指向不在列表中的会话 → main 为 null（惰性容错）", () => {
    const sessions = [sess("a")];
    const map: SessionMap = { mainSessionId: "ghost", bySession: {} };
    const g = groupSessionsByOwner(sessions, map, resolver({}));
    expect(g.main).toBeNull();
    expect(g.others.map((s) => s.id)).toEqual(["a"]);
  });

  it("按 agent 聚合，每组带名/色，组内保留原顺序", () => {
    const sessions = [sess("s1"), sess("s2"), sess("s3")];
    const map: SessionMap = {
      mainSessionId: null,
      bySession: { s1: "agent-A", s2: "agent-A", s3: "agent-B" },
    };
    const g = groupSessionsByOwner(sessions, map, resolver({ "agent-A": "阿尔法", "agent-B": "贝塔" }));
    const a = g.agentGroups.find((x) => x.agentId === "agent-A")!;
    expect(a.agentName).toBe("阿尔法");
    expect(a.color).toBe("#abc");
    expect(a.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    const b = g.agentGroups.find((x) => x.agentId === "agent-B")!;
    expect(b.sessions.map((s) => s.id)).toEqual(["s3"]);
    expect(g.others).toEqual([]);
  });

  it("agent 档案缺失 → 名回退 agentId 短串、色为 null", () => {
    const sessions = [sess("s1")];
    const map: SessionMap = { mainSessionId: null, bySession: { s1: "deadbeef-uuid-1234" } };
    const g = groupSessionsByOwner(sessions, map, resolver({}));
    expect(g.agentGroups[0].agentName).toBe("deadbeef");
    expect(g.agentGroups[0].color).toBeNull();
  });

  it("agent 分组按名升序稳定排序", () => {
    const sessions = [sess("s1"), sess("s2"), sess("s3")];
    const map: SessionMap = {
      mainSessionId: null,
      bySession: { s1: "id-c", s2: "id-a", s3: "id-b" },
    };
    const g = groupSessionsByOwner(
      sessions,
      map,
      resolver({ "id-a": "Charlie", "id-b": "Alpha", "id-c": "Bravo" }),
    );
    expect(g.agentGroups.map((x) => x.agentName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("三区并存：main + agent 分组 + others", () => {
    const sessions = [sess("m"), sess("a1"), sess("o1"), sess("o2")];
    const map: SessionMap = { mainSessionId: "m", bySession: { a1: "agent-1" } };
    const g = groupSessionsByOwner(sessions, map, resolver({ "agent-1": "甲" }));
    expect(g.main?.id).toBe("m");
    expect(g.agentGroups).toHaveLength(1);
    expect(g.agentGroups[0].sessions.map((s) => s.id)).toEqual(["a1"]);
    expect(g.others.map((s) => s.id)).toEqual(["o1", "o2"]);
  });
});

describe("makeAgentResolver", () => {
  it("按 id 解析出名 + 调 colorOf 取色", () => {
    const agents = [agent("id-1", "甲"), agent("id-2", "乙")];
    const resolve = makeAgentResolver(agents, (name) => `color-of-${name}`);
    expect(resolve("id-1")).toEqual({ name: "甲", color: "color-of-甲" });
    expect(resolve("id-2")).toEqual({ name: "乙", color: "color-of-乙" });
  });

  it("查不到 id → null", () => {
    const resolve = makeAgentResolver([agent("id-1", "甲")], (n) => n);
    expect(resolve("nope")).toBeNull();
  });
});
