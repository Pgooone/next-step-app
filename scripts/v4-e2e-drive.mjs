// 第四轮·删除受管文档 真浏览器验收驱动（测试资产，不属实现）。
// 复用 V3 fixture 造数据（scripts/v3-e2e-fixture.mts：~/pi-cwd-<date>/ 下 P1 含 artClean 无 pending +
// artPend 带 pending + 普通 .md），本 drive 验删除 UI。
// 跑法：FIXTURE='<v3 fixture json>' bash .claude/skills/browser-e2e/scripts/run-e2e.sh <本文件绝对路径>
import { chromium } from "playwright";
import path from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";
const WAIT = Number(process.env.PW_WAIT || 4500);
const log = (...a) => console.log("[e2e]", ...a);
const fx = JSON.parse(process.env.FIXTURE);
log("fixture", fx);

const launch = () =>
  chromium.launch({
    executablePath: process.env.PW_EXECUTABLE,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
const gotoSPA = async (page, url) => { await page.goto(url, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(WAIT); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).then(() => log("shot", name));
const T = async (label, fn) => {
  try { const v = await fn(); log("PASS", label, v === undefined ? "" : ":: " + JSON.stringify(v)); return { ok: true, info: v }; }
  catch (e) { log("FAIL", label, "::", String(e.message || e).split("\n")[0]); return { ok: false, err: String(e.message || e).split("\n")[0] }; }
};
const selectProject = async (page, id) => {
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WAIT);
};
const managedCount = (page) => page.evaluate(() => document.querySelectorAll('[data-testid^="managed-artifact-"]').length);
const hasManaged = (page, id) => page.evaluate((i) => !!document.querySelector(`[data-testid="managed-artifact-${i}"]`), id);
const openArtifactViaGroup = async (page, id) => {
  await page.waitForSelector(`[data-testid="managed-artifact-${id}"]`, { timeout: 12000 });
  await page.click(`[data-testid="managed-artifact-${id}"]`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "引用到对话框"), { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(1000);
};
// 右栏：是否 ArtifactPanel（有「引用到对话框」）、是否有「删除」按钮、正文片段。
const rightPanelState = (page) => page.evaluate(() => {
  const cont = document.querySelector(".right-panel-container") || document.body;
  const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
  return { isArtifactPanel: btns.includes("引用到对话框"), hasDeleteBtn: btns.includes("删除"), text: (cont.innerText || "").slice(0, 200) };
});
// 经浏览器内 fetch 探测 API 状态。
const apiStatus = (page, urlPath) => page.evaluate(async (u) => (await fetch(u)).status, urlPath);
const encPath = (abs) => abs.split("/").filter(Boolean).map(encodeURIComponent).join("/");
const treeFileCount = (page, suffix) => page.evaluate((suf) => [...document.querySelectorAll("span[title]")].filter((s) => (s.getAttribute("title") || "").endsWith(suf)).length, suffix);

const artCleanAbs = `${fx.root}/${fx.artCleanFile}`;
const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  await gotoSPA(page, URL);
  await selectProject(page, fx.p1);
  await page.waitForSelector('[data-testid^="managed-artifact-"]', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('span[title$="/项目说明.md"]', { timeout: 20000 }).catch(() => {});
  await shot(page, "v4-00-home.png");

  // ===== 删除入口可见：ArtifactPanel 头部「删除」按钮 + 受管分组行 hover 垃圾桶 =====
  R.affordances = await T("删除入口可见：ArtifactPanel 头部删除按钮 + 分组行 hover 垃圾桶", async () => {
    await openArtifactViaGroup(page, fx.artClean);
    const st = await rightPanelState(page);
    if (!st.isArtifactPanel) throw new Error("artClean 未进 ArtifactPanel");
    if (!st.hasDeleteBtn) throw new Error("ArtifactPanel 头部无「删除」按钮");
    await page.hover(`[data-testid="managed-artifact-${fx.artPend}"]`);
    await page.waitForTimeout(400);
    const trashVisible = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="managed-artifact-${id}"]`);
      return !!row && !!row.querySelector('button[aria-label="删除"]');
    }, fx.artPend);
    if (!trashVisible) throw new Error("分组行 hover 未出垃圾桶按钮");
    return "both-visible";
  });
  await shot(page, "v4-affordances.png");

  // ===== 两步二次确认 + 取消不删 =====
  R.confirm_cancel = await T("点删除 → 两步确认、不立即删；取消 → 文档仍在", async () => {
    // artClean 已打开。点 ArtifactPanel 头部「删除」
    await page.locator(".right-panel-container").getByRole("button", { name: "删除" }).first().click();
    await page.waitForTimeout(400);
    const confirmShown = await page.evaluate(() => document.body.innerText.includes("不可恢复"));
    if (!confirmShown) throw new Error("点删除未出二次确认文案");
    // 尚未删：API 仍 200
    if ((await apiStatus(page, `/api/artifacts/${fx.artClean}`)) !== 200) throw new Error("确认前 artClean 已被删（应仅出确认）");
    // 取消
    await page.locator(".right-panel-container").getByRole("button", { name: "取消" }).first().click();
    await page.waitForTimeout(400);
    if ((await apiStatus(page, `/api/artifacts/${fx.artClean}`)) !== 200) throw new Error("取消后 artClean 不应被删");
    return "cancel-keeps-doc";
  });

  // ===== 入口②删非当前打开项：他项消失、当前打开项右栏不误清 =====
  R.delete_nonopen = await T("入口②行垃圾桶删 artPend（artClean 仍打开）→ artPend 没了、artClean 右栏不误清", async () => {
    const before = await managedCount(page); // 应 2
    await page.hover(`[data-testid="managed-artifact-${fx.artPend}"]`);
    await page.waitForTimeout(300);
    await page.click(`[data-testid="managed-artifact-${fx.artPend}"] button[aria-label="删除"]`);
    await page.waitForTimeout(300);
    // 行内确认 → 点「确认」
    await page.locator(`[data-testid="managed-artifact-${fx.artPend}"]`).getByRole("button", { name: "确认" }).click();
    // 轮询 artPend 从分组消失：分组经 reloadArtifacts 重取后端 /api/projects/[id]/artifacts，消失 = 后端已删侧车
    let gone = false;
    for (let i = 0; i < 12; i++) { if (!(await hasManaged(page, fx.artPend))) { gone = true; break; } await page.waitForTimeout(500); }
    if (!gone) throw new Error("入口②删 artPend 后其仍在分组");
    const after = await managedCount(page);
    if (after !== before - 1) throw new Error(`分组数应 ${before}-1，实为 ${after}`);
    // artClean 仍打开、右栏未误清；artClean 仍在分组（删他项未误伤）
    const st = await rightPanelState(page);
    if (!st.isArtifactPanel) throw new Error("删他项后 artClean 右栏被误清（应仍是 ArtifactPanel）");
    if (!(await hasManaged(page, fx.artClean))) throw new Error("删 artPend 误伤 artClean（分组里没了）");
    return { before, after };
  });
  await shot(page, "v4-delete-nonopen.png");

  // ===== 入口①删当前打开项：侧车 + 磁盘 .md 双删、右栏退回、分组空、.md 不在树 =====
  R.delete_open = await T("入口①删当前打开的 artClean → 后端删除 + 磁盘 .md 删除(树证) + 右栏退回 + 分组空", async () => {
    // 删前 .md 在磁盘（type=read 200，无 console 噪声）
    if ((await apiStatus(page, `/api/files/${encPath(artCleanAbs)}?type=read`)) !== 200) throw new Error("删前 artClean .md 应可 read（200）");
    await page.locator(".right-panel-container").getByRole("button", { name: "删除" }).first().click();
    await page.waitForTimeout(400);
    await page.locator(".right-panel-container").getByRole("button", { name: "确认删除" }).click();
    // 右栏退回（close 清 selectedArtifactId → 不再是 ArtifactPanel），轮询
    let receded = false;
    for (let i = 0; i < 12; i++) { if (!(await rightPanelState(page)).isArtifactPanel) { receded = true; break; } await page.waitForTimeout(500); }
    if (!receded) throw new Error("删当前打开项后右栏仍是 ArtifactPanel（应退回 FileViewer/空）");
    // 分组空（两项都删了）——入口①经 explorerRefreshKey bump → SessionSidebar → FileExplorer 异步重取，轮询
    let cnt = -1;
    for (let i = 0; i < 14; i++) { cnt = await managedCount(page); if (cnt === 0) break; await page.waitForTimeout(500); }
    if (cnt !== 0) throw new Error(`两项都删后分组应空，实为 ${cnt}`);
    // 彻底删杀手锏证明：artClean 已不在 managedAbsPaths（分组重取后），去重不再隐藏其 .md；
    // 同一 bump 触发普通树 fetchEntries 重取——若 .md 仍在磁盘必重现普通树。树里仍无 → .md 已从磁盘删除（非降级）。
    await page.waitForTimeout(800);
    if ((await treeFileCount(page, "/" + fx.artCleanFile)) !== 0) throw new Error("删后 .md 重现/残留普通树（疑未删磁盘文件或降级）");
    return "deleted-fully";
  });
  await shot(page, "v4-delete-open.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  const fails = Object.entries(R).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  log("SUMMARY fails=" + JSON.stringify(fails) + " pageErrors=" + errs.length);
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
