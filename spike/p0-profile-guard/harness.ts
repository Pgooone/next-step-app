/**
 * P0 承重墙·档位1 —— profile.tools 白名单 × artifact-guard 共存 spike harness
 *
 * ========================= 命门（要回答的问题）=========================
 * 真实接线时（lib/pi/profile-session-wiring.ts:105）会把两层 options 合并：
 *   { ...profileOptions, ...guardOptions }
 * 其中 profileOptions 带 `tools: profile.tools`（白名单，取值是
 * CODING_TOOL_NAMES=["read","bash","edit","write","grep","find","ls"] 的子集），
 * guardOptions = assembleArtifactGuardOptions(...) = `{ noTools:"builtin", customTools:[同名 7 工具] }`。
 *
 * D2 / lib/pi/artifact-guard.test.ts 已证明【裸会话】（只有 guard，无 tools 白名单）下 guard 工作。
 * 但从没测过【叠加 profile.tools 白名单层】。本 harness 唯一新增就是：起会话时把
 *   tools: profileTools
 * 与 guard 的 options 一起传，忠实复刻 {...profileOptions, ...guardOptions}。
 * （profileOptions 里只有 tools 影响工具解析；resourceLoader / sessionManager 不参与「谁胜出」。）
 *
 * ===================== 内核事实（已查证，供断言/判读，勿照抄进逻辑）=====================
 * - sdk.js:132 —— `initialActiveToolNames = (options.tools ? [...options.tools]
 *   : options.noTools ? [] : defaultActiveToolNames).filter(...)`。
 *   即 **当 options.tools 存在时 noTools 被完全忽略**（三元首支命中），active 集 = [...tools]。
 *   （:133 allowedToolNames = options.tools ?? (noTools==="all"?[]:undefined)，?? 短路同样让 tools 优先。）
 * - agent-session.js:1868-1871 —— toolRegistry 先塞内置（被 isAllowedTool 过滤），再把 customTools
 *   按名 `.set` 覆盖进同一 Map（同名键直接覆盖）。
 * - agent-session.js:1823 —— isAllowedTool(name) = (!allowedToolNames || allowedToolNames.has(name))
 *   && !excludedToolNames?.has(name)。即工具要进激活集，名字必须 ∈ tools 白名单。
 *
 * 推论：
 *   1) 内置 write 与 guard 的 custom write **同名**，custom 在内置之后 `.set` → custom 覆盖内置。
 *   2) 但二者都只有在 "write" ∈ tools 白名单时才会进表 / 被激活；白名单不含 write → 根本没有 write。
 *
 * ===================== 为什么「guard 胜出」只能靠行为证明 =====================
 * C 路线（D-D2-1 选 C）guard 复用内核 write/edit 工厂（createWriteToolDefinition 等），
 * 其 name 仍是 "write"/"edit"、label 仍是 "write"/"edit"，与内置 write/edit **同名同 label，不可分辨**。
 * 所以「当前激活的 write 是 guard 版而非内置版」**无法用 label 区分**，只能靠行为：
 *   受管路径写 → PendingChange 落 pending/ + 磁盘无目标文件 + 无 versions/2.json（= guard 胜）。
 *   若反而真落盘 / 出现 versions/2.json → 内置 write 胜出 → 命门 FAIL。
 *
 * ===================== 跑法 =====================
 *   cwd = 仓库根，执行：
 *     node --conditions=import --import tsx spike/p0-profile-guard/harness.ts
 *   （或 `NODE_OPTIONS="--conditions=import" node_modules/.bin/tsx spike/p0-profile-guard/harness.ts`，
 *     或 `npm run --prefix spike/p0-profile-guard spike`）
 *   打印每 case PASS/FAIL + 总计；全过 exit 0，有 FAIL exit 1。
 *
 *   为何需要 --conditions=import：本 harness 经 `../../lib/*.ts` 间接 import
 *   `@earendil-works/pi-coding-agent`，而 lib 受仓库根 CJS package.json 管辖被 tsx 当 CJS 加载；
 *   该包 `exports` 只给了 `import` 条件（无 `require`），CJS require 解析会 ERR_PACKAGE_PATH_NOT_EXPORTED。
 *   `--conditions=import` 让 require 解析也走 `import` 导出（Node22 支持 require ESM），即可放行。
 *   裸 `tsx harness.ts` 因此会失败——这是模块解析环境约束，非命门结论。
 *
 * 红线：不改 pi 内核、不改 lib/* 业务码（只在 spike/ 下新增文件）。
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

import { AuthStorage, ModelRegistry, createAgentSession } from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { ArtifactService } from "../../lib/domain/artifact-service";
import { PendingChangeStore, type PendingChange } from "../../lib/domain/pending-change-service";
import { ProjectRegistry } from "../../lib/domain/project-registry";
import { assembleArtifactGuardOptions } from "../../lib/pi/artifact-guard";

// ---------------------------------------------------------------------------
// 结果记录（仿 spike/d2-intercept/harness.ts 风格：record + process.exit）
// ---------------------------------------------------------------------------
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`    [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// faux 装配（直接复刻 lib/pi/artifact-guard.test.ts 的 makeFaux；
// responses 必须在捕获 streamSimple 之前设好，再用 ModelRegistry.registerProvider
// 把 faux 作为已知 provider 注册，扛 createAgentSession 内部 refresh 的 resetApiProviders）
// ---------------------------------------------------------------------------
type FauxResponses = Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0];
function makeFaux(responses?: FauxResponses) {
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
// 每 case 用全新 temp 项目 + 全新受管 artifact（避免串扰；仿模板 beforeEach）
// ---------------------------------------------------------------------------
type Fixture = {
  dir: string;
  registry: ProjectRegistry;
  artifactService: ArtifactService;
  pendingStore: PendingChangeStore;
  projectId: string;
  projectRoot: string;
  cleanup: () => void;
};

function makeFixture(tag: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `ns-p0-guard-${tag}-`));
  const registry = new ProjectRegistry(join(dir, "projects.json"));
  const root = join(dir, "proj");
  mkdirSync(root, { recursive: true });
  const p = registry.create({ name: "proj", root });
  const artifactService = new ArtifactService(registry);
  const pendingStore = new PendingChangeStore(registry);
  return {
    dir,
    registry,
    artifactService,
    pendingStore,
    projectId: p.id,
    projectRoot: p.root,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 读某 artifact 的 pending/ 目录下全部 PendingChange（复刻模板 readPendingChanges）。 */
