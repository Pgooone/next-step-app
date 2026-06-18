/**
 * V2-0 · 工具机制 spike harness —— 验证 V2「文档实体 + 提议工具」模型的两个未确认命门。
 *
 * ========================= 命门（要回答的问题）=========================
 * V2 要给「文档会话」一套受限工具集：只读内置（read/grep/find/ls）+ 三个**全新自定义提议
 * 工具**（create_artifact / propose_edit / list_artifacts），并**禁掉 write/edit/bash**——
 * 让 AI 不能直接写盘，只能通过提议工具走「PendingChange → 按块确认 → 才写盘」的受管通道。
 *
 * 这与 P0 guard 的关键差异（也是必须新做 spike 的原因）：
 *   - P0 guard 走 `noTools:"builtin" + customTools:[同名 7 工具]`——customTools 用的是内核
 *     **同名**工厂（write/edit/...），靠「同名覆盖」改写盘行为。
 *   - V2 改走 `tools:[白名单] + customTools:[全新工具]`——customTools 是**全新工具名**
 *     （create_artifact 等，内核没有同名内置）。而内核 `_refreshToolRegistry`
 *     （agent-session.js:1818-1831）对 customTools **也按 `tools` 白名单（allowedToolNames）
 *     按名过滤**：`allCustomTools = [...registered, ...customTools].filter(t => isAllowedTool(t.name))`，
 *     `isAllowedTool(name) = (!allowedToolNames || allowedToolNames.has(name)) && !excluded?.has(name)`。
 *     → **一旦设了 tools 白名单，白名单漏掉某 customTool 名，它连注册都不到**（连激活集都进不去）。
 *
 * 所以本 spike 必须实证：白名单**显式含 3 个提议工具名**时它们能激活/能调起；漏名则被过滤。
 *
 * ===================== 两个命门 =====================
 *   命门 1：defineTool 精确签名——TypeBox parameters + 5 参 execute + AgentToolResult 返回结构。
 *   命门 2（D-V2-04，头号）：受限工具集组合行为——
 *           tools:["read","grep","find","ls", <3 提议工具名>] + customTools:[3 提议工具]
 *           下，自定义工具被激活、write/edit/bash 不在激活集、漏名则被过滤。
 *
 * ===================== 三条实证断言 =====================
 *   正向    ：3 个自定义提议工具在激活集；让 faux model 真发一次 propose_edit tool_use，
 *             断言其 execute 被调用且返回成功（闭环通）。
 *   负向①   ：write / edit / bash 不在激活集（白名单没放 → 不可用，无绕过防线）。
 *   负向②   ：把某自定义工具名从白名单移除（但仍留在 customTools）→ 它**不在**激活集
 *             （D-V2-04 反证：漏名则被内核过滤）。
 *
 * ===================== 跑法 =====================
 *   cwd = 仓库根 next-step-V1.1，执行：
 *     node --conditions=import --import tsx spike/v2-tools/harness.ts
 *   （或 `npm run --prefix spike/v2-tools spike`）
 *   为何 --conditions=import：本 harness import `@earendil-works/pi-coding-agent`，
 *   受仓库根 CJS package.json 管辖被 tsx 当 CJS；该包 exports 只给 import 条件，
 *   CJS require 解析会 ERR_PACKAGE_PATH_NOT_EXPORTED；--conditions=import 让 require 也走 import 导出。
 *
 * 红线：spike 只验证、不写 lib/ 生产码、不 commit、不 spawn 子 agent、不跑真浏览器。
 */
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  defineTool,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
// 命门 1：parameters 用 TypeBox（pi 包内部即用此包，写 schema 的来源）。
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// 结果记录（仿 spike/p0-*/harness.ts）
// ---------------------------------------------------------------------------
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`    [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

// ---------------------------------------------------------------------------
// faux 装配（直接复刻 spike/p0-profile-guard/harness.ts 的 makeFaux）
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

// ===========================================================================
// 命门 1：用 defineTool 定义 3 个全新「提议工具」最小可用样例。
//   - parameters：TypeBox Type.Object（命门 1 实证「parameters 是 TypeBox 不是 zod/JSON schema」）。
//   - execute：**5 参** (toolCallId, params, signal, onUpdate, ctx)，return AgentToolResult。
//   - 用 calls[] 记录每次 execute 被调用（正向断言「execute 真被调起」用）。
// ===========================================================================
const calls: { tool: string; params: unknown }[] = [];

/**
 * AgentToolResult 成功返回的最小结构（与内核 write 工具 execute 返回同构：content[text] + details）。
 * 注意：`AgentToolResult<TDetails>` 的 TDetails **无默认值、必须显式给**（裸 `AgentToolResult`
 * 在 strict 下 tsc 报 TS2314）。本 spike 工具不带 details，故参数化为 `AgentToolResult<undefined>`。
 */
function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

// create_artifact：参数含 kind/title/content（V2 详设里的「新建文档」提议工具雏形）。
const createArtifactSchema = Type.Object({
  kind: Type.String(),
  title: Type.String(),
  content: Type.String(),
});
const createArtifactTool = defineTool({
  name: "create_artifact",
  label: "create_artifact",
  description: "新建一个受管文档实体（返回 artifactId）。文档会话只能通过它创建文档，不能直接写盘。",
  parameters: createArtifactSchema,
  async execute(
    _toolCallId: string,
    params: Static<typeof createArtifactSchema>,
    _signal: AbortSignal | undefined,
    _onUpdate,
    _ctx,
  ): Promise<AgentToolResult<undefined>> {
    calls.push({ tool: "create_artifact", params });
    return ok(`created artifact title=${params.title}`);
  },
});

// propose_edit：参数含 artifactId/newContent（V2 头号提议工具——改文档走 PendingChange）。
const proposeEditSchema = Type.Object({
  artifactId: Type.String(),
  newContent: Type.String(),
});
const proposeEditTool = defineTool({
  name: "propose_edit",
  label: "propose_edit",
  description: "对已存在受管文档提议一次整篇修改，转成 PendingChange（不写盘，待用户按块确认）。",
  parameters: proposeEditSchema,
  async execute(
    _toolCallId: string,
    params: Static<typeof proposeEditSchema>,
    _signal: AbortSignal | undefined,
    _onUpdate,
    _ctx,
  ): Promise<AgentToolResult<undefined>> {
    calls.push({ tool: "propose_edit", params });
    return ok(`proposed edit for ${params.artifactId}`);
  },
});

// list_artifacts：无必填参数（只读列举，演示空 schema 也能定义）。
const listArtifactsSchema = Type.Object({});
const listArtifactsTool = defineTool({
  name: "list_artifacts",
  label: "list_artifacts",
  description: "列出当前项目的全部受管文档（只读）。",
  parameters: listArtifactsSchema,
  async execute(
    _toolCallId: string,
    params: Static<typeof listArtifactsSchema>,
    _signal: AbortSignal | undefined,
    _onUpdate,
    _ctx,
  ): Promise<AgentToolResult<undefined>> {
    calls.push({ tool: "list_artifacts", params });
    return ok("[]");
  },
});

const PROPOSE_TOOLS = [createArtifactTool, proposeEditTool, listArtifactsTool];
const PROPOSE_NAMES = ["create_artifact", "propose_edit", "list_artifacts"];
// 受限白名单 = 只读内置 + 全部 3 个提议工具名（D-V2-04：必须显式含 customTool 名）。
const READONLY_BUILTINS = ["read", "grep", "find", "ls"];
const FULL_WHITELIST = [...READONLY_BUILTINS, ...PROPOSE_NAMES];
// 危险写工具（负向① 断言它们不在激活集）。
const FORBIDDEN = ["write", "edit", "bash"];

/**
 * 受限工具集起会话——本 spike 的核心 options 形态：
 *   { tools: 白名单, customTools: 提议工具, cwd, model, auth, registry }
 * 注意：与 P0 guard 不同，这里**不传 noTools**，靠 tools 白名单直接约束激活集。
 */
async function startRestrictedSession(
  cwd: string,
  faux: ReturnType<typeof makeFaux>,
  whitelist: string[],
  customTools: typeof PROPOSE_TOOLS,
) {
  const { session } = await createAgentSession({
    tools: whitelist,
    customTools,
    cwd,
    model: faux.model,
    authStorage: faux.authStorage,
    modelRegistry: faux.modelRegistry,
  });
  return session;
}

function makeTmpCwd(tag: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `ns-v2-tools-${tag}-`));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ===========================================================================
// 断言 1（正向）：受限组合下 3 个提议工具在激活集；让 faux 真发 propose_edit tool_use，
//   断言其 execute 被调用且返回成功（闭环通）。
// ===========================================================================
async function assertPositive() {
  console.log("\n=== 断言 1（正向）：自定义提议工具被激活 + execute 真被调起 ===");
  const { dir, cleanup } = makeTmpCwd("pos");
  calls.length = 0;
  const faux = makeFaux([
    // 第一回合：发一次 propose_edit tool_use（真触发 execute）
    () =>
      fauxAssistantMessage([
        fauxText("提议修改"),
        fauxToolCall("propose_edit", { artifactId: "art-1", newContent: "新正文\n" }),
      ]),
    // 第二回合：纯文本收尾（工具回合后内核会再要一次回复）
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    const session = await startRestrictedSession(dir, faux, FULL_WHITELIST, PROPOSE_TOOLS);
    const active = session.getActiveToolNames();

    // (a) 3 个提议工具都在激活集（D-V2-04 正面：白名单含名 → 能注册/激活）
    const missing = PROPOSE_NAMES.filter((n) => !active.includes(n));
    record(
      "1a.白名单含 3 提议工具名 → 它们全在激活集（D-V2-04 正面）",
      missing.length === 0,
      `active=${JSON.stringify(active)}, 缺失=${JSON.stringify(missing)}`,
    );

    // (b) 只读内置也在激活集（受限集既挂自定义工具、又激活只读内置）
    const missingRO = READONLY_BUILTINS.filter((n) => !active.includes(n));
    record(
      "1b.只读内置 read/grep/find/ls 也在激活集（与自定义工具共存）",
      missingRO.length === 0,
      `缺失只读=${JSON.stringify(missingRO)}`,
    );

    // (c) 自定义工具的 ToolDefinition 能被内核取到，label 正确（确认 defineTool 注册成功）
    const def = session.getToolDefinition("propose_edit");
    record(
      "1c.内核能取到 propose_edit 的 ToolDefinition（defineTool 注册成功）",
      !!def && def.name === "propose_edit" && def.label === "propose_edit",
      `def.name=${def?.name}, def.label=${def?.label}`,
    );

    // (d) 让 faux 真发 propose_edit tool_use → 断言 execute 被调用且参数透传正确
    await session.prompt("帮我改文档");
    const proposeCall = calls.find((c) => c.tool === "propose_edit");
    const params = proposeCall?.params as { artifactId?: string; newContent?: string } | undefined;
    record(
      "1d.闭环：faux 发 propose_edit tool_use → execute 被调用且参数透传正确（5 参签名跑通）",
      !!proposeCall && params?.artifactId === "art-1" && params?.newContent === "新正文\n",
      `调用记录=${JSON.stringify(calls)}`,
    );
  } catch (e) {
    record("1.正向", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    cleanup();
  }
}

// ===========================================================================
// 断言 2（负向①）：write / edit / bash 不在激活集（白名单没放 → 不可用，无绕过防线）。
//   同时再发一次 list_artifacts 证明只读自定义工具也能调起（双保险闭环）。
// ===========================================================================
async function assertNegativeForbidden() {
  console.log("\n=== 断言 2（负向①）：write/edit/bash 不在激活集（无绕过） ===");
  const { dir, cleanup } = makeTmpCwd("neg1");
  calls.length = 0;
  const faux = makeFaux([
    () =>
      fauxAssistantMessage([
        fauxText("列出文档"),
        fauxToolCall("list_artifacts", {}),
      ]),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  try {
    const session = await startRestrictedSession(dir, faux, FULL_WHITELIST, PROPOSE_TOOLS);
    const active = session.getActiveToolNames();

    const leaked = FORBIDDEN.filter((n) => active.includes(n));
    record(
      "2a.write/edit/bash 均不在激活集（白名单未放 → 文档会话无写盘/执行能力）",
      leaked.length === 0,
      `active=${JSON.stringify(active)}, 泄漏=${JSON.stringify(leaked)}`,
    );

    // 内核侧也取不到这些工具的 ToolDefinition（彻底不可调）
    const writeDef = session.getToolDefinition("write");
    const bashDef = session.getToolDefinition("bash");
    record(
      "2b.内核取不到 write/bash 的 ToolDefinition（彻底不可调，非仅 UI 隐藏）",
      !writeDef && !bashDef,
      `write.def=${writeDef ? "存在" : "undefined"}, bash.def=${bashDef ? "存在" : "undefined"}`,
    );

    // 只读自定义工具 list_artifacts 能调起（再证闭环、双保险）
    await session.prompt("列一下");
    record(
      "2c.list_artifacts（只读自定义工具）execute 也能调起",
      calls.some((c) => c.tool === "list_artifacts"),
      `调用记录=${JSON.stringify(calls)}`,
    );
  } catch (e) {
    record("2.负向①", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    cleanup();
  }
}

// ===========================================================================
// 断言 3（负向②，D-V2-04 反证）：把 propose_edit 从白名单移除（但仍留在 customTools）→
//   它**不在**激活集（漏名则被内核 _refreshToolRegistry 按 allowedToolNames 过滤掉）。
//   这正是 review 揪出的原设计 blocker：白名单必须显式含全部 customTool 名。
// ===========================================================================
async function assertNegativeMissingName() {
  console.log("\n=== 断言 3（负向②，D-V2-04 反证）：白名单漏名 → 该 customTool 被过滤 ===");
  const { dir, cleanup } = makeTmpCwd("neg2");
  // 白名单故意**不含** propose_edit，但 customTools 仍传全部 3 个
  const whitelistMissing = [...READONLY_BUILTINS, "create_artifact", "list_artifacts"];
  const faux = makeFaux([() => fauxAssistantMessage([fauxText("noop")])]);
  try {
    const session = await startRestrictedSession(dir, faux, whitelistMissing, PROPOSE_TOOLS);
    const active = session.getActiveToolNames();

    // 关键反证：propose_edit 在 customTools 里、但白名单没它名 → 不在激活集
    record(
      "3a.D-V2-04 反证：propose_edit 在 customTools 但白名单漏名 → 不在激活集（被内核过滤）",
      !active.includes("propose_edit"),
      `active=${JSON.stringify(active)}`,
    );
    // 对照：白名单含名的 create_artifact / list_artifacts 仍在激活集（确认是「按名过滤」非「全灭」）
    record(
      "3b.对照：白名单含名的 create_artifact/list_artifacts 仍激活（证明是按名过滤）",
      active.includes("create_artifact") && active.includes("list_artifacts"),
      `active=${JSON.stringify(active)}`,
    );
    // 内核侧也取不到 propose_edit 的 ToolDefinition（连注册都没到，印证「漏名则连注册都不到」）
    const proposeDef = session.getToolDefinition("propose_edit");
    record(
      "3c.内核取不到被漏名的 propose_edit ToolDefinition（连注册都没到）",
      !proposeDef,
      `propose_edit.def=${proposeDef ? "存在" : "undefined"}`,
    );
  } catch (e) {
    record("3.负向②", false, `抛错: ${(e as Error).message}`);
  } finally {
    faux.unregister();
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await assertPositive();
  await assertNegativeForbidden();
  await assertNegativeMissingName();

  console.log("\n=== RESULT ===");
  for (const c of checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  }
  const fails = checks.filter((c) => !c.pass);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  if (fails.length > 0) {
    console.log(`  FAIL 项: ${fails.map((f) => f.name).join("; ")}`);
    console.log("\n  结论: NO-GO —— 受限工具集组合或 defineTool 签名未按预期成立。");
    process.exit(1);
  }
  console.log(
    "\n  结论: GO —— defineTool（TypeBox parameters + 5 参 execute + AgentToolResult 返回）跑通；" +
      "受限组合 { tools:[只读内置+3提议工具名], customTools:[3提议工具] } 下：" +
      "3 提议工具被激活且 execute 可调起、write/edit/bash 不在激活集、白名单漏名则该 customTool 被过滤（D-V2-04 实证）。",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("harness 顶层异常:", e);
  process.exit(1);
});
