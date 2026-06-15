/**
 * D2 阶段0 命门验证：在「保留 read/bash/grep/find/ls」的同时「用替身替换 write/edit」。
 *
 * 背景：原 harness.ts 用 noTools:"builtin" + customTools:[替身 write/edit]，
 *      但那样 getActiveToolNames() 只剩替身 write/edit——read/bash/grep/find/ls 全没了。
 *      真实 agent 会话必须保留这些只读/执行工具才能干活。
 *
 * 本脚本实测三个候选，验证标准：
 *   起 faux 会话后 session.getActiveToolNames() 同时含
 *   {read, bash, grep, find, ls, write, edit}，且 write/edit 是替身。
 *
 * 候选：
 *   (a) noTools:"builtin" + customTools:[替身 write/edit + 内核工厂重建 read/bash/grep/find/ls]
 *   (b) tools:["read","bash","grep","find","ls"] (allowlist 不含 write/edit) + customTools:[替身 write/edit]
 *   (c) 默认内置集 + 用 createWriteToolDefinition(cwd,{operations}) / createEditToolDefinition 注入捕获式 writeFile
 *
 * 跑法：cd 到本目录后 `npx tsx stage0-toolset.ts`
 */

import {
  createAgentSession,
  defineTool,
  AuthStorage,
  ModelRegistry,
  createReadToolDefinition,
  createBashToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Type,
  registerFauxProvider,
  fauxToolCall,
  fauxText,
  fauxAssistantMessage,
  getApiProvider,
} from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// 结果记录
// ---------------------------------------------------------------------------
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "d2-stage0-"));
const EXPECTED = ["read", "bash", "grep", "find", "ls", "write", "edit"];

// ---------------------------------------------------------------------------
// 替身 write/edit（同 harness：execute 不写盘，只捕获）
// ---------------------------------------------------------------------------
const captured: { tool: string; path: string }[] = [];
const LABEL_WRITE = "[D2-intercept] write";
const LABEL_EDIT = "[D2-intercept] edit";

const customWrite = defineTool({
  name: "write",
  label: LABEL_WRITE,
  description: "Write a file (intercepted: captured, never disk).",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  async execute(_id, params): Promise<AgentToolResult<undefined>> {
    captured.push({ tool: "write", path: params.path });
    return { content: [{ type: "text", text: "captured" }], details: undefined };
  },
});

type EditDetails = { diff: string; patch: string; firstChangedLine?: number };
const customEdit = defineTool({
  name: "edit",
  label: LABEL_EDIT,
  description: "Edit a file (intercepted: captured, never disk).",
  parameters: Type.Object({
    path: Type.String(),
    edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
  }),
  async execute(_id, params): Promise<AgentToolResult<EditDetails>> {
    captured.push({ tool: "edit", path: params.path });
    return {
      content: [{ type: "text", text: "captured" }],
      details: { diff: "", patch: "", firstChangedLine: 1 },
    };
  },
});

// ---------------------------------------------------------------------------
// faux 装配（复刻 harness Tier 2 / agent-profile-session.test.ts：扛 refresh 的 resetApiProviders）
// ---------------------------------------------------------------------------
function makeFaux(responses?: Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0]) {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
  });
  // 关键（同 harness Tier 2）：setResponses 必须在 getApiProvider 捕获 streamSimple 之前，
  // 这样捕获到的闭包已绑定这批预置响应；建 session 后再起 reg 覆盖不了已捕获的闭包。
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

function summarizeSession(session: any) {
  const active: string[] = session.getActiveToolNames();
  const writeLabel = session.getToolDefinition("write")?.label ?? "(undefined)";
  const editLabel = session.getToolDefinition("edit")?.label ?? "(undefined)";
  const hasAll = EXPECTED.every((t) => active.includes(t));
  const writeIsReplacement = writeLabel === LABEL_WRITE;
  const editIsReplacement = editLabel === LABEL_EDIT;
  return { active, writeLabel, editLabel, hasAll, writeIsReplacement, editIsReplacement };
}

