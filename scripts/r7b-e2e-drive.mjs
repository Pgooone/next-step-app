// 第七轮·第二轮「内联 diff 纠偏」真浏览器验收驱动（测试资产，不属实现）。
// 前置：tsx 跑 scripts/r7b-e2e-fixture.mts 造数据（content=A_OLD 真实形态），FIXTURE_JSON 写进 env FIXTURE。
// 跑法：bash scripts/run-e2e.sh <本文件>（run-e2e 自动 source env + 起 dev + 跑）。
import { chromium } from "playwright";
import path from "node:path";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";
const WAIT = Number(process.env.PW_WAIT || 4500);
const log = (...a) => console.log("[e2e]", ...a);
const fx = JSON.parse(process.env.FIXTURE);
log("fixture", JSON.stringify(fx));

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
  page.screenshot({ path: path.join(OUT, name), fullPage: false }).then(() => log("shot", name));
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
const selectProject = async (page, id) => {
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WAIT);
};
const openArtifactViaGroup = async (page, id) => {
  await page.waitForSelector(`[data-testid="managed-artifact-${id}"]`, { timeout: 15000 });
  await page.click(`[data-testid="managed-artifact-${id}"]`);
  await page
    .waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "引用到对话框"),
      { timeout: 12000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
};

// 探测内联混合渲染：每个改动块卡片带 data-block-id，按 borderLeft 色归类 kind，取文本。
const probeInline = (page) =>
  page.evaluate(() => {
    const COLOR = { "rgb(74, 222, 128)": "add", "rgb(248, 113, 113)": "del", "rgb(234, 179, 8)": "mod" };
    const cards = [...document.querySelectorAll("[data-block-id]")];
    const out = { count: cards.length, byKind: {}, mono: 0, plusMinus: 0, delStrike: false, allText: "" };
    for (const c of cards) {
      const cs = getComputedStyle(c);
      const kind = COLOR[cs.borderLeftColor] || "?";
      out.byKind[kind] = (out.byKind[kind] || 0) + 1;
      if (cs.fontFamily.toLowerCase().includes("mono")) out.mono++;
      const t = c.innerText || "";
      if (/[+\-]/.test(t)) out.plusMinus++;
      out.allText += " " + t.replace(/\s+/g, " ");
      for (const p of c.querySelectorAll("p")) {
        if (getComputedStyle(p).textDecorationLine.includes("line-through")) out.delStrike = true;
      }
    }
    return out;
  });

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  await gotoSPA(page, URL);
  await selectProject(page, fx.projectId);
  await page.waitForSelector('[data-testid^="managed-artifact-"]', { timeout: 15000 }).catch(() => {});
  await shot(page, "r7b-00-home.png");

  // ===== 打开受管文档（content=旧内容、含 1 条 old→new pending）=====
  await openArtifactViaGroup(page, fx.artifactId);
  await shot(page, "r7b-01-opened.png");

  // ===== 核心①：equal 段保留真实 markdown 标题（= 处于混合内联视图、非并排 diff 视图）=====
  R.equalMarkdown = await T("核心① equal 段保留 markdown 标题（混合内联渲染）", async () => {
    const found = {};
    for (const h of fx.expectHeadings) found[h] = await page.locator(`[data-slug="${h}"]`).count();
    const miss = fx.expectHeadings.filter((h) => found[h] < 1);
    if (miss.length) throw new Error("缺真实标题(疑未走混合内联): " + miss.join(",") + " :: " + JSON.stringify(found));
    return found;
  });

  // ===== 核心②：3 个改动块在原文行内呈现，带颜色边框 git 卡片 + 新文本可见 + del 删除线 =====
  R.inlineDiff = await T("核心② add/del/mod 三块原文行内呈现（颜色边框 git 卡片）", async () => {
    const p = await probeInline(page);
    if (p.count !== 3) throw new Error("data-block-id 卡片数 ≠ 3：" + JSON.stringify(p.byKind));
    for (const k of ["add", "del", "mod"]) if (!p.byKind[k]) throw new Error("缺 " + k + " 块：" + JSON.stringify(p.byKind));
    if (p.mono < 3) throw new Error("改动卡片非 mono 等宽（git 风格）：mono=" + p.mono);
    if (p.plusMinus < 3) throw new Error("改动卡片缺 +/- 前缀：" + p.plusMinus);
    if (!p.delStrike) throw new Error("del 块无删除线");
    return { count: p.count, byKind: p.byKind, mono: p.mono };
  });

  // ===== 核心③：改动的新文本真的呈现在原文里（这正是第七轮没做到的）=====
  R.newTextInline = await T("核心③ 改动新文本在原文行内可见（mod 新行 + add 新段）", async () => {
    const body = await page.evaluate(() => document.body.innerText);
    const miss = fx.expectNewText.filter((t) => !body.includes(t));
    if (miss.length) throw new Error("新文本未在原文呈现: " + miss.join(" | "));
    if (!body.includes(fx.expectDelText)) throw new Error("del 旧行文本未呈现: " + fx.expectDelText);
    return "new+del text present inline";
  });

  // ===== 核心④：无「无法在正文定位」兜底黄条（第七轮真实流程下只会显这条）=====
  R.noUnalignedBanner = await T("核心④ 无「无法在正文定位」兜底（已消除 unaligned）", async () => {
    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes("无法在正文定位")) throw new Error("仍出现 unaligned 兜底黄条（内联未生效）");
    if (body.includes("已自动切换为并排")) throw new Error("意外触发降级（3 块不应降级）");
    return "no-unaligned-banner";
  });
  await shot(page, "r7b-02-inline-mixed.png");

  // ===== A3：恢复会话 → 中栏 PendingChangeCard → 点 add 行 → 原文对应块脉冲高亮（跳转落点真实存在）=====
  R.a3_jump = await T("A3 点聊天框 diff 条 → 原文对应块脉冲高亮 + 进视口（跳转落点真实存在）", async () => {
    const addBlock = fx.blocks.find((b) => b.kind === "add");
    if (!addBlock) throw new Error("fixture 无 add 块");
    // 恢复会话（项目仍由 localStorage 保持）让 ChatWindow 离开欢迎态、中栏卡挂载。
    await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), fx.projectId);
    await page.goto(`${URL}/?session=${encodeURIComponent(fx.sessionId)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(WAIT);
    await openArtifactViaGroup(page, fx.artifactId);
    const cardOk = await page.waitForSelector('[data-testid="pending-change-card"]', { timeout: 10000 })
      .then(() => true).catch(() => false);
    if (!cardOk) throw new Error("中栏未出现 pending-change-card（疑未离开欢迎态）");
    // 把右栏正文滚到顶，使底部的 add 块需要滚动才可见。
    await page.evaluate(() => {
      const scroller = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(d).overflowY));
      if (scroller) scroller.scrollTop = 0;
    });
    await page.waitForTimeout(400);
    // 点聊天框卡片里 add 块那一行（预览=新行文本）。
    const row = page.locator('[data-testid="pending-change-card"]').locator(`text=${addBlock.firstLine}`).first();
    await row.waitFor({ state: "visible", timeout: 6000 });
    await row.click();
    await page.waitForTimeout(450); // 脉冲存活 ~900ms，此时取
    const probe = await page.evaluate((id) => {
      const el = document.querySelector(`[data-block-id="${id}"]`);
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      return {
        exists: true,
        boxShadow: el.style.boxShadow || getComputedStyle(el).boxShadow,
        inViewport: r.top >= 0 && r.top < window.innerHeight,
        top: Math.round(r.top),
      };
    }, addBlock.id);
    if (!probe.exists) throw new Error("add 块的 data-block-id 元素不存在（跳转无落点 = 第七轮的病）");
    const pulsed = /234,\s*179,\s*8/.test(probe.boxShadow || "");
    if (!pulsed && !probe.inViewport) throw new Error("点击后既无脉冲高亮也未进视口：" + JSON.stringify(probe));
    return { pulsed, inViewport: probe.inViewport, top: probe.top };
  });
  await shot(page, "r7b-03-a3-jump.png");

  // ===== 兜底回归：点「查看 Diff」→ 真切到并排 DiffBlocksView（标题消失=确实切换、非混合内联）=====
  R.diffViewOk = await T("回归 点查看 Diff → 真切并排：3 块 + markdown 标题消失（不再混合）", async () => {
    const headingsBefore = await page.locator("[data-slug]").count(); // 混合内联里应 >0
    await page.getByRole("button", { name: "查看 Diff" }).click(); // 不 catch：点不到就 FAIL
    await page.waitForTimeout(1200);
    const p = await probeInline(page);
    if (p.count !== 3) throw new Error("并排视图块数 ≠ 3：" + p.count);
    const headingsAfter = await page.locator("[data-slug]").count();
    // DiffBlocksView 只渲改动卡片、无 markdown 标题；若仍有 data-slug 说明根本没切（toggle 回归）。
    if (headingsAfter !== 0)
      throw new Error(`查看 Diff 后仍有 ${headingsAfter} 个 markdown 标题（before=${headingsBefore}）——疑未切到并排 DiffBlocksView`);
    return { count: p.count, byKind: p.byKind, headingsBefore, headingsAfter };
  });
  await shot(page, "r7b-04-diff-view.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  const fails = Object.entries(R).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  log("SUMMARY fails=" + JSON.stringify(fails) + " pageErrors=" + errs.length);
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
