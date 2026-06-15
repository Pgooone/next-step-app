/**
 * D2 阶段3 实测候选 C（lead 拍板 D-D2-1 要求实现到装配这步先实测 C）：
 * 用 createWriteToolDefinition(cwd,{operations}) / createEditToolDefinition(cwd,{operations})
 * 注入「自分流」的 readFile/writeFile：受管路径→拦截(读 versions 当前内容/捕获不写盘)，
 * 非受管路径→委托真实 fs（正常读写盘）。保留内核 name/schema/diff 生成 + edit 语义。
 *
 * 验证（faux 端到端）：
 *   1. edit 受管路径 → 注入 readFile 拿到「当前内容」、writeFile 被拦截(captured)、磁盘原文件不变、
 *      内核自动生成 details.diff/patch（C 的核心优势：edit 语义归内核）。
 *   2. edit 非受管路径 → 正常读写盘（真改了磁盘）。
 *   3. write 受管路径 → 注入 writeFile 拦截、磁盘无文件。
 *   4. getActiveToolNames() 含完整 7 工具集。
 *
 * 跑法：cd 到本目录后 `npx tsx stage0-candidate-c.ts`
 */

import {
  createAgentSession,
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
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  fauxToolCall,
  fauxText,
  fauxAssistantMessage,
  getApiProvider,
} from "@earendil-works/pi-ai";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
  access as fsAccess,
} from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

const scratch = mkdtempSync(path.join(os.tmpdir(), "d2-cand-c-"));
const EXPECTED = ["read", "bash", "grep", "find", "ls", "write", "edit"];

// ---- 模拟受管 artifact：managed/<id>/ 是受管根，"当前内容"由内存提供（替代 versions/<n>.json）----
const MANAGED_ID = "art-1";
const managedRoot = path.join(scratch, ".pi", "artifacts", "managed");
const managedDir = path.join(managedRoot, MANAGED_ID);
// 受管 artifact 的「当前版内容」——真实实现里来自 artifactService.readCurrentContent
const CURRENT_CONTENT = "line1\nOLD\nline3\n";