// ---------------------------------------------------------------------------
// 候选 (a)：noTools:"builtin" + customTools[替身 write/edit + 内核工厂重建只读/bash]
// ---------------------------------------------------------------------------
async function candidateA() {
  console.log("\n=== 候选 (a): noTools:'builtin' + customTools[替身 write/edit + 重建 read/bash/grep/find/ls] ===");
  const faux = makeFaux();
  try {
    // 注意 createReadOnlyToolDefinitions 只给 read/grep/find/ls（不含 bash），故 bash 单独建
    // 关键实现注意点：内核工厂返回的具体 ToolDefinition<具体schema,具体details> 因 renderCall/parameters
    // 泛型逆变，不能直接赋给 ToolDefinition[]（= ToolDefinition<TSchema,unknown>[]）。须用内核 ToolDef
    // 的形态 ToolDefinition<any,any>[]（内核自己的 createCodingToolDefinitions 也用 any 规避方差）。
    const rebuilt: ToolDefinition<any, any>[] = [
      createReadToolDefinition(scratchDir),
      createBashToolDefinition(scratchDir),
      createGrepToolDefinition(scratchDir),
      createFindToolDefinition(scratchDir),
      createLsToolDefinition(scratchDir),
    ];
    const { session } = await createAgentSession({
      cwd: scratchDir,
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
      noTools: "builtin",
      customTools: [customWrite, customEdit, ...rebuilt],
    });
    const s = summarizeSession(session);
    console.log(`    active = ${JSON.stringify(s.active)}`);
    console.log(`    write.label = ${s.writeLabel} | edit.label = ${s.editLabel}`);
    record("(a) active 含全部 7 工具", s.hasAll, `缺: ${EXPECTED.filter((t) => !s.active.includes(t)).join(",") || "无"}`);
    record("(a) write 是替身", s.writeIsReplacement, s.writeLabel);
    record("(a) edit 是替身", s.editIsReplacement, s.editLabel);
    return s;
  } catch (e) {
    record("(a) 起会话", false, (e as Error).message);
    return null;
  } finally {
    faux.unregister();
  }
}

// ---------------------------------------------------------------------------
// 候选 (b)：tools:["read","bash","grep","find","ls"] + customTools[替身 write/edit]
//   验证 allowlist 不含 write/edit 时，customTools 能否补上 write/edit（不被 allowlist 挡掉）
// ---------------------------------------------------------------------------
async function candidateB() {
  console.log("\n=== 候选 (b): tools:['read','bash','grep','find','ls'] (allowlist) + customTools[替身 write/edit] ===");
  const faux = makeFaux();
  try {
    const { session } = await createAgentSession({
      cwd: scratchDir,
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
      tools: ["read", "bash", "grep", "find", "ls"],
      customTools: [customWrite, customEdit],
    });
    const s = summarizeSession(session);
    console.log(`    active = ${JSON.stringify(s.active)}`);
    console.log(`    write.label = ${s.writeLabel} | edit.label = ${s.editLabel}`);
    record("(b) active 含全部 7 工具", s.hasAll, `缺: ${EXPECTED.filter((t) => !s.active.includes(t)).join(",") || "无"}`);
    record("(b) write 是替身", s.writeIsReplacement, s.writeLabel);
    record("(b) edit 是替身", s.editIsReplacement, s.editLabel);
    return s;
  } catch (e) {
    record("(b) 起会话", false, (e as Error).message);
    return null;
  } finally {
    faux.unregister();
  }
}

