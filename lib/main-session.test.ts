import { describe, expect, it } from "vitest";
import { pickMainOnSessionCreated } from "./main-session";
import type { SessionMap } from "./domain/session-agent-map";

const map = (mainSessionId: string | null): SessionMap => ({
  mainSessionId,
  bySession: {},
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
