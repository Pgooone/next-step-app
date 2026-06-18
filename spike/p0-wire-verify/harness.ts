/**
 * P0·verify —— logic-verifier 对 P0·wire（profile-session-wiring.ts 合并 artifact-guard）的
 * **独立**逻辑层复核 harness。
 *
 * 与 wire-dev 的 lib/pi/profile-session-wiring.test.ts 区别（刻意不照抄）：
 *   - 经 **真的 startProfileSession**（不是直接 createAgentSession，那是 spike/p0-profile-guard
 *     验「裸 guard×白名单」的层）——本 harness 验的是 wire 这个组合函数：它是否真的把
 *     guardOptions 合进 createAgentSession，使 profile 会话改受管 artifact 被拦。
 *   - 自建 fixture/驱动；用 faux model + faux registerInnerSession + guardDepsOverride 注入
 *     hermetic 临时 registry/.pi。
 *   - **补 wire-dev 漏测的 edit 路径**（wire-dev 只测了 write）。
 *   - 补 wire-dev 漏测的边界：profile.tools 只读（无 write）→ agent 无 write 工具、写不了
 *     （确认是配置约束、非 guard 失效）。
 *   - 补对抗 case：guardOptions 是否真的进了会话（active 工具 = guard 的 customTools 而非内置默认集）、
 *     sourceActor 是否恒为 profile.name（不被 createOptionsOverride 之类污染）、
 *     非受管 edit 是否正常落盘。
 *
 * 跑法（cwd=仓库根 next-step-V1.1）：
 *   node --conditions=import --import tsx spike/p0-wire-verify/harness.ts
 * 为何 --conditions=import：同 p0-profile-guard/harness.ts —— 经 lib/*.ts 间接 import
 * @earendil-works/pi-coding-agent，受仓库根 CJS package.json 管辖被 tsx 当 CJS，
 * 该包 exports 只给 import 条件，CJS require 会 ERR_PACKAGE_PATH_NOT_EXPORTED。
 *
 * 红线：不改生产码、不 commit、不 spawn 子 agent、不跑真浏览器。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { ArtifactService } from "../../lib/domain/artifact-service";
import { PendingChangeStore, type PendingChange } from "../../lib/domain/pending-change-service";
import { AgentProfileStore, type AgentProfile } from "../../lib/domain/agent-profile-store";
import { ProjectRegistry } from "../../lib/domain/project-registry";
import {
  startProfileSession,
  type RegisterInnerSession,
} from "../../lib/pi/profile-session-wiring";

// ---------------------------------------------------------------------------
// 结果记录（仿 p0-profile-guard/harness.ts）
// ---------------------------------------------------------------------------
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`    [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// faux 装配（带 responses 版，setResponses 必须在捕获 streamSimple 之前）
// ---------------------------------------------------------------------------
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];
type FauxBundle = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: NonNullable<ReturnType<ModelRegistry["find"]>>;
  unregister: () => void;
};
function makeFaux(responses?: FauxResponses): FauxBundle {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
  });
  if (responses) reg.setResponses(responses);
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
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

// ---------------------------------------------------------------------------
// faux registerInnerSession：捕获 inner，prompt 命令 **await** inner.prompt
// （让 startProfileSession 的 `await session.send(...)` 阻塞到工具回合结束，
//  之后即可断言磁盘/pending 状态）。
// ---------------------------------------------------------------------------
function makeAwaitingRegister(): {
  register: RegisterInnerSession;
  captured: { inner: AgentSession | null; sends: Record<string, unknown>[] };
} {
  const captured: { inner: AgentSession | null; sends: Record<string, unknown>[] } = {
    inner: null,
    sends: [],
  };
  const register: RegisterInnerSession = (inner) => {
    captured.inner = inner;
    return {
      realSessionId: inner.sessionId,
      session: {
        send: async (command) => {
          captured.sends.push(command);
          return command.type === "prompt" ? inner.prompt(command.message as string) : null;
        },
      },
    };
  };
  return { register, captured };
}

// ---------------------------------------------------------------------------
// 每 case 独立 temp 项目 + registry + 档案存储（避免串扰）
// ---------------------------------------------------------------------------
type Fixture = {
  dir: string;
  registry: ProjectRegistry;
  artifactService: ArtifactService;
  pendingStore: PendingChangeStore;
  store: AgentProfileStore;
  projectId: string;
  projectRoot: string;
  cleanup: () => void;
};
function makeFixture(tag: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `ns-p0-wire-${tag}-`));
  const registry = new ProjectRegistry(join(dir, "projects.json"));
  const root = join(dir, "proj");
  mkdirSync(root, { recursive: true });
  const p = registry.create({ name: "proj", root });
  return {
    dir,
    registry,
    artifactService: new ArtifactService(registry),
    pendingStore: new PendingChangeStore(registry),
    store: new AgentProfileStore(registry),
    projectId: p.id,
    projectRoot: p.root,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function readPendingChanges(projectRoot: string, artifactId: string): PendingChange[] {
  const pendingDir = join(projectRoot, ".pi", "artifacts", "managed", artifactId, "pending");
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp"))
    .map((f) => JSON.parse(readFileSync(join(pendingDir, f), "utf-8")) as PendingChange);
}
function managedTarget(projectRoot: string, artifactId: string): string {
  return join(projectRoot, ".pi", "artifacts", "managed", artifactId, "doc.md");
}
function versionPath(projectRoot: string, artifactId: string, v: number): string {
  return join(projectRoot, ".pi", "artifacts", "managed", artifactId, "versions", `${v}.json`);
}

/**
 * 经真 startProfileSession 起会话——本 harness 的核心入口。
 * guardDepsOverride 注入 hermetic registry/.pi（生产省略 → guard 默认文件后端）。
 * createOptionsOverride 注 faux model/auth（无凭证环境）。
 */