// ---------------------------------------------------------------------------
// 候选 (c)：默认内置集 + createWriteToolDefinition(cwd,{operations}) 注入捕获式 writeFile
//   保留内置 write 的 name/schema/diff，把"写盘动作"换成捕获。验证 operations.writeFile 拿到的路径形态。
// ---------------------------------------------------------------------------
async function candidateC() {
  console.log("\n=== 候选 (c): 内置集 + createWriteToolDefinition(cwd,{operations:{writeFile 捕获}}) ===");
  const probe = path.join(scratchDir, "subdir", "c-probe.md");
  const faux = makeFaux([
    () => fauxAssistantMessage([fauxText("writing"), fauxToolCall("write", { path: probe, content: "C-CONTENT" })]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  const opCaptured: { absolutePath: string; bytes: number }[] = [];
  try {
    const captureWrite = createWriteToolDefinition(scratchDir, {
      operations: {
        async writeFile(absolutePath: string, content: string) {
          // 关键：内核已把路径 resolve 成绝对路径再传进来；我们不真写盘，只捕获
          opCaptured.push({ absolutePath, bytes: content.length });
        },
        async mkdir(_dir: string) {
          /* 捕获式：不建目录 */
        },
      },
    });
    // edit 同理（其 operations 是 EditOperations，签名不同，先只验 write 的注入点形态）
    const captureEdit = createEditToolDefinition(scratchDir);

    const { session } = await createAgentSession({
      cwd: scratchDir,
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
      noTools: "builtin",
      customTools: [
        captureWrite,
        captureEdit,
        createReadToolDefinition(scratchDir),
        createBashToolDefinition(scratchDir),
        createGrepToolDefinition(scratchDir),
        createFindToolDefinition(scratchDir),
        createLsToolDefinition(scratchDir),
      ] as ToolDefinition<any, any>[],
    });
    const active: string[] = session.getActiveToolNames();
    const hasAll = EXPECTED.every((t) => active.includes(t));
    console.log(`    active = ${JSON.stringify(active)}`);
    console.log(`    write.label = ${session.getToolDefinition("write")?.label}`);
    record("(c) active 含全部 7 工具", hasAll, `缺: ${EXPECTED.filter((t) => !active.includes(t)).join(",") || "无"}`);

    // 端到端：faux 已在 makeFaux 时预置发一次 write，看 operations.writeFile 是否捕获、磁盘是否真无文件、路径形态
    await session.prompt("write the file");
    const onDisk = fs.existsSync(probe);
    console.log(`    operations.writeFile 捕获 = ${JSON.stringify(opCaptured)}`);
    record("(c) operations.writeFile 命中且磁盘无文件", opCaptured.length > 0 && !onDisk, `captured=${opCaptured.length}, onDisk=${onDisk}`);
    record(
      "(c) writeFile 收到绝对路径(已 resolve)",
      opCaptured.length > 0 && path.isAbsolute(opCaptured[0]!.absolutePath),
      opCaptured[0]?.absolutePath ?? "(none)",
    );
    return { hasAll, opCaptured };
  } catch (e) {
    record("(c) 起会话/端到端", false, (e as Error).stack ?? (e as Error).message);
    return null;
  } finally {
    faux.unregister();
  }
}

// ---------------------------------------------------------------------------
// 端到端补验（对推荐候选）：faux 发 write，替身命中 + 磁盘无文件；其余只读工具仍可用（getToolDefinition 命中内核实现）
// ---------------------------------------------------------------------------
async function endToEndOnReplacement(useNoTools: boolean) {
  console.log(`\n=== 端到端补验 (替身路线, ${useNoTools ? "候选a noTools" : "候选b allowlist"}) ===`);
  const probe = path.join(scratchDir, "e2e-probe.md");
  captured.length = 0;
  const faux = makeFaux([
    () => fauxAssistantMessage([fauxText("writing"), fauxToolCall("write", { path: probe, content: "FROM-AGENT" })]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    // 关键实现注意点：内核工厂返回的具体 ToolDefinition<具体schema,具体details> 因 renderCall/parameters
    // 泛型逆变，不能直接赋给 ToolDefinition[]（= ToolDefinition<TSchema,unknown>[]）。须用内核 ToolDef
    // 的形态 ToolDefinition<any,any>[]（内核自己的 createCodingToolDefinitions 也用 any 规避方差）。
    const rebuilt: ToolDefinition<any, any>[] = [
      createReadToolDefinition(scratchDir),
      createBashToolDefinition(scratchDir),
      createGrepToolDefinition(scratchDir),
      createFindToolDefinition(scratchDir),
      createLsToolDefinition(scratchDir),
    ];
    const opts: any = {
      cwd: scratchDir,
      model: faux.model,
      authStorage: faux.authStorage,
      modelRegistry: faux.modelRegistry,
      customTools: useNoTools ? [customWrite, customEdit, ...rebuilt] : [customWrite, customEdit],
    };
    if (useNoTools) opts.noTools = "builtin";
    else opts.tools = ["read", "bash", "grep", "find", "ls"];
    const { session } = await createAgentSession(opts);

    await session.prompt("write");

    const onDisk = fs.existsSync(probe);
    record("端到端 替身命中(captured)", captured.some((c) => c.tool === "write"), JSON.stringify(captured));
    record("端到端 磁盘无文件", !onDisk, `onDisk=${onDisk}`);
    // 只读工具仍是内核实现（label 不是替身、definition 存在）
    const readDef = session.getToolDefinition("read");
    record("端到端 read 工具在场(内核实现)", !!readDef, `read.label=${readDef?.label ?? "(none)"}`);
  } catch (e) {
    record("端到端", false, (e as Error).message);
  } finally {
    faux.unregister();
  }
}

async function main() {
  console.log(`scratchDir = ${scratchDir}`);
  const a = await candidateA();
  const b = await candidateB();
  const c = await candidateC();

  // 对能拿全 7 工具且替身生效的路线做端到端补验
  if (a?.hasAll && a.writeIsReplacement) await endToEndOnReplacement(true);
  if (b?.hasAll && b.writeIsReplacement) await endToEndOnReplacement(false);

  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=== RESULT ===");
  const fails = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  console.log(`\n  小结:`);
  console.log(`    候选(a) noTools+重建    : 全7工具=${a?.hasAll ?? "ERR"}, write替身=${a?.writeIsReplacement ?? "ERR"}, edit替身=${a?.editIsReplacement ?? "ERR"}`);
  console.log(`    候选(b) allowlist+custom: 全7工具=${b?.hasAll ?? "ERR"}, write替身=${b?.writeIsReplacement ?? "ERR"}, edit替身=${b?.editIsReplacement ?? "ERR"}`);
  console.log(`    候选(c) operations 注入 : 全7工具=${c?.hasAll ?? "ERR"}, writeFile捕获路径=${c?.opCaptured?.[0]?.absolutePath ?? "ERR"}`);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("stage0 顶层异常:", e);
  process.exit(1);
});
