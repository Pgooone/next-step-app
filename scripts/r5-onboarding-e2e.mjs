/**
 * 第五轮 / D-B4-4 真浏览器完整 onboarding 闭环（T3 AC④）。
 * §三.8 文档型 agent 工作流，跨一次「重启 dev」（re-attach）仍闭环：
 *   UI 建 doc agent → 卡片菜单起会话发 create（真模型 create_artifact）→ 受管文档落盘
 *   → 重启 dev（清空 __piSessions）→ ?session= 恢复（re-attach）→ UI 发 propose（真模型 propose_edit）
 *   → PendingChangeCard 按块确认「全部 ✓」→ 物化（版本+1 / pending 清空 / 正文含 goodbye world）。
 *
 * OOM 管控（本机 3.4G 无 swap）：单 browser/page、headless-shell、waitIdle 轮询不死等；
 * create 经 UI 起会话但走服务端异步流式（浏览器只发起+轮询落盘，不占长窗口），仅 propose 一轮浏览器流式。
 * 跑法：eval "$(bash .claude/skills/browser-e2e/scripts/setup-browser.sh)" && node scripts/r5-onboarding-e2e.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import path from "node:path";

const URL = "http://localhost:30141";
const OUT = "/tmp/pw";
const ROOT = "/tmp/ns-r5-onb";
const PW_EXE = process.env.PW_EXECUTABLE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), "[onb]", ...a);

let devProc = null;
function startDev(f) {
  const fd = openSync(f, "a");
  devProc = spawn("npm", ["run", "dev"], { cwd: "/home/pgone/projects/GitHubproject/Next-Step/next-step-V1.1", stdio: ["ignore", fd, fd], detached: true });
}
async function killDev() {
  try {
    if (devProc?.pid) process.kill(-devProc.pid, "SIGTERM");
  } catch {
    /* dead */
  }
  await new Promise((res) =>
    spawn("bash", ["-c", "fuser -k 30141/tcp 2>/dev/null; true"], { stdio: "ignore" }).on("close", res),
  );
  await sleep(2500);
}
const tailLog = (f, n = 50) => {
  try {
    return readFileSync(f, "utf8").split("\n").slice(-n).join("\n");
  } catch {
    return "(no log)";
  }
};
async function waitPort(t) {
  const s = Date.now();
  while (Date.now() - s < t) {
    try {
      const r = await fetch(URL + "/api/projects");
      if (r.status < 500) return;
    } catch {
      /* not up */
    }
    await sleep(2000);
  }
  throw new Error("dev 未就绪");
}
async function api(m, p, body) {
  const r = await fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const t = await r.text();
  let d;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, data: d };
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

const shot = (page, n) => page.screenshot({ path: path.join(OUT, n) }).then(() => log("shot", n)).catch(() => {});
const T = async (label, fn) => {
  try {
    const v = await fn();
    log("PASS", label, v === undefined ? "" : ":: " + JSON.stringify(v));
    return { ok: true, info: v };
  } catch (e) {
    log("FAIL", label, "::", String(e.message || e).split("\n")[0]);
    return { ok: false, err: String(e.message || e).split("\n")[0] };
  }
};
async function waitIdle(page, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const has = (x) => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === x);
      return { send: has("Send"), streaming: has("Steer") || has("Follow-up") || has("Stop") };
    });
    if (st.send && !st.streaming) return true;
    await sleep(1000);
  }
  return false;
}

