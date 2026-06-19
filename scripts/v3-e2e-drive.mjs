// 第三轮 V3「受管文档入口并入 file panel」真浏览器验收驱动（测试资产，不属实现）。
// 前置：先 tsx 跑 scripts/v3-e2e-fixture.mts 造数据，把 FIXTURE_JSON 写进环境变量 FIXTURE。
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

// 文件树节点计数：TreeNode 的 name span 带 title=node.fullPath（=<cwd>/<name>），按 "/<filename>" 后缀匹配。
// 受管分组行的 span title=a.title（纯标题、无路径无 .md），故不会与 "/xxx.md" 后缀混淆。
const treeFileCount = (page, suffix) =>
  page.evaluate(
    (suf) =>
      [...document.querySelectorAll("span[title]")].filter((s) =>
        (s.getAttribute("title") || "").endsWith(suf),
      ).length,
    suffix,
  );

// 受管分组状态：分组项数（data-testid^=managed-artifact-）、是否有「受管文档」组标题、指定 id 是否在列。
const managedGroupState = (page, ids) =>
  page.evaluate((wantIds) => {
    const items = [...document.querySelectorAll('[data-testid^="managed-artifact-"]')];
    const present = items.map((el) => el.getAttribute("data-testid"));
    const bodyText = document.body.innerText;
    return {
      count: items.length,
      hasHeader: bodyText.includes("受管文档"),
      has: Object.fromEntries(wantIds.map((id) => [id, present.includes(`managed-artifact-${id}`)])),
    };
  }, ids);

// 经新分组入口打开 artifact：点 managed-artifact-<id> → 等右栏 ArtifactPanel（以「引用到对话框」按钮为标志）。
const openArtifactViaGroup = async (page, id) => {
  await page.waitForSelector(`[data-testid="managed-artifact-${id}"]`, { timeout: 10000 });
  await page.click(`[data-testid="managed-artifact-${id}"]`);
  await page
    .waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "引用到对话框"),
      { timeout: 12000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1200);
};

// 右栏形态：是否 ArtifactPanel（有「引用到对话框」按钮）、是否「N 处待确认」、正文片段。
const rightPanelState = (page) =>
  page.evaluate(() => {
    const cont = document.querySelector(".right-panel-container") || document.body;
    const text = cont.innerText || "";
    const isArtifactPanel = [...document.querySelectorAll("button")].some(
      (b) => b.textContent?.trim() === "引用到对话框",
    );
    const pendingBadge = /\d+\s*处待确认/.test(text);
    return { isArtifactPanel, pendingBadge, text: text.slice(0, 300) };
  });

const hasArtifactsButton = (page) => page.locator('[data-testid="open-artifacts-btn"]').count();
const cardGone = (page) =>
  page.evaluate(() => !document.querySelector('[data-testid="pending-change-card"]'));

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200));
});