function isManaged(absPath: string): boolean {
  const rel = path.relative(managedRoot, path.resolve(absPath));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// 捕获区
const captured: { tool: "write" | "edit"; absPath: string; content: string }[] = [];

// ---- 自分流 operations ----
const writeOps = {
  async writeFile(absolutePath: string, content: string) {
    if (isManaged(absolutePath)) {
      captured.push({ tool: "write", absPath: absolutePath, content });
      return; // 拦截：不写盘
    }
    await fsWriteFile(absolutePath, content, "utf-8"); // 非受管：正常写
  },
  async mkdir(dir: string) {
    if (isManaged(dir)) return; // 受管不建目录
    await fsMkdir(dir, { recursive: true });
  },
};

const editOps = {
  async readFile(absolutePath: string): Promise<Buffer> {
    if (isManaged(absolutePath)) {
      // 受管：返回「当前版内容」（真实实现 readCurrentContent），而非读裸文件
      return Buffer.from(CURRENT_CONTENT, "utf-8");
    }
    return fsReadFile(absolutePath); // 非受管：真读盘
  },
  async writeFile(absolutePath: string, content: string) {
    if (isManaged(absolutePath)) {
      captured.push({ tool: "edit", absPath: absolutePath, content });
      return; // 拦截：不写盘
    }
    await fsWriteFile(absolutePath, content, "utf-8");
  },
  async access(absolutePath: string) {
    if (isManaged(absolutePath)) return; // 受管：视为可读写（内容在内存）
    await fsAccess(absolutePath);
  },
};

function makeFaux(responses?: Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0]) {
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

function guardTools(): ToolDefinition<any, any>[] {
  return [
    createWriteToolDefinition(scratch, { operations: writeOps }),
    createEditToolDefinition(scratch, { operations: editOps }),
    createReadToolDefinition(scratch),
    createBashToolDefinition(scratch),
    createGrepToolDefinition(scratch),
    createFindToolDefinition(scratch),
    createLsToolDefinition(scratch),
  ];
}

async function run() {
  console.log(`scratch = ${scratch}`);

  // --- 场景1：edit 受管路径 ---
  {
    captured.length = 0;
    const managedTarget = path.join(managedDir, "doc.md");
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("editing managed"),
          fauxToolCall("edit", { path: managedTarget, edits: [{ oldText: "OLD", newText: "NEW" }] }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const { session } = await createAgentSession({
        cwd: scratch,
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
        noTools: "builtin",
        customTools: guardTools(),
      });
      const active = session.getActiveToolNames();
      record("场景1 getActiveToolNames 含全 7 工具", EXPECTED.every((t) => active.includes(t)), JSON.stringify(active));

      // 订阅 tool_execution 结果观察 details
      let editDetails: any = undefined;
      const unsub = session.subscribe((ev: any) => {
        if (ev?.type === "tool_execution_end" && ev?.toolName === "edit") editDetails = ev?.result?.details ?? ev?.details;
      });
      await session.prompt("edit it");
      unsub();

      const hit = captured.find((c) => c.tool === "edit");
      record("场景1 edit 受管 → writeFile 被拦截(captured)", !!hit, JSON.stringify(captured.map((c) => c.tool)));
      record(
        "场景1 拦截内容是「当前内容应用 edit 后的新全文」(OLD→NEW)",
        !!hit && hit.content.includes("NEW") && !hit.content.includes("OLD") && hit.content.includes("line1"),
        JSON.stringify(hit?.content),
      );
      record("场景1 磁盘上受管目标文件不存在(未写盘)", !existsSync(managedTarget), `exists=${existsSync(managedTarget)}`);
      console.log(`    [观测] 内核自动生成的 edit details = ${JSON.stringify(editDetails)?.slice(0, 200)}`);
    } catch (e) {
      record("场景1 edit 受管", false, (e as Error).stack ?? (e as Error).message);
    } finally {
      faux.unregister();
    }
  }

  // --- 场景2：edit 非受管路径（正常读写盘）---
  {
    captured.length = 0;
    const normalFile = path.join(scratch, "normal.md");
    await fsWriteFile(normalFile, "alpha\nOLD\nbeta\n", "utf-8");
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("editing normal"),
          fauxToolCall("edit", { path: normalFile, edits: [{ oldText: "OLD", newText: "NEW" }] }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const { session } = await createAgentSession({
        cwd: scratch,
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
        noTools: "builtin",
        customTools: guardTools(),
      });
      await session.prompt("edit normal");
      const onDisk = readFileSync(normalFile, "utf-8");
      record("场景2 edit 非受管 → 未进 captured(放行)", captured.length === 0, JSON.stringify(captured.map((c) => c.tool)));
      record("场景2 edit 非受管 → 磁盘真的改了(OLD→NEW)", onDisk.includes("NEW") && !onDisk.includes("OLD"), JSON.stringify(onDisk));
    } catch (e) {
      record("场景2 edit 非受管", false, (e as Error).stack ?? (e as Error).message);
    } finally {
      faux.unregister();
    }
  }

  // --- 场景3：write 受管路径（拦截）---
  {
    captured.length = 0;
    const managedTarget = path.join(managedDir, "whole.md");
    const faux = makeFaux([
      () =>
        fauxAssistantMessage([
          fauxText("writing managed"),
          fauxToolCall("write", { path: managedTarget, content: "BRAND-NEW\nCONTENT\n" }),
        ]),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    try {
      const { session } = await createAgentSession({
        cwd: scratch,
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
        noTools: "builtin",
        customTools: guardTools(),
      });
      await session.prompt("write managed");
      const hit = captured.find((c) => c.tool === "write");
      record("场景3 write 受管 → 拦截(captured)", !!hit && hit.content.includes("BRAND-NEW"), JSON.stringify(hit?.content));
      record("场景3 write 受管 → 磁盘无文件", !existsSync(managedTarget), `exists=${existsSync(managedTarget)}`);
    } catch (e) {
      record("场景3 write 受管", false, (e as Error).stack ?? (e as Error).message);
    } finally {
      faux.unregister();
    }
  }

  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}

  console.log("\n=== RESULT ===");
  const fails = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
  console.log(`\n  总计: ${checks.length - fails.length}/${checks.length} PASS`);
  process.exit(fails.length > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("顶层异常:", e);
  process.exit(1);
});
