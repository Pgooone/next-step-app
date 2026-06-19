/**
 * T2（第五轮 / D-B4-4）：resolveOrReattachSession 解析器 + lookupProfile + 方案 A 并发锁单测。
 *
 * 全 hermetic：通过 resolver 的 DI 缝（getOwner / lookupProfile / reattach / startGeneric + 注入
 * registry/locks）注入 faux，不触网、不碰进程级 globalThis registry、不起真实内核会话。
 * 验路由分流（reattach vs generic）、容错（NOT_FOUND 落 generic、INVALID 续抛）、root→projectId
 * 反查（含 cwd 两侧 normalizeRoot）、并发去重（同 sessionId 并发只 build 一次）、idle 销毁路径。
 *
 * 锁抽函数（startRpcSessionInner/withStartLock）的零回归由 lib/rpc-manager.test.ts 守。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
import type { AgentSessionWrapper } from "../rpc-manager";
import {
  lookupProfile,
  resolveOrReattachSession,
  type ResolveReattachDeps,
} from "./session-reattach";

// ---------------------------------------------------------------------------
// faux wrapper：仅覆盖断言用到的成员（isAlive / sessionId）。
// 注：AgentSessionWrapper 不公开 getActiveToolNames（仅经 send({type:"get_tools"}) 代理读 inner），
// 故 T2 不在 wrapper 上断言工具名——「走 reattach 还是 generic」由「哪个分支 spy 被调」证明（路由层职责），
// 实际受限工具集装配由 T1 的 reattachProfileSession 单测覆盖。
// ---------------------------------------------------------------------------
function makeFauxWrapper(opts?: { sessionId?: string; alive?: boolean }): AgentSessionWrapper {
  const alive = opts?.alive ?? true;
  return {
    sessionId: opts?.sessionId ?? "faux-real-id",
    isAlive: () => alive,
  } as unknown as AgentSessionWrapper;
}

/** 一对 hermetic registry/locks（不碰 globalThis），与方案 A 共享锁逻辑（withStartLock 用同一对）。 */
function makeLockState(): {
  registry: Map<string, AgentSessionWrapper>;
  locks: NonNullable<ResolveReattachDeps["locks"]>;
} {
  return { registry: new Map(), locks: new Map() };
}

describe("resolveOrReattachSession 路由分流", () => {
  it("AC①：bySession 有 agentId 且 profile 在 → 走 reattach 分支（不走 generic）", async () => {
    const lock = makeLockState();
    const reattach = vi.fn(async () => ({
      session: makeFauxWrapper({ sessionId: "real-reattach" }),
      realSessionId: "real-reattach",
    }));
    const startGeneric = vi.fn(async () => ({
      session: makeFauxWrapper({ sessionId: "real-generic" }),
      realSessionId: "real-generic",
    }));
    const { realSessionId } = await resolveOrReattachSession("sid-1", "/f.jsonl", "/proj", {
      ...lock,
      getOwner: () => "agent-x",
      lookupProfile: () => ({ projectId: "p1", profile: { name: "doc" } as AgentProfile }),
      reattach,
      startGeneric,
    });
    expect(reattach).toHaveBeenCalledTimes(1);
    expect(startGeneric).not.toHaveBeenCalled();
    expect(realSessionId).toBe("real-reattach");
    // reattach 收到对的入参（projectId / projectRoot=cwd / profile / sessionId / filePath）
    expect(reattach).toHaveBeenCalledWith({
      sessionId: "sid-1",
      filePath: "/f.jsonl",
      projectId: "p1",
      projectRoot: "/proj",
      profile: { name: "doc" },
    });
  });

  it("AC②：getOwner 返 null（main 会话）→ 走 generic 分支（不走 reattach）", async () => {
    const lock = makeLockState();
    const reattach = vi.fn();
    const startGeneric = vi.fn(async () => ({
      session: makeFauxWrapper({ sessionId: "real-generic" }),
      realSessionId: "real-generic",
    }));
    const { realSessionId } = await resolveOrReattachSession("main-sid", "/f.jsonl", "/proj", {
      ...lock,
      getOwner: () => null,
      reattach,
      startGeneric,
    });
    expect(startGeneric).toHaveBeenCalledTimes(1);
    expect(startGeneric).toHaveBeenCalledWith("/f.jsonl", "/proj");
    expect(reattach).not.toHaveBeenCalled();
    expect(realSessionId).toBe("real-generic");
  });

  it("AC③：agentId 在但 profile/项目被删（lookupProfile 返 null）→ 落 generic、不抛错", async () => {
    const lock = makeLockState();
    const reattach = vi.fn();
    const startGeneric = vi.fn(async () => ({
      session: makeFauxWrapper(),
      realSessionId: "real-generic",
    }));
    // lookupProfile 内部对 NOT_FOUND 已吞成 null——此处直接返 null 模拟「档案/项目被删」。
    const { realSessionId } = await resolveOrReattachSession("sid-orphan", "/f.jsonl", "/proj", {
      ...lock,
      getOwner: () => "agent-deleted",
      lookupProfile: () => null,
      reattach,
      startGeneric,
    });
    expect(reattach).not.toHaveBeenCalled();
    expect(startGeneric).toHaveBeenCalledTimes(1);
    expect(realSessionId).toBe("real-generic");
  });

  it("活会话快路径：registry 已有 alive wrapper → 直接返回、不 build", async () => {
    const lock = makeLockState();
    const live = makeFauxWrapper({ sessionId: "sid-live", alive: true });
    lock.registry.set("sid-live", live);
    const reattach = vi.fn();
    const startGeneric = vi.fn();
    const { session, realSessionId } = await resolveOrReattachSession(
      "sid-live",
      "/f.jsonl",
      "/proj",
      { ...lock, getOwner: () => "agent-x", reattach, startGeneric },
    );
    expect(session).toBe(live);
    expect(realSessionId).toBe("sid-live");
    expect(reattach).not.toHaveBeenCalled();
    expect(startGeneric).not.toHaveBeenCalled();
  });
});

