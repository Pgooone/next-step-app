import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "./project-registry";
import { AgentProfileStore, renderAgentMd, type AgentProfile } from "./agent-profile-store";

let dir: string;
let registry: ProjectRegistry;
let store: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-agent-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  // 注册一个指向该临时 root 的 project，agent 三件套将落在它下面
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * try 调用、catch 断言抛出的是带匹配 .code 的领域错误；未抛出则 fail。
 * 同时覆盖 AgentProfileError 与（project 不存在时的）ProjectError——两者都带 .code。
 */
function expectCode(fn: () => unknown, code: "NOT_FOUND" | "INVALID"): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  expect.fail(`期望抛出 code=${code} 的领域错误，但没有抛出异常`);
}

describe("AgentProfileStore", () => {
  it("create 落三件套：agent.json/agent.md/memory.md，agent.json 含全字段，path 为相对", () => {
    const profile = store.create(projectId, {
      name: "coder",
      role: "写代码",
      model: "claude-opus-4-8",
      skills: ["a", "b"],
      tools: ["read", "write"],
      thinkingLevel: "high",
    });

    expect(profile.id).toHaveLength(36);
    expect(profile.projectId).toBe(projectId);
    expect(profile.name).toBe("coder");
    expect(profile.role).toBe("写代码");
    expect(profile.model).toBe("claude-opus-4-8");
    expect(profile.skills).toEqual(["a", "b"]);
    expect(profile.tools).toEqual(["read", "write"]);
    expect(profile.thinkingLevel).toBe("high");

    // path 为相对（D-20）
    expect(isAbsolute(profile.agentMdPath)).toBe(false);
    expect(isAbsolute(profile.memoryPath)).toBe(false);
    expect(profile.agentMdPath).toBe(join(".pi", "agents", profile.id, "agent.md"));
    expect(profile.memoryPath).toBe(join(".pi", "agents", profile.id, "memory.md"));

    // 三件套确实落盘
    const agentDir = join(dir, ".pi", "agents", profile.id);
    expect(existsSync(join(agentDir, "agent.json"))).toBe(true);
    expect(existsSync(join(agentDir, "agent.md"))).toBe(true);
    expect(existsSync(join(agentDir, "memory.md"))).toBe(true);

    // agent.json 是结构化真相源，含全字段
    const onDisk = JSON.parse(readFileSync(join(agentDir, "agent.json"), "utf-8")) as AgentProfile;
    expect(onDisk).toEqual(profile);
    // agent.md 骨架；memory.md 空（内容不内联进 agent.json，D-21）
    expect(readFileSync(join(agentDir, "agent.md"), "utf-8")).toContain("# coder");
    expect(readFileSync(join(agentDir, "memory.md"), "utf-8")).toBe("");
  });

  it("get 读回与 create 返回一致；agent 不存在抛 NOT_FOUND", () => {
    const created = store.create(projectId, { name: "coder" });
    expect(store.get(projectId, created.id)).toEqual(created);
    expectCode(() => store.get(projectId, "missing"), "NOT_FOUND");
  });

  it("list 返回数组；agents 目录不存在时为空数组", () => {
    expect(store.list(projectId)).toEqual([]);
    const a = store.create(projectId, { name: "alpha" });
    const b = store.create(projectId, { name: "beta" });
    const ids = store.list(projectId).map((p) => p.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("update 改字段并持久化；重名抛 INVALID", () => {
    const a = store.create(projectId, { name: "alpha", role: "旧" });
    store.create(projectId, { name: "beta" });

    const updated = store.update(projectId, a.id, { name: "alpha2", role: "新", thinkingLevel: "low" });
    expect(updated.name).toBe("alpha2");
    expect(updated.role).toBe("新");
    expect(updated.thinkingLevel).toBe("low");
    // 持久化
    expect(store.get(projectId, a.id).name).toBe("alpha2");

    expectCode(() => store.update(projectId, a.id, { name: "beta" }), "INVALID");
    expectCode(() => store.update(projectId, "missing", { role: "x" }), "NOT_FOUND");
  });

  it("remove 后 <id>/ 目录消失；再次 remove 抛 NOT_FOUND", () => {
    const p = store.create(projectId, { name: "coder" });
    const agentDir = join(dir, ".pi", "agents", p.id);
    expect(existsSync(agentDir)).toBe(true);

    store.remove(projectId, p.id);
    // 关键 AC / D-19：删档案删整个目录
    expect(existsSync(agentDir)).toBe(false);
    expect(store.list(projectId)).toEqual([]);

    expectCode(() => store.remove(projectId, p.id), "NOT_FOUND");
  });

  it("project 不存在时 list/create 抛 NOT_FOUND", () => {
    expectCode(() => store.list("no-such-project"), "NOT_FOUND");
    expectCode(() => store.create("no-such-project", { name: "x" }), "NOT_FOUND");
  });

  it("非法 thinkingLevel / 空 name 抛 INVALID", () => {
    expectCode(() => store.create(projectId, { name: "" }), "INVALID");
    expectCode(() => store.create(projectId, { name: "  " }), "INVALID");
    // @ts-expect-error 故意传非法档位
    expectCode(() => store.create(projectId, { name: "x", thinkingLevel: "ultra" }), "INVALID");
  });

  it("同 project 内 name 唯一（重名抛 INVALID）", () => {
    store.create(projectId, { name: "dup" });
    expectCode(() => store.create(projectId, { name: "dup" }), "INVALID");
  });

  // D-B4-6（AC④ bug 根因）：注入读 agent.md 而非 agent.json，故 update 改 name/role
  // 必须同步重写 agent.md，否则编辑后起会话仍注入旧角色。
  describe("renderAgentMd / update 重写 agent.md（D-B4-6）", () => {
    it("renderAgentMd 由 name+role 渲染骨架（# name + 空行 + role）", () => {
      expect(renderAgentMd("coder", "写代码")).toBe("# coder\n\n写代码\n");
      expect(renderAgentMd("空角色", "")).toBe("# 空角色\n\n\n");
    });

    it("create 写的 agent.md 与 renderAgentMd 一致", () => {
      const p = store.create(projectId, { name: "coder", role: "写代码" });
      const onDisk = readFileSync(join(dir, ".pi", "agents", p.id, "agent.md"), "utf-8");
      expect(onDisk).toBe(renderAgentMd("coder", "写代码"));
    });

    it("update 改 role → agent.md 反映新 role（不再停留旧内容）", () => {
      const p = store.create(projectId, { name: "coder", role: "旧角色 OLD" });
      const mdPath = join(dir, ".pi", "agents", p.id, "agent.md");
      expect(readFileSync(mdPath, "utf-8")).toContain("旧角色 OLD");

      store.update(projectId, p.id, { role: "新角色 NEW" });
      const after = readFileSync(mdPath, "utf-8");
      expect(after).toContain("新角色 NEW");
      expect(after).not.toContain("旧角色 OLD");
      expect(after).toBe(renderAgentMd("coder", "新角色 NEW"));
    });

    it("update 改 name → agent.md 标题反映新 name", () => {
      const p = store.create(projectId, { name: "old-name", role: "r" });
      store.update(projectId, p.id, { name: "new-name" });
      const after = readFileSync(join(dir, ".pi", "agents", p.id, "agent.md"), "utf-8");
      expect(after).toBe(renderAgentMd("new-name", "r"));
    });

    it("update 仅改 model（name/role 不变）→ agent.md 不被重写、内容保留（D-B4-8）", () => {
      const p = store.create(projectId, { name: "coder", role: "写代码" });
      const mdPath = join(dir, ".pi", "agents", p.id, "agent.md");
      // 模拟用户手工往 agent.md 追加内容，再仅改 model
      const handwritten = `${renderAgentMd("coder", "写代码")}\n## 手写补充\n额外说明 HANDWRITTEN\n`;
      writeFileSync(mdPath, handwritten, "utf-8");

      store.update(projectId, p.id, { model: "faux/faux-1" });
      // agent.md 未被骨架覆盖，手写内容仍在
      expect(readFileSync(mdPath, "utf-8")).toBe(handwritten);
    });

    it("手写 agent.md 后：仅改 model 保留手写，再改 role 重渲染为骨架（D-B4-8 / AC④）", () => {
      const p = store.create(projectId, { name: "coder", role: "旧角色 OLD" });
      const mdPath = join(dir, ".pi", "agents", p.id, "agent.md");
      const handwritten = `${renderAgentMd("coder", "旧角色 OLD")}\n额外说明 HANDWRITTEN\n`;
      writeFileSync(mdPath, handwritten, "utf-8");

      // 仅改 model：手写内容保留
      store.update(projectId, p.id, { model: "faux/faux-1" });
      expect(readFileSync(mdPath, "utf-8")).toBe(handwritten);

      // 改 role：agent.md 重渲染为骨架，手写内容被覆盖、含新 role（守 AC④）
      store.update(projectId, p.id, { role: "新角色 NEW" });
      const after = readFileSync(mdPath, "utf-8");
      expect(after).toBe(renderAgentMd("coder", "新角色 NEW"));
      expect(after).not.toContain("HANDWRITTEN");
      expect(after).toContain("新角色 NEW");
    });
  });

  // 方案A：agent mode（doc/coding）字段
  describe("mode 字段（方案A：doc/coding）", () => {
    it("create 默认 mode='doc'", () => {
      const p = store.create(projectId, { name: "d" });
      expect(p.mode).toBe("doc");
      expect(store.get(projectId, p.id).mode).toBe("doc");
    });

    it("create mode='coding' 持久化", () => {
      const p = store.create(projectId, { name: "c", mode: "coding" });
      expect(p.mode).toBe("coding");
      expect(store.get(projectId, p.id).mode).toBe("coding");
    });

    it("update 改 mode 并持久化", () => {
      const p = store.create(projectId, { name: "m" });
      expect(store.update(projectId, p.id, { mode: "coding" }).mode).toBe("coding");
      expect(store.get(projectId, p.id).mode).toBe("coding");
    });

    it("非法 mode 抛 INVALID（create 与 update）", () => {
      // @ts-expect-error 故意传非法 mode
      expectCode(() => store.create(projectId, { name: "x", mode: "bogus" }), "INVALID");
      const p = store.create(projectId, { name: "y" });
      // @ts-expect-error 故意传非法 mode
      expectCode(() => store.update(projectId, p.id, { mode: "bogus" }), "INVALID");
    });

    it("向后兼容：旧 agent.json 无 mode 字段 → 读出为 'doc'", () => {
      const p = store.create(projectId, { name: "legacy" });
      const jsonPath = join(dir, ".pi", "agents", p.id, "agent.json");
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
      delete raw.mode;
      writeFileSync(jsonPath, JSON.stringify(raw, null, 2), "utf-8");
      expect(store.get(projectId, p.id).mode).toBe("doc");
    });
  });
});
