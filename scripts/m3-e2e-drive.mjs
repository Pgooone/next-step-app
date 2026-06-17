// M3 · file-panel-hint 真浏览器验收驱动（独立验收员自写）。
// 前置：先 tsx 跑 d4-e2e-fixture.mts（SESSION_CWD 指向含「写普通文件」会话的 cwd）造带 pending 的 artifact，
//       把 FIXTURE_JSON 写进环境变量 FIXTURE。
// 跑法：FIXTURE='<json>' bash .claude/skills/browser-e2e/scripts/run-e2e.sh <本文件绝对路径>
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
// 直接用 ?session= URL 参数恢复指定会话（侧栏「写普通文件」同名会话散落 24 个 cwd，
// 文本点击会命中错误 cwd 触发导航打架）。AppShell initialSessionId 读自 searchParams，
// 该会话 cwd = 项目 root，可正确恢复，让 ChatWindow 离开欢迎态使 PendingChangeCard 挂载。
const selectSessionById = async (page, sessionId) => {
  await page.goto(`${URL}/?session=${encodeURIComponent(sessionId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(WAIT);
};
const openArtifact = async (page, artifactId) => {
  await page.click('[data-testid="open-artifacts-btn"]');
  await page.waitForSelector(`[data-testid="artifact-item-${artifactId}"]`, { timeout: 8000 });
  await page.click(`[data-testid="artifact-item-${artifactId}"]`);
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "引用到对话框"),
    { timeout: 10000 },
  );
  await page.waitForTimeout(1500);
};
// 右面板展开 + 并排 Diff 探测（同 d4）
const panelState = (page) =>
  page.evaluate(() => {
    const cont = document.querySelector(".right-panel-container");
    const open = !!cont && cont.classList.contains("right-panel-open");
    const width = cont ? cont.getBoundingClientRect().width : 0;
    let diffBlocks = 0;
    for (const div of document.querySelectorAll(".right-panel-container div")) {
      const cs = getComputedStyle(div);
      if (parseFloat(cs.borderLeftWidth) < 2.5) continue;
      if (cs.fontFamily.toLowerCase().includes("mono")) diffBlocks++;
    }
    return { open, width: Math.round(width), diffBlocks };
  });

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200));
});

try {
  // 先 goto base 设 localStorage projectId（不 reload），再一次性导航到带 ?session= 的 URL，
  // 让 hydrate 恢复项目 + AppShell initialSessionId 恢复正确会话（该会话 cwd=项目 root，
  // SessionSidebar 据此 setSelectedCwd，绕开「默认选全局最近 cwd」导致的同名会话歧义）。
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), fx.projectId);
  await shot(page, "m3-00-home.png");

  // 前置：用 ?session= 恢复已有会话让 ChatWindow 离开欢迎态（PendingChangeCard 仅在非空会话分支挂载）
  R.pre = await T("前置：?session= 恢复会话离开欢迎态", async () => {
    if (!fx.sessionId) throw new Error("fixture 无 sessionId");
    await selectSessionById(page, fx.sessionId);
    // 离开欢迎态 = 不再显示 Get Started 欢迎页（isEmptyNew 分支）。轮询等会话内容渲染。
    let left = false;
    for (let i = 0; i < 12; i++) {
      left = await page.evaluate(() => {
        const body = document.body.innerText;
        const welcome = body.includes("Get Started") || (body.includes("Pi Agent Web") && body.includes("write a haiku"));
        const inWorkbench = !!document.querySelector('[data-testid="open-artifacts-btn"]');
        return inWorkbench && !welcome;
      });
      if (left) break;
      await page.waitForTimeout(1000);
    }
    if (!left) throw new Error("?session= 恢复后仍在欢迎态/未进工作台");
    return "session-loaded";
  });

  // 打开 artifactA（带 3 块 pending）→ 右面板打开，PendingChangeCard 挂载
  await openArtifact(page, fx.artifactA);
  await page.waitForSelector('[data-testid="pending-change-card"]', { timeout: 8000 });
  await shot(page, "m3-01-both-hints.png");

  // ========================================================================
  // AC① 右侧 ArtifactPanel 顶部「N 处待确认」旁出现「← 在左侧对话框逐块确认」
  // ========================================================================
  R.ac1_right_hint = await T("AC① 右侧 ArtifactPanel 出现「← 在左侧对话框逐块确认」(色 #eab308)", async () => {
    const probe = await page.evaluate(() => {
      // 在 .right-panel-container 内找含该提示文案的元素
      const cont = document.querySelector(".right-panel-container");
      if (!cont) return { found: false, reason: "无右面板容器" };
      let hintEl = null;
      for (const el of cont.querySelectorAll("span")) {
        if (el.textContent && el.textContent.includes("在左侧对话框逐块确认")) { hintEl = el; break; }
      }
      if (!hintEl) return { found: false, reason: "未找到右侧提示文案" };
      // 「N 处待确认」应同区出现
      const hasCount = cont.textContent.includes("处待确认");
      const color = getComputedStyle(hintEl).color;
      return { found: true, hasCount, color, text: hintEl.textContent.trim() };
    });
    if (!probe.found) throw new Error("右侧提示未出现：" + probe.reason);
    if (!probe.hasCount) throw new Error("右侧「N 处待确认」未出现");
    if (probe.color !== "rgb(234, 179, 8)") throw new Error("右侧提示颜色非 #eab308：" + probe.color);
    return probe;
  });

  // ========================================================================
  // AC② 左侧 PendingChangeCard 顶部出现「改动全貌见右侧产物面板（按 D 看并排 Diff）」
  // ========================================================================
  R.ac2_left_hint = await T("AC② 左侧 PendingChangeCard 出现「改动全貌见右侧产物面板（按 D 看并排 Diff）」(色 #eab308)", async () => {
    const probe = await page.evaluate(() => {
      // 实现里 data-testid="pending-change-card" 挂在每个 ChangeCard（子块卡）上，
      // 提示 div 是 PendingChangeCard 容器（ChangeCard 的父）的直接子节点、在所有 ChangeCard 之前。
      // 故应在「首个 card 的 parentElement（= 提示所在容器）」内找提示文案。
      const card = document.querySelector('[data-testid="pending-change-card"]');
      if (!card) return { found: false, reason: "无卡片" };
      const container = card.parentElement;
      if (!container) return { found: false, reason: "卡片无父容器" };
      let hintEl = null;
      for (const el of container.querySelectorAll("div")) {
        if (el.textContent && el.textContent.trim() === "改动全貌见右侧产物面板（按 D 看并排 Diff）") { hintEl = el; break; }
      }
      if (!hintEl) return { found: false, reason: "未找到左侧提示文案" };
      const color = getComputedStyle(hintEl).color;
      return { found: true, color, text: hintEl.textContent.trim() };
    });
    if (!probe.found) throw new Error("左侧提示未出现：" + probe.reason);
    if (probe.color !== "rgb(234, 179, 8)") throw new Error("左侧提示颜色非 #eab308：" + probe.color);
    return probe;
  });

  // ========================================================================
  // AC③ 两提示同色呼应（都为 #eab308 → rgb(234,179,8)）
  // ========================================================================
  R.ac3_same_color = await T("AC③ 左右两提示同色呼应（均 rgb(234,179,8)）", async () => {
    const rc = R.ac1_right_hint.info?.color;
    const lc = R.ac2_left_hint.info?.color;
    if (!rc || !lc) throw new Error("前置提示颜色缺失");
    if (rc !== lc) throw new Error(`左右提示颜色不一致 right=${rc} left=${lc}`);
    if (rc !== "rgb(234, 179, 8)") throw new Error("颜色非 #eab308：" + rc);
    return { right: rc, left: lc };
  });

  // ========================================================================
  // AC⑤ 不移动按块确认按钮：卡片内仍有 3 个「确认此块」+ 3 个「拒绝此块」，
  //     且提示 div 在按钮组之前（仅新增提示，未改动按块控件）
  // ========================================================================
  R.ac5_buttons_intact = await T("AC⑤ 按块确认按钮未被移动/破坏（3 块各 1 confirm+1 reject 共 3+3，提示在所有按钮之上）", async () => {
    const probe = await page.evaluate(() => {
      // 每个 ChangeCard（data-testid=pending-change-card）是一个 diff 块，各含 1 确认+1 拒绝；
      // 3 块 → 共 3 confirm + 3 reject。提示 div 在容器内、所有 card 之前。
      const cards = [...document.querySelectorAll('[data-testid="pending-change-card"]')];
      if (!cards.length) return { found: false };
      const container = cards[0].parentElement;
      const confirmBtns = [...container.querySelectorAll('button[aria-label="确认此块"]')];
      const rejectBtns = [...container.querySelectorAll('button[aria-label="拒绝此块"]')];
      // 提示元素相对首个确认按钮的文档顺序（提示应在按钮之前 → compareDocumentPosition 含 FOLLOWING）
      let hintEl = null;
      for (const el of container.children) {
        if (el.textContent && el.textContent.trim() === "改动全貌见右侧产物面板（按 D 看并排 Diff）") { hintEl = el; break; }
      }
      let hintBeforeButtons = null;
      if (hintEl && confirmBtns[0]) {
        // Node.DOCUMENT_POSITION_FOLLOWING = 4：firstBtn 在 hintEl 之后
        hintBeforeButtons = !!(hintEl.compareDocumentPosition(confirmBtns[0]) & 4);
      }
      return { found: true, cards: cards.length, confirm: confirmBtns.length, reject: rejectBtns.length, hintBeforeButtons };
    });
    if (!probe.found) throw new Error("卡片不存在");
    if (probe.confirm !== 3 || probe.reject !== 3)
      throw new Error(`按块按钮数异常 confirm=${probe.confirm} reject=${probe.reject}（cards=${probe.cards}）`);
    if (probe.hintBeforeButtons !== true)
      throw new Error("提示未在按块确认按钮之上（疑插入位置打乱按钮布局）");
    return probe;
  });

  // ========================================================================
  // AC④ 按 D 键仍能弹并排 Diff（提示在场不破坏联动）
  // ========================================================================
  R.ac4_d_key = await T("AC④ 提示在场时聚焦卡片按 D → 右面板展开并排 Diff（联动不破）", async () => {
    // 先收起右面板，确保按 D 是「真展开」而非已开
    let st = await panelState(page);
    if (st.open) {
      await page.locator('button[title="Hide file panel"]').click();
      await page.waitForTimeout(1000);
      st = await panelState(page);
      if (st.open) throw new Error("收起右面板失败");
    }
    await page.locator('[data-testid="pending-change-card"]').focus();
    await page.waitForTimeout(300);
    await page.keyboard.press("d");
    await page.waitForTimeout(1800);
    const after = await panelState(page);
    if (!after.open) throw new Error("按 D 后右面板未展开：" + JSON.stringify(after));
    if (after.width < 100) throw new Error("按 D 后面板宽度过小：" + after.width);
    if (after.diffBlocks < 1) throw new Error("按 D 后非并排 Diff（无 mono diff 块）：" + JSON.stringify(after));
    return after;
  });
  await shot(page, "m3-02-D-sidebyside-diff.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