describe("resolveOrReattachSession 并发去重（方案 A 共享 __piStartLocks）", () => {
  it("AC⑤：同 sessionId 并发两次 → build 只调一次、registry 只一个 wrapper", async () => {
    const lock = makeLockState();
    let resolveBuild: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      resolveBuild = r;
    });
    // 慢 build：制造并发窗口；两次并发 resolver 应共用同一把锁、只触发一次。
    const reattach = vi.fn(async () => {
      await gate;
      const w = makeFauxWrapper({ sessionId: "real-reattach" });
      lock.registry.set("real-reattach", w);
      return { session: w, realSessionId: "real-reattach" };
    });
    const deps: ResolveReattachDeps = {
      ...lock,
      getOwner: () => "agent-x",
      lookupProfile: () => ({ projectId: "p1", profile: { name: "doc" } as AgentProfile }),
      reattach,
    };
    const p1 = resolveOrReattachSession("sid-concurrent", "/f.jsonl", "/proj", deps);
    const p2 = resolveOrReattachSession("sid-concurrent", "/f.jsonl", "/proj", deps);
    // 锁表此刻应只有一个 inflight（两次共用）
    expect(lock.locks.size).toBe(1);
    resolveBuild!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(reattach).toHaveBeenCalledTimes(1); // build 只调一次
    expect(r1.session).toBe(r2.session); // 两次拿到同一个 wrapper
    expect(lock.registry.size).toBe(1);
    expect(lock.locks.size).toBe(0); // finally 摘除
  });
});

describe("resolveOrReattachSession idle 销毁路径", () => {
  it("AC⑥：wrapper destroy 后从 registry 摘除 → resolver 仍走 reattach（与 dev 重启同路）", async () => {
    const lock = makeLockState();
    // 模拟 idle 销毁：registry 里没有该 sessionId（已被 onDestroy 摘除）。
    const reattach = vi.fn(async () => ({
      session: makeFauxWrapper({ sessionId: "real-reattach" }),
      realSessionId: "real-reattach",
    }));
    const startGeneric = vi.fn();
    const { realSessionId } = await resolveOrReattachSession("sid-destroyed", "/f.jsonl", "/proj", {
      ...lock,
      getOwner: () => "agent-x",
      lookupProfile: () => ({ projectId: "p1", profile: { name: "doc" } as AgentProfile }),
      reattach,
      startGeneric,
    });
    expect(reattach).toHaveBeenCalledTimes(1);
    expect(startGeneric).not.toHaveBeenCalled();
    expect(realSessionId).toBe("real-reattach");
  });

  it("不活会话（registry 有但 isAlive=false）→ 不走快路径、重建", async () => {
    const lock = makeLockState();
    const dead = makeFauxWrapper({ sessionId: "sid-dead", alive: false });
    lock.registry.set("sid-dead", dead);
    const reattach = vi.fn(async () => ({
      session: makeFauxWrapper({ sessionId: "real-new" }),
      realSessionId: "real-new",
    }));
    const { session } = await resolveOrReattachSession("sid-dead", "/f.jsonl", "/proj", {
      ...lock,
      getOwner: () => "agent-x",
      lookupProfile: () => ({ projectId: "p1", profile: { name: "doc" } as AgentProfile }),
      reattach,
    });
    expect(reattach).toHaveBeenCalledTimes(1);
    expect(session).not.toBe(dead);
  });
});

