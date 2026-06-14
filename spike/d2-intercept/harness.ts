/**
 * D2 拦截验证 harness
 *
 * 证明：不 fork pi 内核，用自定义工具替换内置 write/edit，
 *      让 agent 的写盘动作不落磁盘、改动被我们捕获。
 *
 * 跑法：cd 到本目录后 `npx tsx harness.ts`
 *
 * 分层：
 *   Tier 1a — 纯 execute 验证（不建会话，合格底线）
 *   Tier 1b — 会话装配验证（建会话，确认替身覆盖内置）
 *             含 excludeTools vs noTools:"builtin" 实测对比
 *   Tier 2  — faux 驱动端到端（用 faux provider 让 agent 真发一次 write 工具调用）
 */

import { createAgentSession, defineTool, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
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
// 捕获区：替身工具把"本该写盘的内容"推到这里，而不是落磁盘
// ---------------------------------------------------------------------------
type Capture =
  | { tool: "write"; path: string; content: string }
  | { tool: "edit"; path: string; patch: string; edits: { oldText: string; newText: string }[] };

const captured: Capture[] = [];

// ---------------------------------------------------------------------------
// 替身工具定义：参数 schema 对齐内置，execute 内不写盘
// ---------------------------------------------------------------------------
const REPLACEMENT_LABEL_WRITE = "[D2-intercept] write";
const REPLACEMENT_LABEL_EDIT = "[D2-intercept] edit";

const customWrite = defineTool({
  name: "write",
  label: REPLACEMENT_LABEL_WRITE,
  description: "Write a file (intercepted: captured in-memory, never touches disk).",
  parameters: Type.Object({
    path: Type.String(),
    content: Type.String(),
  }),
  async execute(_toolCallId, params): Promise<AgentToolResult<undefined>> {
    // 关键：不写盘，只捕获
    captured.push({ tool: "write", path: params.path, content: params.content });
    return {
      content: [{ type: "text", text: `Captured write to ${params.path} (${params.content.length} bytes), not written to disk.` }],
      details: undefined,
    };
  },
});

type EditDetails = { diff: string; patch: string; firstChangedLine?: number };

const customEdit = defineTool({
  name: "edit",
  label: REPLACEMENT_LABEL_EDIT,
  description: "Edit a file (intercepted: captured in-memory, never touches disk).",
  parameters: Type.Object({
    path: Type.String(),
    edits: Type.Array(
      Type.Object({
        oldText: Type.String(),
        newText: Type.String(),
      }),
    ),
  }),
  async execute(_toolCallId, params): Promise<AgentToolResult<EditDetails>> {
    // 造一个最小 unified patch 字符串（不读盘、不写盘）
    const patch = params.edits
      .map(
        (e) =>
          `--- ${params.path}\n+++ ${params.path}\n@@\n-${e.oldText}\n+${e.newText}`,
      )
      .join("\n");
    captured.push({ tool: "edit", path: params.path, patch, edits: params.edits });
    return {
      content: [{ type: "text", text: `Captured edit to ${params.path} (${params.edits.length} hunks), not written to disk.` }],
      details: { diff: patch, patch, firstChangedLine: 1 },
    };
  },
});

// ---------------------------------------------------------------------------
// 结果记录
// ---------------------------------------------------------------------------
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

// scratch 目录
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "d2-intercept-"));

// ---------------------------------------------------------------------------
// Tier 1a — 纯 execute 验证（不建会话）
// ---------------------------------------------------------------------------
async function tier1a() {
  console.log("\n=== Tier 1a: 纯 execute 验证（不建会话）===");
  const fakeCtx = {} as any; // execute 内部未用到 ctx 字段

  // write
  const writeProbe = path.join(scratchDir, "probe-write.md");
  captured.length = 0;
  const writeRes = await customWrite.execute("t-write-1", { path: writeProbe, content: "HELLO" }, undefined, undefined, fakeCtx);
  record(
    "1a.write 文件未落盘",
    fs.existsSync(writeProbe) === false,
    `fs.existsSync(${path.basename(writeProbe)})=${fs.existsSync(writeProbe)}`,
  );
  record(
    "1a.write 改动被捕获",
    captured.some((c) => c.tool === "write" && c.path === writeProbe && c.content === "HELLO"),
    `captured=${JSON.stringify(captured)}`,
  );
  record(
    "1a.write 返回 shape 合法 (content[].text + details=undefined)",
    Array.isArray(writeRes.content) && writeRes.content[0]?.type === "text" && writeRes.details === undefined,
    `details=${String(writeRes.details)}`,
  );

  // edit
  const editProbe = path.join(scratchDir, "probe-edit.md");
  captured.length = 0;
  const editRes = await customEdit.execute(
    "t-edit-1",
    { path: editProbe, edits: [{ oldText: "a", newText: "b" }] },
    undefined,
    undefined,
    fakeCtx,
  );
  record(
    "1a.edit 文件未创建/修改",
    fs.existsSync(editProbe) === false,
    `fs.existsSync(${path.basename(editProbe)})=${fs.existsSync(editProbe)}`,
  );
  record(
    "1a.edit patch 被捕获",
    captured.some((c) => c.tool === "edit" && c.path === editProbe && c.patch.includes("-a") && c.patch.includes("+b")),
    `captured[0].patch=${JSON.stringify((captured[0] as any)?.patch)}`,
  );
  record(
    "1a.edit 返回 shape 合法 (details.diff+patch)",
    typeof editRes.details?.patch === "string" && typeof editRes.details?.diff === "string",
    `details keys=${Object.keys(editRes.details ?? {}).join(",")}`,
  );
}