function readPendingChanges(projectRoot: string, artifactId: string): PendingChange[] {
  const pendingDir = join(projectRoot, ".pi", "artifacts", "managed", artifactId, "pending");
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".tmp"))
    .map((f) => JSON.parse(readFileSync(join(pendingDir, f), "utf-8")) as PendingChange);
}

/**
 * 唯一新增：起会话时把 tools 白名单 + guard options 一起传 —— 忠实复刻
 * {...profileOptions, ...guardOptions}（profileOptions 里只 tools 影响工具解析）。
 */
async function startSession(
  fx: Fixture,
  faux: ReturnType<typeof makeFaux>,
  sourceActor: string,
  profileTools: string[],
) {
  const { options } = assembleArtifactGuardOptions({
    sourceActor,
    cwd: fx.projectRoot,
    registry: fx.registry,
    artifactService: fx.artifactService,
    pendingStore: fx.pendingStore,
  });
  const { session } = await createAgentSession({
    ...options,
    tools: profileTools,
    cwd: fx.projectRoot,
    model: faux.model,
    authStorage: faux.authStorage,
    modelRegistry: faux.modelRegistry,
  });
  return session;
}

const FULL_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** 受管 artifact 的内核侧目标路径（write/edit 工具的 path 参数应指向它，才走受管分流）。 */
function managedTarget(projectRoot: string, artifactId: string): string {
  return join(projectRoot, ".pi", "artifacts", "managed", artifactId, "doc.md");
}
function versionPath(projectRoot: string, artifactId: string, v: number): string {
  return join(projectRoot, ".pi", "artifacts", "managed", artifactId, "versions", `${v}.json`);
}

