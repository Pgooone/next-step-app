import { describe, expect, it } from "vitest";
import { pickMainOnSessionCreated, pickSessionToRestoreOnEnter } from "./main-session";
import type { SessionMap } from "./domain/session-agent-map";

const map = (mainSessionId: string | null): SessionMap => ({
  mainSessionId,
  bySession: {},
  mastermindSessions: [],
});

describe("pickMainOnSessionCreated", () => {
  it("无主对话 + 新会话落地 → 返回该会话 id（认作主对话）", () => {
    expect(pickMainOnSessionCreated(map(null), "s1")).toBe("s1");
  });

  it("已有主对话 → 返回 null（不抢占既有主对话）", () => {
    expect(pickMainOnSessionCreated(map("existing"), "s1")).toBeNull();
  });

  it("新会话 id 为空/未定义 → 返回 null（无可认定）", () => {
    expect(pickMainOnSessionCreated(map(null), null)).toBeNull();
    expect(pickMainOnSessionCreated(map(null), undefined)).toBeNull();
    expect(pickMainOnSessionCreated(map(null), "")).toBeNull();
  });
});

describe("pickSessionToRestoreOnEnter", () => {
  it("URL 指定会话 → 最优先返回它（即使有主对话）", () => {
    expect(pickSessionToRestoreOnEnter(map("main1"), "url1")).toBe("url1");
  });

  it("无 URL 会话 → 返回主对话 id", () => {
    expect(pickSessionToRestoreOnEnter(map("main1"), null)).toBe("main1");
    expect(pickSessionToRestoreOnEnter(map("main1"), undefined)).toBe("main1");
    expect(pickSessionToRestoreOnEnter(map("main1"), "")).toBe("main1");
  });

  it("无 URL 会话 + 无主对话 → 返回 null（走默认 cwd / 新建态）", () => {
    expect(pickSessionToRestoreOnEnter(map(null), null)).toBeNull();
    expect(pickSessionToRestoreOnEnter(map(null), "")).toBeNull();
  });
});
