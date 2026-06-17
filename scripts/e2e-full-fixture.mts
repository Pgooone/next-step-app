/**
 * 端到端全链路验收 fixture（一次性测试资产）。用 tsx 在项目根跑、dev 须起着。
 * api 建项目/agent/artifact/种子会话（dev 直接知道，避开 registry 缓存坑）；
 * pending change 无建立 api，用 domain PendingChangeStore.save 直接造（同 d4-fixture）。
 * 末行 FIXTURE_JSON 供 drive 读取。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry } from "../lib/domain/project-registry";
import { PendingChangeStore, buildReplacePendingChange } from "../lib/domain/pending-change-service";

const URL = process.env.E2E_URL || "http://localhost:30141";
const api = (m: string, p: string, body?: unknown) =>
  fetch(URL + p, {
    method: m,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

const root = mkdtempSync(join(tmpdir(), "ns-e2e-full-"));
const pr = await api("POST", "/api/projects", { name: `端到端验收-${Date.now()}`, root });
if (!pr.ok) throw new Error(`建项目失败 ${pr.status} ${await pr.text()}`);
const proj = await pr.json();

const ar = await api("POST", `/api/projects/${proj.id}/agents`, { name: "转交目标丙", role: "" });
if (!ar.ok) throw new Error(`建 agent 失败 ${ar.status} ${await ar.text()}`);
const agent = await ar.json();

// artifact：content = NEW（变更已呈现），pending 用 OLD→NEW，切出 1 del + 1 add（未变行隔开）。
const OLD = ["# 端到端产物", "", "## 概述", "概述首段，保持不变作为锚点。", "这一行将被删除，前后都有未变行隔开它。", "概述收尾行，保持不变。"].join("\n");
const NEW = ["# 端到端产物", "", "## 概述", "概述首段，保持不变作为锚点。", "概述收尾行，保持不变。", "新增的一段，用于验证 add 高亮。"].join("\n");
const artR = await api("POST", `/api/projects/${proj.id}/artifacts`, { kind: "design", title: "端到端-产物", content: NEW });
if (!artR.ok) throw new Error(`建 artifact 失败 ${artR.status} ${await artR.text()}`);
const art = await artR.json();

const store = new PendingChangeStore(new ProjectRegistry());
const pc = buildReplacePendingChange({ artifactId: art.id, sourceActor: "e2e-full-fixture", oldContent: OLD, newContent: NEW });
store.save(proj.id, pc);

const sr = await api("POST", "/api/agent/new", { cwd: root, type: "prompt", message: "种子会话-锁cwd" });
if (!sr.ok) throw new Error(`建种子会话失败 ${sr.status} ${await sr.text()}`);
const seed = (await sr.json()).sessionId;

console.log("FIXTURE_JSON " + JSON.stringify({
  projectId: proj.id, projectName: proj.name, root: proj.root, agentId: agent.id, agentName: agent.name,
  artifactId: art.id, seed, pendKinds: pc.diffBlocks.map((b) => b.kind),
}));