// ---------------------------------------------------------------------------
// faux model：拿一个可用 model 实例，避免依赖真实凭证
// 注意：prompt() 预检 hasConfiguredAuth()，所以还要喂一个内存假 key，
//       否则即便用 faux 也会抛 "No API key found"。
// ---------------------------------------------------------------------------
function makeFauxModel() {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux Test Model", contextWindow: 200000, maxTokens: 8192 }],
  });
  return reg;
}

function makeFauxAuthStorage() {
  // 内存假 key，满足 modelRegistry.hasConfiguredAuth("faux")
  return AuthStorage.inMemory({ faux: { type: "api_key", key: "dummy-key" } });
}

// ---------------------------------------------------------------------------
// Tier 1b — 会话装配验证（含 excludeTools vs noTools 对比）
// ---------------------------------------------------------------------------
async function tier1b() {
  console.log("\n=== Tier 1b: 会话装配验证 ===");

  // --- 组合 A: excludeTools + customTools ---
  console.log("\n  -- 组合 A: excludeTools:['write','edit'] + customTools --");
  let labelA_write = "(n/a)";
  let activeA: string[] = [];
  try {
    const regA = makeFauxModel();
    const { session } = await createAgentSession({
      cwd: scratchDir,
      model: regA.getModel(),
      authStorage: makeFauxAuthStorage(),
      excludeTools: ["write", "edit"],
      customTools: [customWrite, customEdit],
    });
    activeA = session.getActiveToolNames();
    labelA_write = session.getToolDefinition("write")?.label ?? "(undefined)";
    console.log(`    activeToolNames = ${JSON.stringify(activeA)}`);
    console.log(`    getToolDefinition('write').label = ${labelA_write}`);
    console.log(`    getToolDefinition('edit').label  = ${session.getToolDefinition("edit")?.label ?? "(undefined)"}`);
    regA.unregister();
  } catch (e) {
    console.log(`    组合 A 抛错: ${(e as Error).message}`);
  }
  const aHasWrite = activeA.includes("write");
  const aIsReplacement = labelA_write === REPLACEMENT_LABEL_WRITE;
  // 预期结论（不是缺陷）：excludeTools 是 denylist，最后一步作用于"按名字"的工具，
  // 会把同名替身 write/edit 一起剔除 → 替身不会激活。PASS 表示"确认了这一行为"。
  record(
    "1b.A excludeTools 不激活替身（符合预期：同名被一并剔除）",
    !aHasWrite && !aIsReplacement,
    `active=${JSON.stringify(activeA)}, write.label=${labelA_write}`,
  );

  // --- 组合 B: noTools:"builtin" + customTools ---
  console.log("\n  -- 组合 B: noTools:'builtin' + customTools --");
  let labelB_write = "(n/a)";
  let activeB: string[] = [];
  try {
    const regB = makeFauxModel();
    const { session } = await createAgentSession({
      cwd: scratchDir,
      model: regB.getModel(),
      authStorage: makeFauxAuthStorage(),
      noTools: "builtin",
      customTools: [customWrite, customEdit],
    });
    activeB = session.getActiveToolNames();
    labelB_write = session.getToolDefinition("write")?.label ?? "(undefined)";
    console.log(`    activeToolNames = ${JSON.stringify(activeB)}`);
    console.log(`    getToolDefinition('write').label = ${labelB_write}`);
    console.log(`    getToolDefinition('edit').label  = ${session.getToolDefinition("edit")?.label ?? "(undefined)"}`);
    regB.unregister();
  } catch (e) {
    console.log(`    组合 B 抛错: ${(e as Error).message}`);
  }
  const bHasWrite = activeB.includes("write");
  const bIsReplacement = labelB_write === REPLACEMENT_LABEL_WRITE;
  record("1b.B noTools:builtin — active 含 write", bHasWrite, `active=${JSON.stringify(activeB)}`);
  record("1b.B noTools:builtin — write 是替身", bIsReplacement, `label=${labelB_write}`);

  return {
    A: { hasWrite: aHasWrite, isReplacement: aIsReplacement, active: activeA, label: labelA_write },
    B: { hasWrite: bHasWrite, isReplacement: bIsReplacement, active: activeB, label: labelB_write },
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — faux 驱动端到端：让 agent 真发一次 write 工具调用
// ---------------------------------------------------------------------------
async function tier2(useNoTools: boolean) {
  console.log(`\n=== Tier 2: faux 驱动端到端 (组合=${useNoTools ? "noTools:builtin" : "excludeTools"}) ===`);
  const probe = path.join(scratchDir, "tier2-probe.md");
  captured.length = 0;
  try {
    // 1) 注册 faux 到全局 api-registry，设定它发一次 write 工具调用、再收尾
    const reg = registerFauxProvider({ api: "faux", provider: "faux", models: [{ id: "faux-1" }] });
    reg.setResponses([
      (_ctx, _opts, state) => {
        console.log(`    [faux] stream call #${state.callCount} -> 返回带 write toolCall 的消息`);
        return fauxAssistantMessage([
          fauxText("I'll write the file."),
          fauxToolCall("write", { path: probe, content: "FROM-AGENT" }),
        ]);
      },
      (_ctx, _opts, state) => {
        console.log(`    [faux] stream call #${state.callCount} -> 返回收尾消息 Done.`);
        return fauxAssistantMessage([fauxText("Done.")]);
      },
    ]);

    // 2) 关键：createAgentSession 内部 ModelRegistry.refresh() 会 resetApiProviders()，
    //    把"裸" registerFauxProvider 的注册清掉。所以必须把 faux 作为"已知 provider"
    //    通过 ModelRegistry.registerProvider 注册（带捕获到的 streamSimple），refresh 后才存活。
    const liveFaux: any = getApiProvider("faux");
    const capturedStreamSimple = liveFaux.streamSimple ?? liveFaux.stream;
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

    const sessionOpts: any = {
      cwd: scratchDir,
      model,
      authStorage,
      modelRegistry,
      customTools: [customWrite, customEdit],
    };
    if (useNoTools) sessionOpts.noTools = "builtin";
    else sessionOpts.excludeTools = ["write", "edit"];

    const { session } = await createAgentSession(sessionOpts);

    // 订阅事件以便观测
    const seenEvents: string[] = [];
    const unsub = session.subscribe((ev: any) => {
      if (ev?.type) {
        seenEvents.push(ev.type);
        // 打印工具相关事件细节
        if (String(ev.type).includes("tool")) {
          console.log(`    [event] ${ev.type} ${ev.toolName ? "tool=" + ev.toolName : ""}`);
        }
      }
    });

    await session.prompt("Please create the file.");

    unsub();
    reg.unregister();

    console.log(`    seen event types: ${JSON.stringify([...new Set(seenEvents)])}`);
    const wroteToDisk = fs.existsSync(probe);
    const capturedIt = captured.some((c) => c.tool === "write" && c.path === probe && c.content === "FROM-AGENT");
    record("2.agent 走进替身 (captured 命中)", capturedIt, `captured=${JSON.stringify(captured)}`);
    record("2.磁盘无文件", wroteToDisk === false, `fs.existsSync(${path.basename(probe)})=${wroteToDisk}`);
    return { ran: true, capturedIt, wroteToDisk };
  } catch (e) {
    console.log(`    Tier 2 skipped/失败: ${(e as Error).stack ?? (e as Error).message}`);
    record("2.端到端", false, `skipped: ${(e as Error).message}`);
    return { ran: false, capturedIt: false, wroteToDisk: false };
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`scratchDir = ${scratchDir}`);
  await tier1a();
  const cmp = await tier1b();
  // Tier 2 用 1b 判定出的"能激活替身"的组合；若都不行则用 excludeTools 试
  const useNoTools = cmp.B.isReplacement && !cmp.A.isReplacement ? true : false;
  const t2 = await tier2(useNoTools);

  // 清理
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {}

  // 汇总
  console.log("\n=== RESULT ===");
  for (const c of checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  }
  console.log("\n--- excludeTools vs noTools:builtin 实测 ---");
  console.log(`  组合 A (excludeTools)   : active含write=${cmp.A.hasWrite}, write是替身=${cmp.A.isReplacement}, label=${cmp.A.label}`);
  console.log(`  组合 B (noTools:builtin): active含write=${cmp.B.hasWrite}, write是替身=${cmp.B.isReplacement}, label=${cmp.B.label}`);
  console.log(`  Tier 2 选用组合         : ${useNoTools ? "noTools:builtin" : "excludeTools"}, 跑起来=${t2.ran}`);

  const fails = checks.filter((c) => !c.pass);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  if (fails.length > 0) {
    console.log(`  FAIL 项: ${fails.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("harness 顶层异常:", e);
  process.exit(1);
});
