/**
 * B2 注入封装单测 —— 把 §5.2 的四条 AC 映射成 faux 驱动的可执行断言。
 *
 * 装配手法照搬 spike/d2-intercept/harness.ts 的 Tier 2：
 *   registerFauxProvider → getApiProvider 捕获 streamSimple →
 *   ModelRegistry.inMemory().registerProvider(...) → find()，
 * 这套能扛 createAgentSession 内部 ModelRegistry.refresh() 的 resetApiProviders()。
 *
 * 技能发现路径结论（AC②，对应 D-26 / 任务卡的 trust 提示）：
 *   cwd 下 `.pi/skills` 的发现受 project trust 影响（resource-loader.js:323 的
 *   loadProjectContextFiles 看 isProjectTrusted），但**技能本身**走的是
 *   `additionalSkillPaths`（resource-loader.js:277）——它不经 trust 门、稳定可发现。
 *   故本测试用 `additionalSkillPaths` 指向临时技能目录来喂技能，不依赖 cwd 信任态。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider, getApiProvider } from "@earendil-works/pi-ai";

import { AgentProfileStore, type AgentProfile } from "../domain/agent-profile-store";
import { ProjectRegistry } from "../domain/project-registry";
import {
  applyProfileRuntime,
  assembleProfileSessionOptions,
  buildInjectionBlock,
  resolveModelSelector,
} from "./agent-profile-session";

// ---------------------------------------------------------------------------
// 测试夹具：临时项目 + 档案存储
// ---------------------------------------------------------------------------
let dir: string;
let registry: ProjectRegistry;
let store: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-b2-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 取项目 root（= 临时 dir），档案三件套落在它下面。 */
function projectRoot(): string {
  return registry.get(projectId).root;
}

