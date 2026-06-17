// M8 真浏览器 E2E 造数据（独立验收员自写）。
// 建 1 个项目 + 1 个 agent（@ 转交待选）+ 1 个 cwd=root 种子会话（锁 selectedCwd）。
// 末行打印 FIXTURE_JSON，供 drive 的 FIXTURE 环境变量使用。
//
// 注意（沿用 M7 实测）：
//  - 种子会话不带 provider/modelId（用内核默认）；显式传 faux→500。
//  - 项目名加时间戳后缀避免重名 422。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const api = (m, p, body) =>
  fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });

const root = mkdtempSync(join(tmpdir(), "ns-m8-e2e-"));
const pr = await api("POST", "/api/projects", { name: `M8验收-${Date.now()}`, root });
if (!pr.ok) throw new Error(`建项目失败: ${pr.status} ${await pr.text()}`);
const proj = await pr.json();

// 转交目标 agent
const ar = await api("POST", `/api/projects/${proj.id}/agents`, { name: "转交目标乙", role: "" });
if (!ar.ok) throw new Error(`建 agent 失败: ${ar.status} ${await ar.text()}`);
const agent = await ar.json();

// 种子会话：cwd=root，用于锁 selectedCwd 到项目 root
const sr = await api("POST", "/api/agent/new", { cwd: root, type: "prompt", message: "种子会话-锁cwd" });
if (!sr.ok) throw new Error(`建种子会话失败: ${sr.status} ${await sr.text()}`);
const sess = await sr.json();
if (!sess.sessionId) throw new Error(`种子会话无 sessionId: ${JSON.stringify(sess)}`);

console.log("FIXTURE_JSON " + JSON.stringify({
  projectId: proj.id, root: proj.root, seed: sess.sessionId,
  agentId: agent.id, agentName: agent.name,
}));