// ---------------------------------------------------------------------------
// Case A（FULL，go/no-go 核心）：profileTools = 全 7 工具
//   断言 active ⊇ 全 7；受管 write → PendingChange 落盘 + 磁盘无文件 + 无 versions/2.json；
//   非受管 write → 落盘 + 无 pending；受管 edit → pending 落盘。
// ---------------------------------------------------------------------------
async function caseA() {
  console.log("\n=== Case A（FULL，go/no-go 核心）profileTools = 全 7 工具 ===");

  // --- A.1 受管 write 拦截 ---
  {
    const fx = makeFixture("A1");
    const a = fx.artifactService.createArtifact(fx.projectId, {
      kind: "crd",
      title: "需求",
      content: "第一行\n第二行\n",
    });
    const target = managedTarget(fx.projectRoot, a.id);
    const v1Path = versionPath(fx.projectRoot, a.id, 1);
    const v1Before = readFileSync(v1Path, "utf-8");
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("写入"),
          fauxToolCall("write", { path: target, content: "第一行\n改过的第二行\n第三行\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startSession(fx, faux, "需求分析师", FULL_TOOLS);
      const active = session.getActiveToolNames();
      const writeLabel = session.getToolDefinition("write")?.label ?? "(undefined)";
      console.log(`    profileTools = ${JSON.stringify(FULL_TOOLS)}`);
      console.log(`    active       = ${JSON.stringify(active)}`);
      console.log(`    write.label  = ${writeLabel}  (与内置同名同 label，不可分辨——下面靠行为证明)`);

      record(
        "A.断言①② active ⊇ 全 7 工具",
        FULL_TOOLS.every((t) => active.includes(t)),
        `缺失=${JSON.stringify(FULL_TOOLS.filter((t) => !active.includes(t)))}`,
      );

      await session.prompt("更新文档");

      const wroteDisk = existsSync(target);
      const v1Same = readFileSync(v1Path, "utf-8") === v1Before;
      const hasV2 = existsSync(versionPath(fx.projectRoot, a.id, 2));
      const changes = readPendingChanges(fx.projectRoot, a.id);
      const pc = changes[0];
      const allLines = pc ? pc.diffBlocks.flatMap((b) => b.lines) : [];

      // 行为证明 guard 胜出：受管 write 既没落盘、也没生成新版本，而是落了 PendingChange
      record(
        "A.行为证明 受管 write → 磁盘无目标文件（guard 胜，非内置 write）",
        !wroteDisk,
        `existsSync(doc.md)=${wroteDisk}`,
      );
      record(
        "A.行为证明 受管 write → versions/1.json 不变 + 无 versions/2.json",
        v1Same && !hasV2,
        `v1未变=${v1Same}, 有v2=${hasV2}`,
      );
      record(
        "A.行为证明 受管 write → PendingChange 落盘（op=replace, sourceActor, diffBlocks 非空）",
        changes.length === 1 &&
          pc.op === "replace" &&
          pc.sourceActor === "需求分析师" &&
          pc.artifactId === a.id &&
          pc.diffBlocks.length > 0 &&
          allLines.includes("第三行"),
        `count=${changes.length}, op=${pc?.op}, actor=${pc?.sourceActor}, blocks=${pc?.diffBlocks.length}, 含第三行=${allLines.includes("第三行")}`,
      );
    } catch (e) {
      record("A.受管 write", false, `抛错: ${(e as Error).message}`);
    } finally {
      faux.unregister();
      fx.cleanup();
    }
  }

  // --- A.2 非受管 write 放行 ---
  {
    const fx = makeFixture("A2");
    const normal = join(fx.projectRoot, "note.txt");
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("写"),
          fauxToolCall("write", { path: normal, content: "普通文件内容\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startSession(fx, faux, "agent-a", FULL_TOOLS);
      await session.prompt("写普通文件");
      const wrote = existsSync(normal);
      const content = wrote ? readFileSync(normal, "utf-8") : "(no file)";
      // 非受管路径不属于任何受管 artifact，故 pending 目录恒为空——这里直接断言落盘 + 内容正确
      record(
        "A.非受管 write → 正常落盘 + 内容正确（白名单层不阻断非受管放行）",
        wrote && content === "普通文件内容\n",
        `existsSync=${wrote}, content=${JSON.stringify(content)}`,
      );
    } catch (e) {
      record("A.非受管 write", false, `抛错: ${(e as Error).message}`);
    } finally {
      faux.unregister();
      fx.cleanup();
    }
  }

  // --- A.3 受管 edit 拦截 ---
  {
    const fx = makeFixture("A3");
    const a = fx.artifactService.createArtifact(fx.projectId, {
      kind: "prd",
      title: "PRD",
      content: "alpha\nOLD\nbeta\n",
    });
    const target = managedTarget(fx.projectRoot, a.id);
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("编辑"),
          fauxToolCall("edit", { path: target, edits: [{ oldText: "OLD", newText: "NEW" }] }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const session = await startSession(fx, faux, "编辑助手", FULL_TOOLS);
      await session.prompt("改一行");
      const wroteDisk = existsSync(target);
      const changes = readPendingChanges(fx.projectRoot, a.id);
      const pc = changes[0];
      const allLines = pc ? pc.diffBlocks.flatMap((b) => b.lines) : [];
      record(
        "A.行为证明 受管 edit → 磁盘无目标文件 + PendingChange 落盘（含 NEW）",
        !wroteDisk &&
          changes.length === 1 &&
          pc.sourceActor === "编辑助手" &&
          pc.diffBlocks.length > 0 &&
          allLines.includes("NEW"),
        `existsSync=${wroteDisk}, count=${changes.length}, actor=${pc?.sourceActor}, 含NEW=${allLines.includes("NEW")}`,
      );
    } catch (e) {
      record("A.受管 edit", false, `抛错: ${(e as Error).message}`);
    } finally {
      faux.unregister();
      fx.cleanup();
    }
  }
}

// ---------------------------------------------------------------------------
// Case A'（partial 含 write/edit）：profileTools = ["read","write","edit"]
//   断言 active ⊇ {read,write,edit} 且 active 不含 bash/grep/find/ls（断言④：profile 限制被尊重）；
//   受管 write 仍被拦成 pending。
// ---------------------------------------------------------------------------
async function caseAPrime() {
  console.log('\n=== Case A\'（partial）profileTools = ["read","write","edit"] ===');
  const PARTIAL = ["read", "write", "edit"];
  const EXCLUDED = ["bash", "grep", "find", "ls"];
  const fx = makeFixture("Aprime");
  const a = fx.artifactService.createArtifact(fx.projectId, {
    kind: "crd",
    title: "需求",
    content: "L1\nL2\n",
  });
  const target = managedTarget(fx.projectRoot, a.id);
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("写入"),
        fauxToolCall("write", { path: target, content: "L1\nL2-改\nL3\n" }),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    const session = await startSession(fx, faux, "需求分析师", PARTIAL);
    const active = session.getActiveToolNames();
    console.log(`    profileTools = ${JSON.stringify(PARTIAL)}`);
    console.log(`    active       = ${JSON.stringify(active)}`);

    record(
      "A'.active ⊇ {read,write,edit}",
      PARTIAL.every((t) => active.includes(t)),
      `缺失=${JSON.stringify(PARTIAL.filter((t) => !active.includes(t)))}`,
    );
    record(
      "A'.断言④ active 不含 bash/grep/find/ls（profile 限制被尊重）",
      EXCLUDED.every((t) => !active.includes(t)),
      `误含=${JSON.stringify(EXCLUDED.filter((t) => active.includes(t)))}`,
    );

    await session.prompt("更新文档");
    const wroteDisk = existsSync(target);
    const changes = readPendingChanges(fx.projectRoot, a.id);
    record(
      "A'.受管 write 仍被拦成 PendingChange（白名单收窄不破坏 guard）",
      !wroteDisk && changes.length === 1 && changes[0].sourceActor === "需求分析师",
      `existsSync=${wroteDisk}, pending=${changes.length}`,
    );
  } catch (e) {
    record("A'.partial", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Case B（只读）：profileTools = ["read"]
//   断言 active 只含 read、不含 write/edit（agent 无法写、profile 只读语义完好）。
// ---------------------------------------------------------------------------
async function caseB() {
  console.log('\n=== Case B（只读）profileTools = ["read"] ===');
  const fx = makeFixture("B");
  const faux = makeFaux();
  try {
    const session = await startSession(fx, faux, "只读 agent", ["read"]);
    const active = session.getActiveToolNames();
    console.log(`    profileTools = ${JSON.stringify(["read"])}`);
    console.log(`    active       = ${JSON.stringify(active)}`);
    record(
      "B.active 只含 read，不含 write/edit（只读 profile 语义完好）",
      active.includes("read") && !active.includes("write") && !active.includes("edit"),
      `active=${JSON.stringify(active)}`,
    );
  } catch (e) {
    record("B.只读", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Case C（空）：profileTools = []
//   断言 active 为空数组（白名单为空 → 无任何工具，符合 sdk.js:132 [...tools]=[] ）。
// ---------------------------------------------------------------------------
async function caseC() {
  console.log("\n=== Case C（空）profileTools = [] ===");
  const fx = makeFixture("C");
  const faux = makeFaux();
  try {
    const session = await startSession(fx, faux, "空工具 agent", []);
    const active = session.getActiveToolNames();
    console.log(`    profileTools = []`);
    console.log(`    active       = ${JSON.stringify(active)}`);
    record(
      "C.active 为空数组（白名单为空 → 无任何工具）",
      Array.isArray(active) && active.length === 0,
      `active=${JSON.stringify(active)}`,
    );
  } catch (e) {
    record("C.空", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await caseA();
  await caseAPrime();
  await caseB();
  await caseC();

  console.log("\n=== RESULT ===");
  for (const c of checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  }
  const fails = checks.filter((c) => !c.pass);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  if (fails.length > 0) {
    console.log(`  FAIL 项: ${fails.map((f) => f.name).join("; ")}`);
    console.log("\n  命门结论: FAIL —— profile.tools 白名单与 guard 共存下受管写拦截不成立，接线需另想办法。");
    process.exit(1);
  }
  console.log(
    "\n  命门结论: PASS —— {...profileOptions(tools 白名单), ...guardOptions(noTools+customTools)} 共存下，" +
      "白名单只决定「有哪些工具」，guard 的同名 custom write/edit 仍覆盖内置、受管写仍被拦成 PendingChange。接线可行。",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("harness 顶层异常:", e);
  process.exit(1);
});
