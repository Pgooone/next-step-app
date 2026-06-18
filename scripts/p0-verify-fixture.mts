/**
 * P0·verify fixture（一次性测试资产）。dev 须起着、tsx 在项目根跑。
 *
 * 与既有 fixture（d4/full 用 PendingChangeStore.save 手工造 pending）的关键区别：
 * 本 fixture 让 **faux agent 经真正的 `startProfileSession` + 已接线的 artifact-guard 真发一次 write**，
 * 由 guard 在真 wire 路径上把它拦成 PendingChange（= p0-verify 要的「agent 真发 write」、不是手工造）。
 *
 * 步骤：
 *  1. API 建项目/agent(tools 含 write/edit)/受管 artifact —— 走 dev server，dev 的 registry 缓存直接知道（避缓存坑）。
 *  2. 进程内 faux 驱动真 startProfileSession（不传 guardDepsOverride → guard 走默认文件后端 = dev 同一批 ~/.pi 文件）：
 *     faux agent 对受管路径发 write(NEW) → guard 读当前版当 oldContent、拦成 PendingChange 落盘、不写盘。
 *  3. setOwner 注册 session→agent，供左栏分组 + 让该会话非空（drive 选它离开欢迎态，PendingChangeCard 才挂载）。
 *  4. 末行打印 FIXTURE_JSON 供 drive 读。
 *
 * 跑法：node --conditions=import --import tsx scripts/p0-verify-fixture.mts
 * （需 --conditions=import：经 ../lib/*.ts 间接 import 内核包，同 spike/p0-* 的 CJS/ESM 解析约束。）
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthStorage, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  registerFauxProvider,
  getApiProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { startProfileSession, type RegisterInnerSession } from "../lib/pi/profile-session-wiring";
import { setOwner } from "../lib/domain/session-agent-map";
import type { AgentProfile } from "../lib/domain/agent-profile-store";

const URL = process.env.E2E_URL || "http://localhost:30141";
const api = (m: string, p: string, body?: unknown) =>
  fetch(URL + p, {
    method: m,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

// 1. 建项目 / agent(tools 含 write,edit) / 受管 artifact（经 API，dev 直接知道）
const root = mkdtempSync(join(tmpdir(), "ns-p0-verify-"));
const projR = await api("POST", "/api/projects", { name: `P0验收-${Date.now()}`, root });
if (!projR.ok) throw new Error(`建项目失败 ${projR.status} ${await projR.text()}`);
const proj = (await projR.json()) as { id: string; root: string };

const agentR = await api("POST", `/api/projects/${proj.id}/agents`, {
  name: "P0验收师",
  role: "受管产物编辑",
  tools: ["read", "write", "edit"], // 必含 write/edit，否则内核 allowlist 不激活 write（配置约束，D-V1.1-12/13）
});
if (!agentR.ok) throw new Error(`建 agent 失败 ${agentR.status} ${await agentR.text()}`);
const profile = (await agentR.json()) as AgentProfile;

const OLD = ["# P0 验收产物", "", "## 概述", "原始第一段，作为未变锚点。", "这一行将被 agent 改写。", "收尾行，保持不变。"].join("\n") + "\n";
const NEW = ["# P0 验收产物", "", "## 概述", "原始第一段，作为未变锚点。", "这一行已被 agent 改写。", "收尾行，保持不变。", "新增：agent 追加的一段。"].join("\n") + "\n";
const artR = await api("POST", `/api/projects/${proj.id}/artifacts`, { kind: "design", title: "P0-受管产物", content: OLD });
if (!artR.ok) throw new Error(`建 artifact 失败 ${artR.status} ${await artR.text()}`);
const art = (await artR.json()) as { id: string };

// 2. faux 装配（复刻 artifact-guard.test.ts：setResponses 须在捕获 streamSimple 之前）
const target = join(proj.root, ".pi", "artifacts", "managed", art.id, "doc.md");
const reg = registerFauxProvider({
  api: "faux",
  provider: "faux",
  models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
});
reg.setResponses([
  () =>
    fauxAssistantMessage([
      fauxText("更新受管文档"),
      fauxToolCall("write", { path: target, content: NEW }),
    ]),
  () => fauxAssistantMessage([fauxText("done")]),
]);
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

// register：await inner.prompt 让首条 message 把 write 工具回合跑完再返回（生产是 fire-and-forget）。
const register: RegisterInnerSession = (inner) => ({
  realSessionId: inner.sessionId,
  session: {
    send: async (command) =>
      command.type === "prompt" ? inner.prompt(command.message as string) : null,
  },
});

// 3. 真 startProfileSession（不传 guardDepsOverride → guard 默认文件后端 = dev 同一批 .pi）
const result = await startProfileSession({
  projectRoot: proj.root,
  profile,
  cwd: proj.root,
  firstMessage: "更新这份受管文档",
  registerInnerSession: register,
  sessionManager: SessionManager.create(proj.root, undefined), // 真持久化，供 UI 列出该会话
  createOptionsOverride: { model, authStorage, modelRegistry },
});
reg.unregister();

// 4. 注册 session→agent（左栏分组 + drive 选它离开欢迎态使 PendingChangeCard 挂载）
setOwner(proj.root, result.sessionId, profile.id);

console.log(
  "FIXTURE_JSON " +
    JSON.stringify({
      projectId: proj.id,
      artifactId: art.id,
      agentId: profile.id,
      agentName: profile.name,
      sessionId: result.sessionId,
      root: proj.root,
    }),
);
