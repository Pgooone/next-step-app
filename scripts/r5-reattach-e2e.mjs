/**
 * 第五轮 / D-B4-4 真机重启复现回归（T3 AC①②③）。
 *
 * 验「修后 ✅」：turn1 真模型(DeepSeek) create_artifact → **重启 dev**（清空 globalThis.__piSessions，
 * 触发 re-attach 的 not-alive 路径）→ turn2 propose_edit → 验落 PendingChange。
 * 修前（裸 startRpcSession 接线）此处 turn2 因 generic 重开丢 doc 工具、无 PendingChange（已知❌，
 * 见记忆 next-step-reattach-drops-doc-tools 双相复现）；修后（resolveOrReattachSession 接线）应 ✅。
 *
 * 触发方式只能用「重启 dev」：DELETE /api/sessions/[id] 会 unlinkSync 删会话文件（turn2 会 404），
 * idle 10min 太慢；唯重启 dev 清内存 registry 而不删 jsonl。
 *
 * 单 dev 进程（重启时先 kill 再起，省内存）；dev 日志落 /tmp/ns-r5-dev-{a,b}.log 供诊断。
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:30141";
const ROOT = "/tmp/ns-r5-test";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), ...a);

let devProc = null;
function startDev(logFile) {
  const fd = openSync(logFile, "a");
  devProc = spawn("npm", ["run", "dev"], { stdio: ["ignore", fd, fd], detached: true });
}
async function killDev() {
  try {
    if (devProc?.pid) process.kill(-devProc.pid, "SIGTERM");
  } catch {
    /* already dead */
  }
  await new Promise((res) =>
    spawn("bash", ["-c", "fuser -k 30141/tcp 2>/dev/null; true"], { stdio: "ignore" }).on("close", res),
  );
  await sleep(2500);
}
function tailLog(f, n = 50) {
  try {
    return readFileSync(f, "utf8").split("\n").slice(-n).join("\n");
  } catch {
    return "(no log)";
  }
}

async function jfetch(method, url, body, timeoutMs = 130000) {
  const o = { method, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs) };
  if (body) o.body = JSON.stringify(body);
  const r = await fetch(BASE + url, o);
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, data: d };
}
async function waitPort(timeoutMs) {
  const s = Date.now();
  while (Date.now() - s < timeoutMs) {
    try {
      const r = await fetch(BASE + "/api/projects");
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  throw new Error("dev 未就绪");
}
const managed = () => join(ROOT, ".pi", "artifacts", "managed");
const artifactIds = () => {
  const d = managed();
  return existsSync(d) ? readdirSync(d).filter((id) => existsSync(join(d, id, "artifact.json"))) : [];
};
const pendingFiles = (aid) => {
  const d = join(managed(), aid, "pending");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")) : [];
};
async function pollFor(fn, timeoutMs) {
  const s = Date.now();
  while (Date.now() - s < timeoutMs) {
    const v = fn();
    if (v && v.length) return v;
    await sleep(3000);
  }
  return null;
}

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  await killDev();

  log("起 dev (phase A)...");
  startDev("/tmp/ns-r5-dev-a.log");
  await waitPort(150000);
  log("dev 就绪");

  const proj = await jfetch("POST", "/api/projects", { name: "R5ReattachTest", root: ROOT });
  log("建项目:", proj.status, proj.data?.id);
  const projectId = proj.data.id;

  const agent = await jfetch("POST", `/api/projects/${projectId}/agents`, {
    name: "文档助手",
    role: "你是文档助手。用户要创建文档时调用 create_artifact 工具；要修改已有文档时调用 propose_edit 工具。务必实际调用工具，不要只回复文字。",
  });
  log("建 agent:", agent.status, agent.data?.id);
  const agentId = agent.data.id;

  const sess = await jfetch("POST", `/api/projects/${projectId}/agents/${agentId}/session`, {
    message: "请用 create_artifact 创建一个标题为「测试文档」的 markdown 文档，正文只写一行：hello world",
  });
  log("起会话 turn1:", sess.status, JSON.stringify(sess.data).slice(0, 180));
  const sessionId = sess.data.sessionId;
  if (!sessionId) {
    log("起会话失败 dev 日志:\n" + tailLog("/tmp/ns-r5-dev-a.log"));
    throw new Error("起会话失败");
  }

  log("轮询 turn1 create_artifact 落盘...");
  const aids = await pollFor(() => artifactIds(), 170000);
  if (!aids) {
    log("❌ turn1 未落 artifact（真模型可能没调 create_artifact）");
    log("dev 日志:\n" + tailLog("/tmp/ns-r5-dev-a.log", 70));
    throw new Error("turn1 fail");
  }
  const artifactId = aids[0];
  log("✅ turn1 artifact 落盘:", artifactId);

  log("=== 重启 dev（清空 __piSessions，触发 re-attach）===");
  await killDev();
  startDev("/tmp/ns-r5-dev-b.log");
  await waitPort(150000);
  log("dev 重启就绪");

  log("turn2 propose（经 resolveOrReattachSession 重建）...");
  const t2 = await jfetch("POST", `/api/agent/${encodeURIComponent(sessionId)}`, {
    type: "prompt",
    message: "请用 propose_edit 把刚才那个文档里的 hello world 改成 goodbye world",
  });
  log("turn2 POST:", t2.status, (typeof t2.data === "string" ? t2.data : JSON.stringify(t2.data)).slice(0, 220));

  log("轮询 turn2 propose_edit 落 PendingChange...");
  const pend = await pollFor(() => pendingFiles(artifactId), 170000);
  let pass = false;
  if (pend) {
    log("✅✅ 修后通过：re-attach 后 propose_edit 落 PendingChange:", pend);
    pass = true;
  } else {
    log("❌ 修后失败：turn2 后无 PendingChange（re-attach 可能丢 doc 工具）");
    log("dev 日志(B):\n" + tailLog("/tmp/ns-r5-dev-b.log", 90));
  }

  await jfetch("DELETE", `/api/projects/${projectId}`, undefined, 20000).catch(() => {});
  return pass ? 0 : 1;
}

main()
  .then(async (code) => {
    log("收尾杀 dev + 删测试根");
    await killDev();
    rmSync(ROOT, { recursive: true, force: true });
    process.exit(code);
  })
  .catch(async (e) => {
    log("ERROR:", e.message);
    await killDev();
    rmSync(ROOT, { recursive: true, force: true });
    process.exit(1);
  });