// ---------------------------------------------------------------------------
// AC④：lookupProfile 纯逻辑 —— root→projectId 命中/未命中（含 cwd 两侧 normalizeRoot）+ 容错。
// 用 tmpdir 的 ProjectRegistry/AgentProfileStore，hermetic。
// ---------------------------------------------------------------------------
describe("lookupProfile：root→projectId 反查 + normalizeRoot + 容错（AC④）", () => {
  let dir: string;
  let registry: ProjectRegistry;
  let store: AgentProfileStore;
  let projectId: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ns-t2-"));
    registry = new ProjectRegistry(join(dir, "projects.json"));
    projectId = registry.create({ name: "proj", root: dir }).id;
    store = new AgentProfileStore(registry);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("命中：cwd === project.root → 返回 projectId + 档案", () => {
    const profile = store.create(projectId, { name: "doc" });
    const found = lookupProfile(dir, profile.id, { registry, store });
    expect(found).not.toBeNull();
    expect(found!.projectId).toBe(projectId);
    expect(found!.profile.id).toBe(profile.id);
  });

  it("命中（cwd 为相对路径）：两侧 normalizeRoot 后命中（normalizeRoot 真正消除的差异）", () => {
    const profile = store.create(projectId, { name: "doc" });
    // project.root 是绝对路径；构造一个会被 resolve 成同一绝对路径的相对 cwd。
    // 这是 normalizeRoot 真正归一化的差异（~ 展开 / 相对→绝对）；尾斜杠不在其内（见下条 + 报告）。
    const relCwd = relative(process.cwd(), dir);
    const found = lookupProfile(relCwd, profile.id, { registry, store });
    expect(found).not.toBeNull();
    expect(found!.projectId).toBe(projectId);
  });

  it("边界记录：normalizeRoot 不消除尾斜杠（isAbsolute 短路、不走 resolve）→ 带尾斜杠 cwd 漏命中", () => {
    // 这不是 bug、是 normalizeRoot 的真实语义（project-registry.ts:38-43）。实践中 header.cwd 经内核
    // resolvePath 已去尾斜杠、project.root 经 normalizeRoot 亦无尾斜杠，故真实路径两侧均无尾斜杠、相等。
    // 本条把「normalizeRoot 单独不处理尾斜杠」钉成回归基线，提示后续若要更强归一化需显式改 lookupProfile。
    const profile = store.create(projectId, { name: "doc" });
    const found = lookupProfile(`${dir}/`, profile.id, { registry, store });
    expect(found).toBeNull(); // normalizeRoot("/x/") !== normalizeRoot("/x")
  });

  it("未命中：cwd 不在任何注册项目下 → null（落 generic）", () => {
    const found = lookupProfile("/nonexistent/other/path", "agent-x", { registry, store });
    expect(found).toBeNull();
  });

  it("容错：projectId 命中但 agent 档案不存在（get throw NOT_FOUND）→ null、不抛错", () => {
    const found = lookupProfile(dir, "agent-never-created", { registry, store });
    expect(found).toBeNull();
  });

  it("续抛：projects.json 损坏（list throw INVALID）→ 续抛、不静默吞", () => {
    writeFileSync(join(dir, "projects.json"), "{ 这不是合法 JSON", "utf-8");
    expect(() => lookupProfile(dir, "agent-x", { registry, store })).toThrow();
  });
});