/** 覆写某档案的 agent.md / memory.md 正文（绕过 store，直接写盘，模拟用户编辑）。 */
function writeDocs(profile: AgentProfile, agentMd: string, memoryMd: string | null): void {
  writeFileSync(join(projectRoot(), profile.agentMdPath), agentMd, "utf-8");
  if (memoryMd === null) {
    // 删 memory.md，模拟「记忆文件缺失」
    rmSync(join(projectRoot(), profile.memoryPath), { force: true });
  } else {
    writeFileSync(join(projectRoot(), profile.memoryPath), memoryMd, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// faux 装配：复刻 harness Tier 2，保证 createAgentSession refresh 后 faux 仍存活
// ---------------------------------------------------------------------------
type FauxBundle = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: NonNullable<ReturnType<ModelRegistry["find"]>>;
  unregister: () => void;
};

function makeFaux(): FauxBundle {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux Test Model", contextWindow: 128000, maxTokens: 16384 }],
  });
  // 捕获裸注册的 streamSimple，再以「已知 provider」身份注册进 inMemory registry，
  // 这样 createAgentSession 内部 refresh()（resetApiProviders）后模型仍可 find。
  const liveFaux = getApiProvider("faux") as { streamSimple?: unknown; stream?: unknown };
  const capturedStreamSimple = (liveFaux.streamSimple ?? liveFaux.stream) as never;
  const authStorage = AuthStorage.inMemory({ faux: { type: "api_key", key: "dummy-key" } });
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider("faux", {
    api: "faux",
    baseUrl: "http://localhost:0",
    apiKey: "dummy-key",
    streamSimple: capturedStreamSimple,
    models: [
      {
        id: "faux-1",
        name: "faux-1",
        baseUrl: "http://localhost:0",
        // reasoning: true → supportsThinking()=!!model.reasoning 为真，否则内核会把
        // thinkingLevel 一律 clamp 到 "off"（agent-session.js:1184/1221）。
        // 注意 registerProvider 这里的 reasoning 类型是 boolean（model-registry.d.ts:135），
        // 与 pi-ai 运行时 Model.reasoning(ThinkingLevel) 是两个层；此处填 boolean。
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        // faux-2：用于「模型命中→真的切换」正路断言（与默认 faux-1 不同名才测得出效果）。
        id: "faux-2",
        name: "faux-2",
        baseUrl: "http://localhost:0",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
  // 默认模型仍是 faux-1（保持其余用例不变）；faux-2 仅供命中切换用例显式选。
  const model = modelRegistry.find("faux", "faux-1")!;
  return { authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/** 用档案装配选项 + faux 模型起一个真实会话；返回 session 与诊断，调用方负责断言。 */
async function startSessionFromProfile(
  profile: AgentProfile,
  faux: FauxBundle,
  extra?: { additionalSkillPaths?: string[] },
) {
  const { options, diagnostics } = await assembleProfileSessionOptions({
    projectRoot: projectRoot(),
    profile,
    cwd: projectRoot(),
    sessionManager: SessionManager.inMemory(),
    additionalSkillPaths: extra?.additionalSkillPaths,
  });
  const { session } = await createAgentSession({
    ...options,
    model: faux.model,
    authStorage: faux.authStorage,
    modelRegistry: faux.modelRegistry,
  });
  return { session, diagnostics };
}

/** 在临时技能根目录下造一个 `<name>/SKILL.md`（frontmatter 带 name）。返回技能根目录。 */
function makeSkillDir(skillNames: string[]): string {
  const skillsRoot = mkdtempSync(join(tmpdir(), "ns-b2-skills-"));
  for (const name of skillNames) {
    const d = join(skillsRoot, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "SKILL.md"),
      `---\nname: ${name}\ndescription: skill ${name}\n---\n\n# ${name}\n`,
      "utf-8",
    );
  }
  return skillsRoot;
}

// ---------------------------------------------------------------------------
// AC① —— 档案 + 记忆注入进 system prompt 头部（base 之后、context/skills 之前）
// ---------------------------------------------------------------------------
describe("AC① 注入 agent.md + memory.md", () => {
  it("systemPrompt 同时含 ROLE-X 与 MEM-Y，且位于基座之后、project_context/skills 之前", async () => {
    const profile = store.create(projectId, { name: "coder" });
    writeDocs(profile, "我是 ROLE-X 角色", "记住 MEM-Y 这条");

    const faux = makeFaux();
    try {
      const { session } = await startSessionFromProfile(profile, faux);
      const sp = session.systemPrompt;

      expect(sp).toContain("ROLE-X");
      expect(sp).toContain("MEM-Y");
      // 只读语义标签确实出现
      expect(sp).toContain("<agent_profile>");
      expect(sp).toContain("<agent_memory readonly>");

      // 位置：注入块在基座说明（"You are an expert coding assistant"）之后
      const baseIdx = sp.indexOf("You are an expert coding assistant");
      const roleIdx = sp.indexOf("ROLE-X");
      expect(baseIdx).toBeGreaterThanOrEqual(0);
      expect(roleIdx).toBeGreaterThan(baseIdx);

      // 位置：注入块在 project_context / available skills 之前（若存在）
      const ctxIdx = sp.indexOf("<project_context>");
      if (ctxIdx >= 0) expect(roleIdx).toBeLessThan(ctxIdx);
      const skillsIdx = sp.indexOf("available skills");
      if (skillsIdx >= 0) expect(roleIdx).toBeLessThan(skillsIdx);
    } finally {
      faux.unregister();
    }
  });

  it("记忆文件缺失：不抛、含 agent.md、不出现字面 'undefined'", async () => {
    const profile = store.create(projectId, { name: "coder" });
    writeDocs(profile, "我是 ROLE-X 角色", null); // 删 memory.md

    const faux = makeFaux();
    try {
      const { session } = await startSessionFromProfile(profile, faux);
      const sp = session.systemPrompt;
      expect(sp).toContain("ROLE-X");
      expect(sp).not.toContain("undefined");
      // 记忆缺失 → 不应注入空的 memory 标签
      expect(sp).not.toContain("<agent_memory readonly>");
    } finally {
      faux.unregister();
    }
  });

  it("扛 rebuild：setActiveToolsByName 触发系统提示重建后，注入块仍在（D-24 证伪点）", async () => {
    const profile = store.create(projectId, { name: "coder", tools: ["read", "write"] });
    writeDocs(profile, "我是 ROLE-X 角色", "记住 MEM-Y 这条");

    const faux = makeFaux();
    try {
      const { session } = await startSessionFromProfile(profile, faux);
      // 触发 _rebuildSystemPrompt（内核从 loader 重读 appendSystemPrompt）
      session.setActiveToolsByName(["read"]);
      const sp = session.systemPrompt;
      expect(sp).toContain("ROLE-X");
      expect(sp).toContain("MEM-Y");
    } finally {
      faux.unregister();
    }
  });
});

// ---------------------------------------------------------------------------
// AC② —— skills 按档案过滤；不存在的 skill 静默忽略 + 记 diagnostics
// ---------------------------------------------------------------------------
describe("AC② skills 过滤", () => {
  it("profile.skills=['alpha'] → 含 alpha 不含 beta（用 additionalSkillPaths 喂技能）", async () => {
    const skillsRoot = makeSkillDir(["alpha", "beta"]);
    const profile = store.create(projectId, { name: "coder", skills: ["alpha"], tools: ["read"] });

    const faux = makeFaux();
    try {
      const { session, diagnostics } = await startSessionFromProfile(profile, faux, {
        additionalSkillPaths: [skillsRoot],
      });
      const sp = session.systemPrompt;
      // skills 段需 read 工具在场才渲染（system-prompt.js: hasRead && skills.length）
      expect(sp).toContain("alpha");
      expect(sp).not.toContain("beta");
      expect(diagnostics.missingSkills).toEqual([]);
    } finally {
      faux.unregister();
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("profile.skills=['ghost'] → 不抛、无 ghost、diagnostics.missingSkills 含 ghost", async () => {
    const skillsRoot = makeSkillDir(["alpha"]); // 只有 alpha，没有 ghost
    const profile = store.create(projectId, { name: "coder", skills: ["ghost"], tools: ["read"] });

    const faux = makeFaux();
    try {
      const { session, diagnostics } = await startSessionFromProfile(profile, faux, {
        additionalSkillPaths: [skillsRoot],
      });
      expect(session.systemPrompt).not.toContain("ghost");
      expect(diagnostics.missingSkills).toContain("ghost");
    } finally {
      faux.unregister();
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC③ —— model 单字符串解析 + 「模型不存在」降级；thinkingLevel 直传
// ---------------------------------------------------------------------------
describe("AC③ model 解析与降级 / thinkingLevel", () => {
  it("resolveModelSelector：空/无斜杠→null；anthropic/x→拆分；多段保留 modelId 的 /", () => {
    expect(resolveModelSelector("")).toBeNull();
    expect(resolveModelSelector("   ")).toBeNull();
    expect(resolveModelSelector("garbage")).toBeNull();
    expect(resolveModelSelector("/x")).toBeNull(); // provider 空
    expect(resolveModelSelector("anthropic/")).toBeNull(); // modelId 空
    expect(resolveModelSelector("anthropic/x")).toEqual({ provider: "anthropic", modelId: "x" });
    // modelId 自身含 /（如 openrouter）→ 按首个 / 切，provider=openrouter，modelId=a/b
    expect(resolveModelSelector("openrouter/a/b")).toEqual({ provider: "openrouter", modelId: "a/b" });
  });

  it("applyProfileRuntime：档案模型在 registry 不存在 → modelFallback=true 且会话仍是默认 faux（不抛）", async () => {
    const profile = store.create(projectId, {
      name: "coder",
      model: "anthropic/does-not-exist",
      thinkingLevel: "high",
    });

    const faux = makeFaux();
    try {
      const { session } = await startSessionFromProfile(profile, faux);
      const r = await applyProfileRuntime(session, profile, { modelRegistry: faux.modelRegistry });
      expect(r.modelFallback).toBe(true);
      // 没换模型 → 仍是 faux 默认
      expect(session.model?.id).toBe("faux-1");
    } finally {
      faux.unregister();
    }
  });

  it("applyProfileRuntime：档案模型命中 registry → modelFallback=false 且会话真的切到该模型", async () => {
    const profile = store.create(projectId, { name: "coder", model: "faux/faux-2", thinkingLevel: "high" });

    const faux = makeFaux();
    try {
      const { session } = await startSessionFromProfile(profile, faux);
      // 起会话默认 faux-1，applyProfileRuntime 后应切到 faux-2
      expect(session.model?.id).toBe("faux-1");
      const r = await applyProfileRuntime(session, profile, { modelRegistry: faux.modelRegistry });
      expect(r.modelFallback).toBe(false);
      expect(session.model?.id).toBe("faux-2");
    } finally {
      faux.unregister();
    }
  });

  it("applyProfileRuntime 后 session.state.thinkingLevel == profile.thinkingLevel（high 与 off）", async () => {
    const faux = makeFaux();
    try {
      const high = store.create(projectId, { name: "h", thinkingLevel: "high" });
      const { session: sHigh } = await startSessionFromProfile(high, faux);
      await applyProfileRuntime(sHigh, high, { modelRegistry: faux.modelRegistry });
      expect(sHigh.state.thinkingLevel).toBe("high");

      const off = store.create(projectId, { name: "o", thinkingLevel: "off" });
      const { session: sOff } = await startSessionFromProfile(off, faux);
      await applyProfileRuntime(sOff, off, { modelRegistry: faux.modelRegistry });
      expect(sOff.state.thinkingLevel).toBe("off");
    } finally {
      faux.unregister();
    }
  });
});

// ---------------------------------------------------------------------------
// AC④ —— 编辑档案后再起会话，新 prompt 反映新内容（证明无缓存、每次重读）
// ---------------------------------------------------------------------------
describe("AC④ 编辑后生效", () => {
  it("改写 agent.md 后再次装配起会话 → systemPrompt 反映新内容", async () => {
    const profile = store.create(projectId, { name: "coder" });
    writeDocs(profile, "旧角色 OLD-ROLE", "");

    const faux = makeFaux();
    try {
      const first = await startSessionFromProfile(profile, faux);
      expect(first.session.systemPrompt).toContain("OLD-ROLE");

      // 用户编辑 agent.md
      writeDocs(profile, "新角色 NEW-ROLE", "");

      const second = await startSessionFromProfile(profile, faux);
      expect(second.session.systemPrompt).toContain("NEW-ROLE");
      expect(second.session.systemPrompt).not.toContain("OLD-ROLE");
    } finally {
      faux.unregister();
    }
  });
});

// ---------------------------------------------------------------------------
// 纯函数零碎边界
// ---------------------------------------------------------------------------
describe("buildInjectionBlock 边界", () => {
  it("两者皆空 → 空串（不注入空标签）", () => {
    expect(buildInjectionBlock("", "")).toBe("");
    expect(buildInjectionBlock("   ", "\n\n")).toBe("");
  });
  it("只有 agent.md → 仅 agent_profile 标签", () => {
    const b = buildInjectionBlock("hi", "");
    expect(b).toContain("<agent_profile>");
    expect(b).not.toContain("<agent_memory");
  });
  it("两者都有 → 两个标签都在，profile 在前", () => {
    const b = buildInjectionBlock("AAA", "BBB");
    expect(b.indexOf("<agent_profile>")).toBeLessThan(b.indexOf("<agent_memory readonly>"));
  });
});
