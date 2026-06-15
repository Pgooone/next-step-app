// 驱动脚本模板 —— 复制本文件，按你这张卡的流程改「操作 + 断言 + 截图」段。
// 自包含（helper 内联，避免 import 路径问题）。需要 env：PW_EXECUTABLE（由 setup-browser.sh 给）。
// 跑法：bash ../scripts/run-e2e.sh <本文件绝对路径>   （它会起 dev server 并在 /tmp/pw 下 node 本脚本）
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";       // 截图输出目录
const log = (...a) => console.log("[e2e]", ...a);

// ---- helper（一般不用改）----
const launch = () => chromium.launch({
  executablePath: process.env.PW_EXECUTABLE,           // 必须显式（缓存 build 与 npm 包默认不一致）
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const gotoSPA = async (page, url) => {                  // domcontentloaded（不要 networkidle）+ 等 SPA
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Number(process.env.PW_WAIT || 4000));
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).then(() => log("shot", name));
const T = async (label, fn) => { try { await fn(); log("OK", label); return true; } catch (e) { log("FAIL", label, "::", String(e).split("\n")[0]); return false; } };
const api = (m, p, body) => fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
// 选中项目：写持久化 key + reload（hydration 修复后此路可用；也可改驱动 ProjectSwitcher 文本点击）
const selectProject = async (page, id) => {
  await page.evaluate(i => localStorage.setItem("next-step:current-project-id", i), id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Number(process.env.PW_WAIT || 4000));
};
const listAgentDirs = (root) => { try { return fs.readdirSync(path.join(root, ".pi", "agents")).filter(n => { try { return fs.statSync(path.join(root, ".pi", "agents", n)).isDirectory(); } catch { return false; } }); } catch { return []; } };

// ---- 主流程 ----
const R = { steps: {}, disk: {} };
// 建临时项目（避免污染真实数据）
const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
const proj = await (await api("POST", "/api/projects", { name: "e2e-tmp", root })).json();
log("temp project", proj.id, root);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", e => errs.push("pageerror:" + e.message));
page.on("console", m => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 140)); });

try {
  await gotoSPA(page, URL);
  await selectProject(page, proj.id);
  await shot(page, "drive-01.png");

  // ====== 改这里：你这张卡的操作 + 断言 + 截图 ======
  // 例（B3 AgentManager，供参考；B4 等换成你的选择器/流程）：
  R.steps.openManager = await T("open agent-manager", async () => {
    await page.click('[data-testid="open-agents-btn"]');               // 选过项目后才 enable
    await page.waitForSelector('[data-testid="agent-manager"]', { timeout: 8000 });
  });
  R.steps.create = await T("create agent", async () => {
    await page.click('[data-testid="agent-new-btn"]');
    await page.fill('[data-testid="agent-form-name"]', "示例档案");
    await page.click('[data-testid="agent-save-btn"]');
    await page.waitForSelector('[data-testid="agent-item"]', { timeout: 8000 });
  });
  await shot(page, "drive-02.png");
  R.disk.agents = listAgentDirs(root);                                 // 落盘核验：UI 操作真写盘了吗
  log("DISK agents:", JSON.stringify(R.disk.agents));
  // ====== 改到这 ======

} finally {
  R.pageErrors = errs;                                                 // hydration/集成错误都在这（应为 []）
  log("PAGE ERRORS:", JSON.stringify(errs));
  log("RESULT:", JSON.stringify(R));
  await browser.close();
  // 清理临时项目
  await api("DELETE", "/api/projects/" + proj.id).catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
}