const R = {};
const errs = [];

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  await killDev();
  log("起 dev (A)...");
  startDev("/tmp/ns-r5-onb-dev-a.log");
  await waitPort(160000);
  log("dev 就绪");

  const proj = await api("POST", "/api/projects", { name: "R5Onboarding", root: ROOT });
  const projectId = proj.data.id;
  log("建项目", proj.status, projectId);

  const browser = await chromium.launch({
    executablePath: PW_EXE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200));
  });

  let sessionId = null;
  let artifactId = null;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), projectId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(5000);
    await shot(page, "onb-00-home.png");

    R.create = await T("UI 建 doc agent + 卡片菜单起会话发 create → 受管文档落盘", async () => {
      await page.click('[data-testid="open-agents-btn"]');
      await page.waitForSelector('[data-testid="agent-manager"]', { timeout: 8000 });
      await page.click('[data-testid="agent-new-btn"]');
      await page.waitForSelector('[data-testid="agent-form-name"]', { timeout: 6000 });
      await page.fill('[data-testid="agent-form-name"]', "需求分析师");
      await page.fill(
        '[data-testid="agent-form-role"]',
        "你是资深需求分析师。用户要创建文档时调用 create_artifact 工具，要修改已有文档时调用 propose_edit 工具，务必实际调用工具、不要只回复文字。",
      );
      await page.click('[data-testid="agent-save-btn"]');
      await sleep(2500);
      await shot(page, "onb-01a-agent-saved.png");
      await page.click('[data-testid="agent-item"]');
      await page.waitForSelector('[data-testid="agent-start-input"]', { timeout: 8000 });
      await page.fill('[data-testid="agent-start-input"]', "帮我新建一个『测试需求』文档，正文只写一行：hello world");
      await page.click('[data-testid="agent-start-submit"]');
      // create 走服务端异步流式：轮询受管文档落盘（不在浏览器等长窗口，省 OOM）
      let aids = [];
      for (let i = 0; i < 55; i++) {
        aids = artifactIds();
        if (aids.length) break;
        await sleep(3000);
      }
      if (!aids.length) throw new Error("create 后无受管文档落盘（真模型可能没调 create_artifact）");
      const map = await api("GET", `/api/projects/${projectId}/session-map`);
      sessionId = Object.keys(map.data?.bySession || {})[0];
      artifactId = aids[0];
      return { artifactId, sessionId };
    });
    await shot(page, "onb-01b-created.png");
    if (!artifactId || !sessionId) throw new Error("create 阶段失败，终止");

    log("=== 重启 dev（清空 __piSessions，触发 re-attach）===");
    await killDev();
    startDev("/tmp/ns-r5-onb-dev-b.log");
    await waitPort(160000);
    log("dev 重启就绪");

    R.reattach_load = await T("重启后 ?session= 恢复会话（re-attach 路径）", async () => {
      await page.goto(`${URL}/?session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded" });
      await sleep(6000);
      const ready = await waitIdle(page, 40000);
      return { ready };
    });
    await shot(page, "onb-02-reattached.png");

    R.propose = await T("re-attach 后 UI 发 propose → PendingChange 落盘（核心：工具集未丢）", async () => {
      await page.locator("textarea").first().fill("请用 propose_edit 把那个文档里的 hello world 改成 goodbye world");
      await sleep(400);
      await page.locator('button:has-text("Send")').first().click();
      await waitIdle(page, 90000);
      let pend = [];
      for (let i = 0; i < 50; i++) {
        pend = pendingFiles(artifactId);
        if (pend.length) break;
        await sleep(3000);
      }
      if (!pend.length) throw new Error("re-attach 后 propose 未落 PendingChange（重建丢 doc 工具？）");
      return { pending: pend };
    });
    await shot(page, "onb-03-proposed.png");

    R.confirm = await T("打开受管文档 → PendingChangeCard 全部 ✓ → 物化(版本+1/pending清空/正文 goodbye)", async () => {
      await page.waitForSelector(`[data-testid="managed-artifact-${artifactId}"]`, { timeout: 14000 });
      await page.click(`[data-testid="managed-artifact-${artifactId}"]`);
      await sleep(2000);
      await page.waitForSelector('[data-testid="pending-change-card"]', { timeout: 12000 });
      const beforeVer = await page.evaluate(async (id) => {
        const r = await fetch(`/api/artifacts/${id}`);
        const d = await r.json();
        return d.currentVersion;
      }, artifactId);
      await page.locator('[data-testid="pending-change-card"]').getByRole("button", { name: "全部 ✓" }).click();
      await sleep(3500);
      const after = await page.evaluate(async (id) => {
        const r = await fetch(`/api/artifacts/${id}`);
        const d = await r.json();
        const rp = await fetch(`/api/artifacts/${id}/pending`);
        const pd = await rp.json();
        return { cv: d.currentVersion, content: d.content || "", pend: Array.isArray(pd) ? pd.length : -1 };
      }, artifactId);
      if (after.cv !== beforeVer + 1) throw new Error(`版本未+1: ${beforeVer}→${after.cv}`);
      if (after.pend !== 0) throw new Error("pending 未清空: " + after.pend);
      if (!after.content.includes("goodbye world")) throw new Error("物化正文未含 goodbye world");
      return { beforeVer, afterVer: after.cv };
    });
    await shot(page, "onb-04-confirmed.png");
  } catch (e) {
    log("FATAL", String(e.message || e).split("\n")[0]);
  } finally {
    R.pageErrors = errs;
    R.nonFilesErrors = errs.filter((e) => !/\/api\/files\//.test(e) && !e.includes("403"));
    log("RESULT_JSON " + JSON.stringify(R));
    await browser.close().catch(() => {});
  }

  await api("DELETE", `/api/projects/${projectId}`, undefined).catch(() => {});
  const fails = Object.entries(R).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  if (fails.length) log("FAILS:", fails.join(","), "\ndev日志(B):\n" + tailLog("/tmp/ns-r5-onb-dev-b.log", 50));
  return fails.length ? 1 : 0;
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