async function startViaWire(
  fx: Fixture,
  faux: FauxBundle,
  profile: AgentProfile,
  firstMessage: string,
) {
  const { register, captured } = makeAwaitingRegister();
  const result = await startProfileSession({
    projectRoot: fx.projectRoot,
    profile,
    cwd: fx.projectRoot,
    firstMessage,
    registerInnerSession: register,
    sessionManager: SessionManager.inMemory(),
    createOptionsOverride: {
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
    },
    guardDepsOverride: {
      registry: fx.registry,
      artifactService: fx.artifactService,
      pendingStore: fx.pendingStore,
    },
  });
  return { result, captured };
}

// ===========================================================================
// Case 1：经 wire 起会话，受管 write → PendingChange 落盘 + 磁盘无文件 + 无新版本
//          + sourceActor=profile.name（与 wire-dev 同主题，但独立 fixture/驱动 + 加 active 断言）
// ===========================================================================
async function case1ManagedWrite() {
  console.log("\n=== Case 1：受管 write 经 wire 被拦成 PendingChange ===");
  const fx = makeFixture("c1");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "crd",
    title: "需求",
    content: "甲\n乙\n",
  });
  const target = managedTarget(fx.projectRoot, a.id);
  const v1Path = versionPath(fx.projectRoot, a.id, 1);
  const v1Before = readFileSync(v1Path, "utf-8");
  const profile = fx.store.create(fx.projectId, {
    name: "需求分析师",
    tools: ["read", "write", "edit"],
  });
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("写入"),
        fauxToolCall("write", { path: target, content: "甲\n改过的乙\n丙\n" }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    const { result, captured } = await startViaWire(fx, faux, profile, "更新文档");

    // 会话起来了、返回真 sessionId（不是空/undefined）
    record(
      "1.startProfileSession 返回真 sessionId + inner 被 register 捕获",
      captured.inner !== null && typeof result.sessionId === "string" && result.sessionId.length > 0,
      `sessionId=${result.sessionId}, inner=${captured.inner ? "captured" : "null"}`,
    );

    // 对抗断言：active 工具集 == profile 白名单（含 write/edit），不多不少。
    // 关键内核事实（spike/p0-profile-guard 已证）：合并后 options 同时有 tools:白名单 与
    // guardOptions.noTools:"builtin"，但 sdk.js 中 tools 存在则 noTools 被忽略 → active=[...白名单]。
    // 故这里 active 应恰为 ["read","write","edit"]（白名单层尊重生效），而**激活的 write/edit
    // 是 guard 的同名 customTools**（覆盖内置）——这一点不靠工具名分辨（同名同 label），
    // 而由下方行为断言（受管 write→pending、磁盘无文件）反证。
    const active = captured.inner!.getActiveToolNames().slice().sort();
    const expectedActive = ["edit", "read", "write"]; // = profile.tools 排序
    record(
      "1.对抗：active 工具恰为 profile 白名单 [read,write,edit]（白名单层被尊重，且 write/edit 在场可被 guard 覆盖）",
      JSON.stringify(active) === JSON.stringify(expectedActive),
      `active(sorted)=${JSON.stringify(active)}`,
    );

    const wroteDisk = existsSync(target);
    const v1Same = readFileSync(v1Path, "utf-8") === v1Before;
    const hasV2 = existsSync(versionPath(fx.projectRoot, a.id, 2));
    const changes = readPendingChanges(fx.projectRoot, a.id);
    const pc = changes[0];
    const allLines = pc ? pc.diffBlocks.flatMap((b) => b.lines) : [];

    record("1.受管 write → 磁盘无目标文件", !wroteDisk, `existsSync(doc.md)=${wroteDisk}`);
    record(
      "1.受管 write → v1 不变 + 无 v2（无新版本）",
      v1Same && !hasV2,
      `v1未变=${v1Same}, 有v2=${hasV2}`,
    );
    record(
      "1.受管 write → PendingChange 落盘（op=replace, sourceActor=profile.name, diffBlocks 含新行）",
      changes.length === 1 &&
        pc.op === "replace" &&
        pc.sourceActor === "需求分析师" &&
        pc.artifactId === a.id &&
        pc.diffBlocks.length > 0 &&
        allLines.includes("丙"),
      `count=${changes.length}, op=${pc?.op}, actor=${pc?.sourceActor}, blocks=${pc?.diffBlocks.length}, 含丙=${allLines.includes("丙")}`,
    );
  } catch (e) {
    record("1.受管 write", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ===========================================================================
// Case 2（wire-dev 漏测，必补）：经 wire 起会话，受管 **edit** → 同样拦成 pending
// ===========================================================================
async function case2ManagedEdit() {
  console.log("\n=== Case 2（补 wire-dev 漏测）：受管 edit 经 wire 被拦成 PendingChange ===");
  const fx = makeFixture("c2");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "prd",
    title: "PRD",
    content: "alpha\nOLD\nbeta\n",
  });
  const target = managedTarget(fx.projectRoot, a.id);
  const v1Path = versionPath(fx.projectRoot, a.id, 1);
  const v1Before = readFileSync(v1Path, "utf-8");
  const profile = fx.store.create(fx.projectId, {
    name: "编辑助手",
    tools: ["read", "write", "edit"],
  });
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("编辑"),
        fauxToolCall("edit", { path: target, edits: [{ oldText: "OLD", newText: "NEW-EDIT" }] }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    const { captured } = await startViaWire(fx, faux, profile, "改一行");
    const wroteDisk = existsSync(target);
    const v1Same = readFileSync(v1Path, "utf-8") === v1Before;
    const hasV2 = existsSync(versionPath(fx.projectRoot, a.id, 2));
    const changes = readPendingChanges(fx.projectRoot, a.id);
    const pc = changes[0];
    const allLines = pc ? pc.diffBlocks.flatMap((b) => b.lines) : [];

    record(
      "2.edit 工具确实被激活（active 含 edit）",
      captured.inner!.getActiveToolNames().includes("edit"),
      `active=${JSON.stringify(captured.inner!.getActiveToolNames())}`,
    );
    record("2.受管 edit → 磁盘无目标文件", !wroteDisk, `existsSync=${wroteDisk}`);
    record(
      "2.受管 edit → v1 不变 + 无 v2",
      v1Same && !hasV2,
      `v1未变=${v1Same}, 有v2=${hasV2}`,
    );
    record(
      "2.受管 edit → PendingChange 落盘（op=replace, sourceActor=编辑助手, 含 NEW-EDIT）",
      changes.length === 1 &&
        pc.op === "replace" &&
        pc.sourceActor === "编辑助手" &&
        pc.artifactId === a.id &&
        pc.diffBlocks.length > 0 &&
        allLines.includes("NEW-EDIT"),
      `count=${changes.length}, op=${pc?.op}, actor=${pc?.sourceActor}, 含NEW-EDIT=${allLines.includes("NEW-EDIT")}`,
    );
  } catch (e) {
    record("2.受管 edit", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ===========================================================================
// Case 3：经 wire 起会话，非受管 write → 正常落盘、无 pending
// ===========================================================================
async function case3UnmanagedWrite() {
  console.log("\n=== Case 3：非受管 write 经 wire 正常落盘、无 pending ===");
  const fx = makeFixture("c3");
  const normal = join(fx.projectRoot, "note.txt");
  const profile = fx.store.create(fx.projectId, {
    name: "agent-a",
    tools: ["read", "write", "edit"],
  });
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("写"),
        fauxToolCall("write", { path: normal, content: "普通文件内容\n" }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    await startViaWire(fx, faux, profile, "写普通文件");
    const wrote = existsSync(normal);
    const content = wrote ? readFileSync(normal, "utf-8") : "(no file)";
    const managedDir = join(fx.projectRoot, ".pi", "artifacts", "managed");
    const pendingCount = existsSync(managedDir)
      ? readdirSync(managedDir).reduce((n, id) => n + readPendingChanges(fx.projectRoot, id).length, 0)
      : 0;
    record(
      "3.非受管 write → 正常落盘 + 内容正确 + 0 pending（guard 不误伤普通文件）",
      wrote && content === "普通文件内容\n" && pendingCount === 0,
      `existsSync=${wrote}, content=${JSON.stringify(content)}, pending=${pendingCount}`,
    );
  } catch (e) {
    record("3.非受管 write", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ===========================================================================
// Case 4（边界，wire-dev 漏测）：profile.tools 只读（["read"]）→ agent 无 write/edit 工具。
//   确认这是「配置约束」（active 集不含 write/edit），即便 agent 想写受管 artifact 也无工具可用，
//   而非 guard 失效。这是 P0 「自定义 agent 写不了受管 artifact」的另一道闸（白名单层）。
// ===========================================================================
async function case4ReadOnlyProfile() {
  console.log('\n=== Case 4（边界）：profile.tools=["read"] → 无 write/edit 工具 ===');
  const fx = makeFixture("c4");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "crd",
    title: "只读测试",
    content: "x\ny\n",
  });
  const target = managedTarget(fx.projectRoot, a.id);
  const v1Path = versionPath(fx.projectRoot, a.id, 1);
  const v1Before = readFileSync(v1Path, "utf-8");
  const profile = fx.store.create(fx.projectId, { name: "只读 agent", tools: ["read"] });
  // 让 faux 不发 tool-call（只读 agent 本就不该有 write 可调）；纯文本回合，证明会话能正常起。
  const faux = makeFaux([() => fauxAssistantMessage([fauxText("我只读，无写工具")])]);
  try {
    const { captured } = await startViaWire(fx, faux, profile, "看看文档");
    const active = captured.inner!.getActiveToolNames();
    const noWrite = !active.includes("write");
    const noEdit = !active.includes("edit");
    const hasRead = active.includes("read");
    record(
      "4.只读 profile → active 含 read、不含 write/edit（配置约束，非 guard 失效）",
      hasRead && noWrite && noEdit,
      `active=${JSON.stringify(active)}`,
    );
    // 既无 write 工具，磁盘自然无目标文件、无新版本、无 pending（无写路径可触发）
    const wroteDisk = existsSync(target);
    const v1Same = readFileSync(v1Path, "utf-8") === v1Before;
    const changes = readPendingChanges(fx.projectRoot, a.id);
    record(
      "4.只读 profile 起会话后 → 受管 artifact 磁盘/版本/pending 均无变化",
      !wroteDisk && v1Same && changes.length === 0,
      `existsSync=${wroteDisk}, v1未变=${v1Same}, pending=${changes.length}`,
    );
  } catch (e) {
    record("4.只读 profile", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ===========================================================================
// Case 5（对抗 false-green）：sourceActor 恒为 profile.name，不被 createOptionsOverride 污染。
//   wire 注释声称 sourceActor=profile.name（spread 顺序：profileOptions→guardOptions→
//   createOptionsOverride，键不冲突）。这里用一个含中文/特殊名的 profile，且 createOptionsOverride
//   只带 model/auth（不带 sourceActor，本就不该有），断言落盘 PendingChange.sourceActor 精确等于
//   profile.name —— 防「sourceActor 被默认值/agentId 顶掉」的隐性回归。
// ===========================================================================
async function case5SourceActorPinned() {
  console.log("\n=== Case 5（对抗）：sourceActor 恒等 profile.name ===");
  const fx = makeFixture("c5");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "crd",
    title: "署名测试",
    content: "line\n",
  });
  const target = managedTarget(fx.projectRoot, a.id);
  const weirdName = "架构师·张三 (lead)";
  const profile = fx.store.create(fx.projectId, {
    name: weirdName,
    tools: ["read", "write", "edit"],
  });
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("写"),
        fauxToolCall("write", { path: target, content: "line\nadded\n" }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    await startViaWire(fx, faux, profile, "改文档");
    const changes = readPendingChanges(fx.projectRoot, a.id);
    record(
      "5.PendingChange.sourceActor 精确 == profile.name（含中文/特殊字符，未被默认值顶掉）",
      changes.length === 1 && changes[0].sourceActor === weirdName,
      `count=${changes.length}, actor=${JSON.stringify(changes[0]?.sourceActor)}, 期望=${JSON.stringify(weirdName)}`,
    );
  } catch (e) {
    record("5.sourceActor", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ===========================================================================
// Case 6（现实组合）：同一会话先 write 受管、再 write 非受管 —— 自分流双路径在一个会话里都对。
//   验 operations 是 cwd 级单一函数、对每条路径按 resolveManagedTarget 分流（artifact-guard.ts:90 注释）。
// ===========================================================================
async function case6MixedInOneSession() {
  console.log("\n=== Case 6（现实组合）：一个会话内 受管 write + 非受管 write 各走各路 ===");
  const fx = makeFixture("c6");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "crd",
    title: "混合",
    content: "head\n",
  });
  const managed = managedTarget(fx.projectRoot, a.id);
  const normal = join(fx.projectRoot, "sub", "free.txt");
  const profile = fx.store.create(fx.projectId, {
    name: "混合 agent",
    tools: ["read", "write", "edit"],
  });
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("先写受管"),
        fauxToolCall("write", { path: managed, content: "head\n受管新行\n" }),
      ]),
    () =>
      fauxAssistantMessage([
        fauxText("再写普通"),
        fauxToolCall("write", { path: normal, content: "自由文件\n" }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    await startViaWire(fx, faux, profile, "两步写入");
    const managedWrote = existsSync(managed);
    const normalWrote = existsSync(normal);
    const normalContent = normalWrote ? readFileSync(normal, "utf-8") : "(no)";
    const changes = readPendingChanges(fx.projectRoot, a.id);
    record(
      "6.受管→pending(磁盘无) 且 非受管→落盘(mkdir 子目录生效)，互不串扰",
      !managedWrote &&
        changes.length === 1 &&
        normalWrote &&
        normalContent === "自由文件\n",
      `受管落盘=${managedWrote}, pending=${changes.length}, 普通落盘=${normalWrote}, 普通内容=${JSON.stringify(normalContent)}`,
    );
  } catch (e) {
    record("6.混合", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await case1ManagedWrite();
  await case2ManagedEdit();
  await case3UnmanagedWrite();
  await case4ReadOnlyProfile();
  await case5SourceActorPinned();
  await case6MixedInOneSession();

  console.log("\n=== RESULT ===");
  for (const c of checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  }
  const fails = checks.filter((c) => !c.pass);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  if (fails.length > 0) {
    console.log(`  FAIL 项: ${fails.map((f) => f.name).join("; ")}`);
    console.log("\n  结论: FAIL —— wire 接线在某些路径下未按预期拦截/放行。");
    process.exit(1);
  }
  console.log(
    "\n  结论: PASS —— 经真 startProfileSession 起的 profile 会话已挂上 artifact-guard：" +
      "受管 write/edit 被拦成 PendingChange（不写盘、无新版本、sourceActor=profile.name），" +
      "非受管路径正常放行，只读 profile 无写工具。",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("harness 顶层异常:", e);
  process.exit(1);
});