try {
  await gotoSPA(page, URL);
  await selectProject(page, fx.p1);
  // 等受管分组首屏加载（首次冷编译可慢）
  await page.waitForSelector('[data-testid^="managed-artifact-"]', { timeout: 15000 }).catch(() => {});
  // 普通树 fetchEntries 走文件 API、首次冷编译慢，定长 wait 不够 → 轮询等已知普通文件出现（树就绪）。
  await page.waitForSelector('span[title$="/项目说明.md"]', { timeout: 20000 }).catch(() => {});
  await shot(page, "v3-00-home.png");

  // ===== AC④ 左栏底部无「Artifacts」按钮、无任何入口能弹 ArtifactPicker =====
  R.ac4_no_button = await T("AC④ 无 open-artifacts-btn（Artifacts 按钮 + Picker 已删）", async () => {
    const n = await hasArtifactsButton(page);
    if (n !== 0) throw new Error("仍存在 open-artifacts-btn，数量 " + n);
    return "no-artifacts-button";
  });

  // ===== AC① 受管分组列出全部 listArtifacts 条目，数量与 API 一致 =====
  R.ac1_group = await T("AC① 受管分组列出全部受管 artifact（数量=API、含 artClean+artPend、有组标题）", async () => {
    const api = await page.evaluate(async (pid) => {
      const r = await fetch(`/api/projects/${encodeURIComponent(pid)}/artifacts`);
      return await r.json();
    }, fx.p1);
    const st = await managedGroupState(page, [fx.artClean, fx.artPend]);
    if (!st.hasHeader) throw new Error("无「受管文档」组标题");
    if (st.count !== api.length)
      throw new Error(`分组项数 ${st.count} ≠ API 返回 ${api.length}`);
    if (!st.has[fx.artClean] || !st.has[fx.artPend])
      throw new Error("分组缺 artClean/artPend：" + JSON.stringify(st.has));
    return { count: st.count, apiLen: api.length };
  });

  // ===== AC⑤ 树根无 .pi；普通 .md 仍显示（.pi 隐藏未误伤项目根 md）=====
  R.ac5_pi_hidden = await T("AC⑤ 树无 .pi 节点 + 普通 项目说明.md 在树（.pi 隐藏不误伤）", async () => {
    const piCount = await treeFileCount(page, "/.pi");
    if (piCount !== 0) throw new Error(".pi 仍在文件树（应隐藏），count=" + piCount);
    const mdCount = await treeFileCount(page, "/项目说明.md");
    if (mdCount < 1) throw new Error("普通 项目说明.md 未在文件树显示");
    return { piCount, plainMdCount: mdCount };
  });

  // ===== AC③/AC⑧ 物化受管 .md 只在分组、不在普通树；多次刷新无残留闪现 =====
  R.ac3_dedup = await T("AC③ 物化受管 .md 在普通树被去重剔除 + 刷新×2 仍剔除 + 分组复现", async () => {
    const suffix = "/" + fx.artCleanFile; // 如 /需求规格.md
    // 先确认普通树确已加载（项目说明.md 在场），否则「需求规格.md 不在树」是空树假过、dedup 断言无意义。
    await page.waitForSelector('span[title$="/项目说明.md"]', { timeout: 20000 }).catch(() => {});
    if ((await treeFileCount(page, "/项目说明.md")) < 1)
      throw new Error("普通树未加载（项目说明.md 缺），dedup 断言无意义");
    const c0 = await treeFileCount(page, suffix);
    if (c0 !== 0) throw new Error(`物化受管 ${fx.artCleanFile} 不应在普通树，count=${c0}`);
    for (let i = 0; i < 2; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(WAIT);
      await page.waitForSelector('[data-testid^="managed-artifact-"]', { timeout: 12000 }).catch(() => {});
      await page.waitForSelector('span[title$="/项目说明.md"]', { timeout: 15000 }).catch(() => {});
      if ((await treeFileCount(page, "/项目说明.md")) < 1)
        throw new Error(`刷新第 ${i + 1} 次后普通树未加载（项目说明.md 缺）`);
      const ci = await treeFileCount(page, suffix);
      if (ci !== 0) throw new Error(`刷新第 ${i + 1} 次后受管 .md 又现于普通树，count=${ci}`);
      const st = await managedGroupState(page, [fx.artClean]);
      if (!st.has[fx.artClean]) throw new Error(`刷新第 ${i + 1} 次后分组缺 artClean`);
    }
    return "deduped-and-stable (树非空且 需求规格.md 被剔)";
  });

  // ===== AC⑧-a 点普通文件 → 右栏走 FileViewer（此时未开任何 artifact、selectedArtifactId 为空）=====
  R.ac8_fileviewer = await T("AC⑧ 点普通 项目说明.md → 右栏 FileViewer（非 ArtifactPanel）+ 显示文件正文", async () => {
    await page.click('span[title$="/项目说明.md"]');
    await page.waitForTimeout(2000);
    const st = await rightPanelState(page);
    if (st.isArtifactPanel) throw new Error("点普通文件却进了 ArtifactPanel（应 FileViewer）");
    if (!st.text.includes("项目说明") && !st.text.includes("普通非受管"))
      throw new Error("FileViewer 未显示 项目说明.md 正文：" + st.text);
    return "fileviewer-ok";
  });
  await shot(page, "v3-AC8-fileviewer.png");

  // ===== AC② 点受管分组一条 → 右栏切 ArtifactPanel；不经 filePath 反查即成功 =====
  R.ac2_open = await T("AC② 点受管 artClean → 右栏 ArtifactPanel（引用到对话框可用）+ 正文为该 artifact", async () => {
    await openArtifactViaGroup(page, fx.artClean);
    const st = await rightPanelState(page);
    if (!st.isArtifactPanel) throw new Error("点受管分组未进 ArtifactPanel");
    if (!st.text.includes("需求规格") && !st.text.includes("纯浏览"))
      throw new Error("ArtifactPanel 正文非 artClean：" + st.text);
    return "artifactpanel-ok";
  });
  await shot(page, "v3-AC2-artifactpanel.png");

  // ===== AC⑨-clean 纯浏览（无 pending）：右栏无「N 处待确认」 =====
  R.ac9_clean = await T("AC⑨ 纯浏览 artClean：右栏无「N 处待确认」+ 中栏无 pending-change-card", async () => {
    const st = await rightPanelState(page);
    if (st.pendingBadge) throw new Error("无 pending 的 artClean 不应显示「N 处待确认」");
    const noCard = await cardGone(page);
    if (!noCard) throw new Error("无 pending 时中栏不应出现 pending-change-card");
    return "clean-ok";
  });

  // ===== AC⑨-pend 经新入口打开 artPend → 右栏「N 处待确认」（证新入口 open() 正确加载 pendingChanges）=====
  R.ac9_pend_badge = await T("AC⑨ 经新分组入口打开 artPend → 右栏出现「N 处待确认」", async () => {
    await openArtifactViaGroup(page, fx.artPend);
    let st = null;
    for (let i = 0; i < 10; i++) {
      st = await rightPanelState(page);
      if (st.pendingBadge) break;
      await page.waitForTimeout(600);
    }
    if (!st.pendingBadge) throw new Error("artPend 经新入口打开后右栏无「N 处待确认」：" + st.text);
    return "pending-badge-ok";
  });
  await shot(page, "v3-AC9-pending-badge.png");

  // ===== AC⑥ type=read 读 .pi 下文件仍正常（派发产物链路不回归）=====
  R.ac6_read_pi = await T("AC⑥ type=read 读 .pi 侧车文件 → 200（list 隐藏但 read 不查 IGNORED_NAMES）", async () => {
    const status = await page.evaluate(async (probe) => {
      const enc = probe.split("/").filter(Boolean).map(encodeURIComponent).join("/");
      const r = await fetch(`/api/files/${enc}?type=read`);
      return { status: r.status, ok: r.ok };
    }, fx.piProbe);
    if (status.status !== 200) throw new Error(".pi type=read 非 200，实为 " + status.status);
    return status;
  });

  // ===== AC⑦-a 受管分组可折叠 =====
  R.ac7_collapse = await T("AC⑦ 受管分组可折叠：点组标题 → 项隐藏 → 再点 → 复现", async () => {
    const before = (await managedGroupState(page, [])).count;
    if (before < 1) throw new Error("折叠前分组应有项");
    await page.click("text=受管文档");
    await page.waitForTimeout(600);
    const collapsed = (await managedGroupState(page, [])).count;
    if (collapsed !== 0) throw new Error("折叠后仍有可见分组项，count=" + collapsed);
    await page.click("text=受管文档");
    await page.waitForTimeout(600);
    const after = (await managedGroupState(page, [])).count;
    if (after !== before) throw new Error(`展开后项数 ${after} ≠ 折叠前 ${before}`);
    return { before, after };
  });

  // ===== AC⑦-b 空项目 P2：不显分组、树照常、无报错 =====
  const errsBeforeP2 = errs.length;
  R.ac7_empty = await T("AC⑦ 切空项目 P2 → 无受管分组、普通树显 readme.txt、无新报错", async () => {
    await selectProject(page, fx.p2);
    await page.waitForTimeout(1500);
    const st = await managedGroupState(page, []);
    if (st.count !== 0) throw new Error("空项目仍显示受管分组项，count=" + st.count);
    if (st.hasHeader) throw new Error("空项目不应有「受管文档」组标题");
    const readme = await treeFileCount(page, "/readme.txt");
    if (readme < 1) throw new Error("空项目普通树未显示 readme.txt");
    const newErrs = errs.slice(errsBeforeP2);
    if (newErrs.length) throw new Error("空项目触发报错：" + JSON.stringify(newErrs));
    return { readme };
  });
  await shot(page, "v3-AC7-empty-project.png");

  // ===== AC⑨ Tier2（best-effort）：有会话则验中栏确认卡 + resolve 全块后消失 =====
  if (fx.sessionId) {
    R.ac9_center_card = await T("AC⑨ Tier2 选会话离开欢迎态 → 经新入口开 artPend → 中栏确认卡出现 → 全部✓ → 卡消失", async () => {
      // 经 ?session= 恢复会话（确定性，不依赖会话显示文本），currentProjectId 仍由 localStorage 保持 P1
      await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), fx.p1);
      await page.goto(`${URL}/?session=${encodeURIComponent(fx.sessionId)}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(WAIT);
      await openArtifactViaGroup(page, fx.artPend);
      const appeared = await page
        .waitForSelector('[data-testid="pending-change-card"]', { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (!appeared) throw new Error("选会话后中栏未出现 pending-change-card（疑未离开 isEmptyNew）");
      await shot(page, "v3-AC9-center-card.png");
      // 全部 ✓ → 卡消失
      await page.locator('[data-testid="pending-change-card"]').getByRole("button", { name: "全部 ✓" }).click();
      let gone = false;
      for (let i = 0; i < 12; i++) {
        if (await cardGone(page)) { gone = true; break; }
        await page.waitForTimeout(600);
      }
      if (!gone) throw new Error("全部 ✓ 后中栏确认卡未消失");
      return "center-card-resolve-ok";
    });
    await shot(page, "v3-AC9-card-resolved.png");
  } else {
    R.ac9_center_card = { ok: true, info: "skipped: 无可复用会话，中栏卡系 D4 已验且 V3 未改结构（新入口调同一 open()，右栏 N处待确认 已证同源）" };
    log("SKIP", "AC⑨ Tier2 中栏卡（无 sessionId）");
  }
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  const fails = Object.entries(R).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  log("SUMMARY fails=" + JSON.stringify(fails) + " pageErrors=" + errs.length);
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
