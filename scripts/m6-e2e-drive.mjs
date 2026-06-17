// M6 · project-homepage 真浏览器验收驱动脚本（独立验收员自写，不信实现者自证）。
// 跑法：bash .claude/skills/browser-e2e/scripts/run-e2e.sh <本文件绝对路径>
// 自包含：建/删测试项目走 API，UI 操作走 ProjectHome 选择器。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";
const WAIT = Number(process.env.PW_WAIT || 4500);
const log = (...a) => console.log("[e2e]", ...a);

const launch = () =>
  chromium.launch({
    executablePath: process.env.PW_EXECUTABLE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
const gotoSPA = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WAIT);
};
const shot = (page, name) =>
  page.screenshot({ path: path.join(OUT, name), fullPage: false }).then(() => log("shot", path.join(OUT, name)));
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
const api = (m, p, body) =>
  fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });

const R = {};
const errs = [];

// 预备：建一个临时项目，用来验「首屏见项目墙里有它 + 点它进工作台」。
const preRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m6-pre-"));
const preProj = await (await api("POST", "/api/projects", { name: "M6-预置项目", root: preRoot })).json();
log("预置项目", preProj.id, preRoot);

// 新建项目用的 root（UI 新建表单要填路径，目录须已存在）
const newRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m6-new-"));
let createdProjId = null;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200));
});

