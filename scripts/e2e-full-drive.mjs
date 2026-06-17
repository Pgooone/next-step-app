// 端到端全链路真浏览器验收（lead 亲跑，降 OOM：不 spawn agent，少一个 node 进程）。
// 链路：① M6 项目墙→进项目 ② 主对话发消息标 main ③ M8 @agent 转交→目标会话归属 ④ D4 产物按块确认。
// 单 browser / 单 page。env 用 browser-e2e（headless-shell，PW_EXECUTABLE）。
import { chromium } from "playwright";
import path from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";
const WAIT = Number(process.env.PW_WAIT || 5000);
const log = (...a) => console.log("[e2e]", ...a);
const fx = JSON.parse(process.env.FIXTURE);
log("fixture", fx);

const launch = () => chromium.launch({ executablePath: process.env.PW_EXECUTABLE, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false }).then(() => log("shot", name));
const T = async (label, fn) => { try { const v = await fn(); log("PASS", label, v === undefined ? "" : ":: " + JSON.stringify(v)); return { ok: true, info: v }; } catch (e) { log("FAIL", label, "::", String(e.message || e).split("\n")[0]); return { ok: false, err: String(e.message || e).split("\n")[0] }; } };
const api = (m, p, body) => fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
const getMap = async (pid) => { const r = await api("GET", `/api/projects/${pid}/session-map`); return r.ok ? r.json() : null; };
const pollMap = async (pid, pred, tries = 20, gap = 1000) => { let m = null; for (let i = 0; i < tries; i++) { m = await getMap(pid); if (m && pred(m)) return m; await new Promise((r) => setTimeout(r, gap)); } return m; };
const waitIdle = async (page, ms = 22000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const st = await page.evaluate(() => { const has = (x) => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === x); return { send: has("Send"), streaming: has("Steer") || has("Follow-up") || has("Stop") }; }); if (st.send && !st.streaming) return true; await page.waitForTimeout(500); } return false; };
const restore = async (page, pid, sid) => { await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), pid); await page.goto(`${URL}/?session=${encodeURIComponent(sid)}`, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(WAIT); };
const newSession = async (page) => { await page.locator('button[title*="New session"], button:has-text("New")').first().click(); await page.waitForTimeout(1500); };
const sendMessage = async (page, text) => { await page.locator("textarea").first().fill(text); await page.waitForTimeout(400); await page.locator('button:has-text("Send")').first().click(); await waitIdle(page); };

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  // ① M6 项目墙：清 currentProjectId 回墙，验该项目在列
  R.s1_wall = await T("① M6 项目墙渲染 + 该项目在列", async () => {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => localStorage.removeItem("next-step:current-project-id"));
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(WAIT);
    const onWall = await page.evaluate((n) => document.body.innerText.includes(n), fx.projectName);
    if (!onWall) throw new Error("项目墙未见该项目: " + fx.projectName);
    return { projectOnWall: true };
  });
  await shot(page, "e2e-01-wall.png");

  // ② 进项目（restore 锁 cwd）→ 新会话发消息 → 标 main
  R.s2_main = await T("② 进项目→主对话发消息→标 main", async () => {
    await restore(page, fx.projectId, fx.seed);
    await newSession(page);
    await sendMessage(page, "端到端主对话首条消息");
    const map = await pollMap(fx.projectId, (m) => !!m.mainSessionId);
    if (!map?.mainSessionId) throw new Error("发消息后 mainSessionId 仍空");
    if (map.mainSessionId === fx.seed) throw new Error("种子被误标 main");
    return { mainSessionId: map.mainSessionId };
  });
  await shot(page, "e2e-02-main.png");

  // ③ M8 @agent 转交 → 目标会话归属（bySession 旁证）
  R.s3_transfer = await T("③ 主对话 @ → 选 agent → 转交 → 目标会话归属该 agent", async () => {
    await page.locator("textarea").first().fill("@");
    await page.waitForTimeout(800);
    await page.waitForSelector('[data-testid="agent-transfer-popover"]', { timeout: 8000 });
    await page.click(`[data-testid="transfer-agent-option"][data-agent-name="${fx.agentName}"]`);
    await page.waitForTimeout(500);
    await page.click('[data-testid="transfer-confirm"]');
    await waitIdle(page);
    const map = await pollMap(fx.projectId, (m) => Object.values(m.bySession || {}).includes(fx.agentId));
    const owned = Object.entries(map?.bySession || {}).filter(([, a]) => a === fx.agentId);
    if (owned.length === 0) throw new Error("无 agent 归属（转交未投递/未 setOwner）");
    return { targetSid: owned[0][0] };
  });
  await shot(page, "e2e-03-transfer.png");

  // ④ D4 产物按块确认：打开 artifact → PendingChangeCard → 确认首块
  R.s4_artifact = await T("④ 打开 artifact → PendingChangeCard → 确认首块生效", async () => {
    await page.click('[data-testid="open-artifacts-btn"]');
    await page.waitForSelector(`[data-testid="artifact-item-${fx.artifactId}"]`, { timeout: 8000 });
    await page.click(`[data-testid="artifact-item-${fx.artifactId}"]`);
    await page.waitForSelector('[data-testid="pending-change-card"]', { timeout: 12000 });
    const before = await page.evaluate(() => document.querySelector('[data-testid="pending-change-card"]')?.innerText || "");
    await page.locator('[data-testid="pending-change-card"] button[aria-label="确认此块"]').first().click();
    // 首次命中 resolve 路由会冷编译(可能 5~12s)，轮询等卡片出现「已确认」或文本变化，非定长 wait。
    let after = before, changed = false;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(1000);
      after = await page.evaluate(() => document.querySelector('[data-testid="pending-change-card"]')?.innerText || "");
      if (after.includes("已确认") || after !== before) { changed = true; break; }
    }
    if (!changed) throw new Error("点确认块后卡片无变化（轮询 16s）");
    return { cardShown: true, confirmed: true };
  });
  await shot(page, "e2e-04-artifact-confirm.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  R.nonFilesErrors = errs.filter((e) => !/\/api\/files\//.test(e) && !e.includes("403") && !/loadTools|Failed to fetch/.test(e));
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
