// M7 真浏览器 E2E 造数据（独立验收员自写）。
// 建 2 个项目，每项目建 1 个 cwd=root 的种子会话（用于 drive.mjs 的 restoreSession 锁 selectedCwd）。
// 末行打印 FIXTURE_JSON，供 drive.mjs 的 FIXTURE 环境变量使用。
//
// 注意（已实测，非 bug）：
//  - 种子会话不带 provider/modelId（用内核默认）；显式传 faux→500。
//  - 无凭证环境模型不回属正常，会话仍会落盘，种子会话进「其它会话」区即可。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const api = (m, p, body) =>
  fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });

async function makeOne(label) {
  const root = mkdtempSync(join(tmpdir(), "ns-m7-e2e-"));
  // 名字带时间戳后缀，避免重复运行时与上轮残留项目重名（registry 强制名唯一）
  const pr = await api("POST", "/api/projects", { name: `M7-${label}-${Date.now()}`, root });
  if (!pr.ok) throw new Error(`建项目失败 ${label}: ${pr.status} ${await pr.text()}`);
  const proj = await pr.json();
  // 种子会话：cwd=root，用于锁 selectedCwd 到项目 root
  const sr = await api("POST", "/api/agent/new", {
    cwd: root,
    type: "prompt",
    message: "种子会话-锁cwd",
  });
  if (!sr.ok) throw new Error(`建种子会话失败 ${label}: ${sr.status} ${await sr.text()}`);
  const sess = await sr.json();
  if (!sess.sessionId) throw new Error(`种子会话无 sessionId ${label}: ${JSON.stringify(sess)}`);
  return { id: proj.id, root: proj.root, seed: sess.sessionId };
}

const p1 = await makeOne("甲");
const p2 = await makeOne("乙");
console.log("FIXTURE_JSON " + JSON.stringify({ p1, p2 }));