try {
  // 确保全新状态：清 localStorage（避免上次遗留的 current-project-id 直接进工作台）
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await gotoSPA(page, URL);
  await shot(page, "m6-01-firstload.png");

  // ========================================================================
  // AC① 首屏见项目卡片墙（ProjectHome），不是直接工作台
  // ========================================================================
  R.ac1_home_first = await T("AC① 首屏渲染 ProjectHome 项目墙（非工作台）", async () => {
    // 项目墙标志：标题「Next-Step」+ 副标题「选择一个项目进入工作台」+ 预置项目卡片
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });
    const probe = await page.evaluate((preName) => {
      const body = document.body.innerText;
      const cards = [...document.querySelectorAll('[data-testid="project-card"]')];
      // 工作台特征控件（不该出现在项目墙）：open-artifacts-btn / 回到项目墙
      const hasWorkbench = !!document.querySelector('[data-testid="open-artifacts-btn"]');
      const hasBackBtn = body.includes("回到项目墙");
      return {
        hasSubtitle: body.includes("选择一个项目进入工作台"),
        cardCount: cards.length,
        hasPreCard: cards.some((c) => c.innerText.includes(preName)),
        hasWorkbench,
        hasBackBtn,
      };
    }, "M6-预置项目");
    if (!probe.hasSubtitle) throw new Error("未见项目墙副标题");
    if (!probe.hasPreCard) throw new Error("项目墙未列出预置项目卡片");
    if (probe.hasWorkbench) throw new Error("首屏出现工作台控件 open-artifacts-btn（应是项目墙）");
    if (probe.hasBackBtn) throw new Error("首屏出现「回到项目墙」（说明已在工作台，错误）");
    return probe;
  });

  // ========================================================================
  // AC② 能新建项目（UI 表单）
  // ========================================================================
  R.ac2_create = await T("AC② UI 新建项目 → 创建成功后自动进工作台", async () => {
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.waitForTimeout(600);
    await page.fill('input[placeholder="项目名称"]', "M6-新建测试");
    await page.fill('input[placeholder="/path/to/project"]', newRoot);
    await page.getByRole("button", { name: "创建" }).click();
    // 创建成功后 store.select 新项目 → 入口分流切工作台（出现 open-artifacts-btn）
    await page.waitForSelector('[data-testid="open-artifacts-btn"]', { timeout: 10000 });
    // 记录新建项目 id（供清理）
    const list = await (await api("GET", "/api/projects")).json();
    const found = list.find((p) => p.root === newRoot);
    createdProjId = found ? found.id : null;
    return { enteredWorkbench: true, createdProjId };
  });
  await shot(page, "m6-02-created-entered-workbench.png");

  // ========================================================================
  // AC④ 工作台有「← 回到项目墙」入口，点它切回项目墙
  // （顺序：先验回项目墙，再验从墙点项目进工作台 AC③，再验刷新 AC⑤）
  // ========================================================================
  R.ac4_back_btn = await T("AC④ 工作台「回到项目墙」入口存在且点击切回项目墙", async () => {
    const backBtn = page.locator('button[title="回到项目墙"]');
    await backBtn.waitFor({ state: "visible", timeout: 6000 });
    await backBtn.click();
    // 切回后应再见项目墙（卡片 + 无工作台控件）
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });
    const back = await page.evaluate(() => ({
      hasCards: !!document.querySelector('[data-testid="project-card"]'),
      hasWorkbench: !!document.querySelector('[data-testid="open-artifacts-btn"]'),
      hasSubtitle: document.body.innerText.includes("选择一个项目进入工作台"),
    }));
    if (!back.hasCards) throw new Error("点回项目墙后无卡片");
    if (back.hasWorkbench) throw new Error("点回项目墙后仍有工作台控件");
    if (!back.hasSubtitle) throw new Error("点回项目墙后无副标题");
    return back;
  });
  await shot(page, "m6-03-back-to-home.png");

  // ========================================================================
  // AC③ 点项目卡片进工作台
  // ========================================================================
  R.ac3_enter = await T("AC③ 点预置项目卡片 → 进工作台", async () => {
    // 点预置项目卡片（按名匹配，避免点到删除按钮）
    const card = page.locator('[data-testid="project-card"]', { hasText: "M6-预置项目" }).first();
    await card.waitFor({ state: "visible", timeout: 6000 });
    await card.click();
    await page.waitForSelector('[data-testid="open-artifacts-btn"]', { timeout: 10000 });
    const inWorkbench = await page.evaluate(() => ({
      hasWorkbench: !!document.querySelector('[data-testid="open-artifacts-btn"]'),
      hasBack: document.body.innerText.includes("回到项目墙"),
    }));
    if (!inWorkbench.hasWorkbench) throw new Error("点卡片后未进工作台");
    if (!inWorkbench.hasBack) throw new Error("工作台无「回到项目墙」入口");
    return inWorkbench;
  });
  await shot(page, "m6-04-entered-from-card.png");

  // ========================================================================
  // AC⑤【hydration 核心】工作台内刷新 → 仍停在工作台，不闪/不跳回项目墙
  // ========================================================================
  R.ac5_refresh_stays = await T("AC⑤ 工作台内刷新 → 仍停工作台（hydration 不跳回墙）", async () => {
    // 刷新前确认当前 localStorage 已存 current-project-id（选中态已持久化）
    const before = await page.evaluate(() => localStorage.getItem("next-step:current-project-id"));
    if (!before) throw new Error("刷新前 localStorage 无 current-project-id（选中态未持久化）");

    // 监控刷新过程中是否「闪」到项目墙：注入一个 MutationObserver 之前先记录，
    // 但更可靠的是：刷新后立刻轮询，确认从未稳定停在项目墙、最终停在工作台。
    await page.reload({ waitUntil: "domcontentloaded" });

    // 刷新后多帧采样：检查是否出现项目墙副标题（闪墙）。pickRootView 在 hydrated 前应渲染 null（既无墙也无工作台）。
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const s = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          home: body.includes("选择一个项目进入工作台"),
          workbench: !!document.querySelector('[data-testid="open-artifacts-btn"]'),
        };
      });
      samples.push(s);
      if (s.workbench) break; // 一旦进工作台即停（之后不会再闪墙）
      await page.waitForTimeout(150);
    }
    // 最终态必须是工作台
    await page.waitForSelector('[data-testid="open-artifacts-btn"]', { timeout: 8000 });
    const flashedHome = samples.some((s) => s.home && !s.workbench);
    const after = await page.evaluate(() => localStorage.getItem("next-step:current-project-id"));
    if (flashedHome) throw new Error("刷新过程中闪现了项目墙（hydration 时序陷阱未防住）：" + JSON.stringify(samples));
    if (!after) throw new Error("刷新后 current-project-id 丢失");
    return { before, after, samplesLen: samples.length, flashedHome, lastSample: samples[samples.length - 1] };
  });
  await shot(page, "m6-05-refresh-stays-workbench.png");

  // ========================================================================
  // AC② 删除 + 删除文案点明「仅移除注册、不删 .pi 磁盘数据」
  // 先回项目墙，对「新建测试」项目走删除二次确认，核验文案。
  // ========================================================================
  R.ac2_delete_copy = await T("AC② 删除二次确认文案点明「仅移除注册、不删 .pi 磁盘数据」", async () => {
    // 回项目墙
    await page.locator('button[title="回到项目墙"]').click();
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 8000 });
    // 找「新建测试」卡片，hover 出删除按钮并点击
    const card = page.locator('[data-testid="project-card"]', { hasText: "M6-新建测试" }).first();
    await card.waitFor({ state: "visible", timeout: 6000 });
    await card.hover();
    await card.locator('[data-testid="remove-project-btn"]').click();
    await page.waitForTimeout(500);
    // 二次确认文案核验
    const confirmText = await card.evaluate((el) => el.innerText.replace(/\s+/g, " "));
    const mentionsRegistryOnly = confirmText.includes("仅") && confirmText.includes("移除注册");
    const mentionsNoDiskDelete = confirmText.includes("不会删除磁盘") && confirmText.includes(".pi");
    if (!mentionsRegistryOnly) throw new Error("删除文案未点明「仅移除注册」：" + confirmText);
    if (!mentionsNoDiskDelete) throw new Error("删除文案未点明「不删 .pi 磁盘数据」：" + confirmText);
    return { confirmText: confirmText.slice(0, 160) };
  });
  await shot(page, "m6-06-delete-confirm-copy.png");

  R.ac2_delete_effect = await T("AC② 点「移除」→ 卡片消失（注册被移除）", async () => {
    const before = await page.locator('[data-testid="project-card"]').count();
    const card = page.locator('[data-testid="project-card"]', { hasText: "M6-新建测试" }).first();
    await card.getByRole("button", { name: "移除" }).click();
    await page.waitForTimeout(1500);
    const stillThere = await page.locator('[data-testid="project-card"]', { hasText: "M6-新建测试" }).count();
    const after = await page.locator('[data-testid="project-card"]').count();
    if (stillThere !== 0) throw new Error("点移除后「新建测试」卡片仍在");
    // 磁盘目录应仍存在（仅移除注册）
    const diskKept = fs.existsSync(newRoot);
    if (!diskKept) throw new Error("移除后磁盘目录被删（应仅移除注册）");
    createdProjId = null; // 已被 UI 移除
    return { before, after, diskKept };
  });
  await shot(page, "m6-07-after-delete.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
  // 清理：预置项目 + 可能残留的新建项目；临时目录
  await api("DELETE", "/api/projects/" + preProj.id).catch(() => {});
  if (createdProjId) await api("DELETE", "/api/projects/" + createdProjId).catch(() => {});
  fs.rmSync(preRoot, { recursive: true, force: true });
  fs.rmSync(newRoot, { recursive: true, force: true });
}
