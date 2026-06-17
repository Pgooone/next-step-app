// M7 · 主对话 + 起会话归属 + 左栏按归属分组 真浏览器验收（独立验收员自写）。
// 单 browser / 单 page（内存友好，本机 3.4G 无 swap）。
//
// 两个关键 E2E 坑（已踩并规避，非实现 bug）：
//  1. 新空项目的 selectedCwd 会 fallback 到「全局最近会话 cwd」（SessionSidebar 既有逻辑，
//     用 allSessions 不分项目）；测试环境有大量历史孤儿会话 → 新项目发消息会用错 cwd → 400。
//     规避：给每个测试项目预建一个 cwd=root 的「种子会话」，用 ?session= 恢复它来把 selectedCwd
//     锁定到项目 root，之后 New + 发消息 cwd 才正确。种子会话进「其它会话」区（无归属、非 main）。
//  2. setMain/setOwner 是异步链路（发消息→onSessionCreated→refresh→pickMain→setMain）；
//     必须【轮询 session-map 期望态】，定长 wait 会假阴性。
//
// 环境变量：FIXTURE = {"p1":{id,root,seed},"p2":{id,root,seed}}（由 shell 预建项目+种子会话注入）
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
const api = (m, p, body) =>
  fetch(URL + p, { method: m, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
const getMap = async (projectId) => {
  const r = await api("GET", `/api/projects/${projectId}/session-map`);
  return r.ok ? r.json() : null;
};
// 用 ?session= 恢复指定会话，让 selectedCwd 锁到该会话 cwd（= 项目 root）
const restoreSession = async (page, projectId, sessionId) => {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), projectId);
  await page.goto(`${URL}/?session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(WAIT);
};
const waitIdle = async (page, timeoutMs = 22000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const has = (x) => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === x);
      return { send: has("Send"), streaming: has("Steer") || has("Follow-up") || has("Stop") };
    });
    if (st.send && !st.streaming) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
// 点 New 开新会话（继承当前 selectedCwd = 项目 root）
const newSession = async (page) => {
  await page.locator('button[title*="New session"], button:has-text("New")').first().click();
  await page.waitForTimeout(1500);
};
const sendMessage = async (page, text) => {
  await page.locator("textarea").first().fill(text);
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Send")').first().click();
  await waitIdle(page);
};
// 轮询 session-map 直到谓词成立（异步 setMain/setOwner 必须轮询，非定长 wait）
const pollMap = async (projectId, pred, tries = 25, gapMs = 1000) => {
  let map = null;
  for (let i = 0; i < tries; i++) {
    map = await getMap(projectId);
    if (map && pred(map)) return map;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return map;
};
// 读侧栏三区结构
const readSidebar = (page) =>
  page.evaluate(() => {
    const hasMainHeader = [...document.querySelectorAll("div")].some((d) => d.textContent?.trim() === "主对话");
    const hasOtherHeader = [...document.querySelectorAll("div")].some((d) => d.textContent?.trim() === "其它会话");
    const agentGroups = [];
    for (const btn of document.querySelectorAll("button")) {
      const spans = [...btn.querySelectorAll("span")];
      const dot = spans.find((s) => {
        const cs = getComputedStyle(s);
        return cs.borderRadius === "50%" && parseFloat(cs.width) <= 9 && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      });
      if (!dot) continue;
      const nameSpan = spans.find((s) => getComputedStyle(s).flex.startsWith("1"));
      const countSpan = spans[spans.length - 1];
      const count = countSpan && /^\d+$/.test(countSpan.textContent?.trim() || "") ? countSpan.textContent.trim() : null;
      if (nameSpan && count !== null) {
        agentGroups.push({ name: nameSpan.textContent.trim(), count, dotColor: getComputedStyle(dot).backgroundColor });
      }
    }
    return { hasMainHeader, hasOtherHeader, agentGroups };
  });

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  // 恢复 P1 种子会话锁 cwd
  await restoreSession(page, fx.p1.id, fx.p1.seed);
  await shot(page, "m7-00-p1-seed-restored.png");

  // ========================================================================
  // 5.2 part A：首条普通消息 → 建会话 → 标 main（轮询 session-map.mainSessionId 被标）
  //   种子会话是 API 建的、未标 main；本条经 handleSessionCreated(claimMain=true) 应标 main。
  // ========================================================================
  R.s52_first_main = await T("[5.2] 首条普通消息建会话→标 main（轮询 session-map.mainSessionId 命中新会话）", async () => {
    const mapBefore = await getMap(fx.p1.id);
    if (mapBefore?.mainSessionId) throw new Error("前置不净：已有 mainSessionId=" + mapBefore.mainSessionId);
    await newSession(page);
    await sendMessage(page, "第一条主对话消息");
    const map = await pollMap(fx.p1.id, (m) => !!m.mainSessionId);
    if (!map?.mainSessionId) throw new Error("发首条后 mainSessionId 仍空（setMain 未生效）");
    // mainSessionId 应是新会话（≠ 种子会话）
    if (map.mainSessionId === fx.p1.seed) throw new Error("种子会话被误标 main");
    const sb = await readSidebar(page);
    if (!sb.hasMainHeader) throw new Error("侧栏未出现「主对话」区标题");
    return { mainSessionId: map.mainSessionId, sidebar: sb };
  });
  await shot(page, "m7-01-first-main.png");

  // ========================================================================
  // 5.2 part B：第二条 → 不抢 main（轮询确认 mainSessionId 不变）
  // ========================================================================
  R.s52_second_other = await T("[5.2] 第二条会话不抢 main（mainSessionId 保持第一条）", async () => {
    const mainBefore = R.s52_first_main.info?.mainSessionId;
    await newSession(page);
    await sendMessage(page, "第二条普通消息不该当主对话");
    // 等第二条会话进 map（bySession 或 others），但 mainSessionId 必须不变
    await new Promise((r) => setTimeout(r, 3000));
    const map = await getMap(fx.p1.id);
    if (map.mainSessionId !== mainBefore)
      throw new Error(`第二条抢占 main：原 ${mainBefore} → 现 ${map.mainSessionId}`);
    const sb = await readSidebar(page);
    if (!sb.hasOtherHeader) throw new Error("侧栏未出现「其它会话」区（第二条/种子应在此）");
    return { mainStillIs: map.mainSessionId, sidebar: sb };
  });
  await shot(page, "m7-02-second-other.png");

  // ========================================================================
  // 5.3：建 agent → 菜单起会话 → 进 agent 分组、不在主对话区（轮询 bySession 旁证）
  // ========================================================================
  const AGENT_NAME = "归属测试甲";
  R.s53_agent_group = await T("[5.3] agent 菜单起会话→进 agent 分组、不抢 main + session-map.bySession 旁证", async () => {
    await page.click('[data-testid="open-agents-btn"]');
    await page.waitForSelector('[data-testid="agent-manager"]', { timeout: 8000 });
    await page.click('[data-testid="agent-new-btn"]');
    await page.waitForSelector('[data-testid="agent-form-name"]', { timeout: 8000 });
    await page.fill('[data-testid="agent-form-name"]', AGENT_NAME);
    await page.click('[data-testid="agent-save-btn"]');
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('[data-testid="agent-item"]')].some((c) => c.getAttribute("data-agent-name") === n),
      AGENT_NAME, { timeout: 10000 },
    );
    const agentsList = await (await api("GET", `/api/projects/${fx.p1.id}/agents`)).json();
    const agentId = (agentsList.find((a) => a.name === AGENT_NAME) || {}).id;
    await page.click(`[data-testid="agent-item"][data-agent-name="${AGENT_NAME}"]`);
    await page.waitForSelector('[data-testid="agent-menu"]', { timeout: 8000 });
    await page.fill('[data-testid="agent-start-input"]', "用归属测试甲起的会话");
    await page.click('[data-testid="agent-start-submit"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="agent-manager"]'), { timeout: 15000 });
    await waitIdle(page);
    // 轮询 bySession 出现该 agent 的归属（服务端 setOwner）
    const map = await pollMap(fx.p1.id, (m) => Object.values(m.bySession || {}).includes(agentId));
    const owned = Object.entries(map?.bySession || {}).filter(([, aid]) => aid === agentId);
    if (owned.length === 0) throw new Error("session-map.bySession 无该 agent 归属（服务端 setOwner 未生效）");
    const agentSid = owned[0][0];
    if (map.mainSessionId === agentSid) throw new Error("agent 会话被误标 main");
    // 侧栏出现该 agent 分组
    let sb = null;
    for (let i = 0; i < 12; i++) {
      sb = await readSidebar(page);
      if (sb.agentGroups.some((g) => g.name === AGENT_NAME)) break;
      await page.waitForTimeout(800);
    }
    if (!sb.agentGroups.some((g) => g.name === AGENT_NAME))
      throw new Error("侧栏未出现 agent 分组：" + JSON.stringify(sb.agentGroups));
    return { agentId, agentSid, mainSessionId: map.mainSessionId, group: sb.agentGroups.find((g) => g.name === AGENT_NAME) };
  });
  await shot(page, "m7-03-agent-group.png");

  // ========================================================================
  // 5.4：三区呈现 + agent 分组色点/名/计数/可折叠
  // ========================================================================
  R.s54_three_zones = await T("[5.4] 三区呈现（主对话+agent分组+其它）/ agent 分组色点+名+计数+可折叠", async () => {
    const sb = await readSidebar(page);
    if (!sb.hasMainHeader) throw new Error("无「主对话」区");
    if (!sb.hasOtherHeader) throw new Error("无「其它会话」区");
    const grp = sb.agentGroups.find((g) => g.name === AGENT_NAME);
    if (!grp) throw new Error("无 agent 分组");
    if (!grp.dotColor || grp.dotColor === "rgba(0, 0, 0, 0)") throw new Error("agent 分组无色点");
    if (!/^\d+$/.test(grp.count)) throw new Error("agent 分组无计数");
    // 可折叠：点分组标题 toggle（组内 SessionTreeItem 出现/消失）
    const countItems = () => page.evaluate((name) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        [...b.querySelectorAll("span")].some((s) => s.textContent?.trim() === name) &&
        [...b.querySelectorAll("span")].some((s) => getComputedStyle(s).borderRadius === "50%"));
      if (!btn) return -1;
      // 该分组容器（按钮的父 div）下，会话项数（含可点会话标题的元素，排除标题按钮自身）
      const container = btn.parentElement;
      return container ? container.querySelectorAll("button").length : -1;
    }, AGENT_NAME);
    const beforeFold = await countItems();
    // 折叠
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        [...b.querySelectorAll("span")].some((s) => s.textContent?.trim() === name) &&
        [...b.querySelectorAll("span")].some((s) => getComputedStyle(s).borderRadius === "50%"));
      btn?.click();
    }, AGENT_NAME);
    await page.waitForTimeout(500);
    const afterFold = await countItems();
    // 展开回去
    await page.evaluate((name) => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        [...b.querySelectorAll("span")].some((s) => s.textContent?.trim() === name) &&
        [...b.querySelectorAll("span")].some((s) => getComputedStyle(s).borderRadius === "50%"));
      btn?.click();
    }, AGENT_NAME);
    await page.waitForTimeout(400);
    const afterUnfold = await countItems();
    // 折叠后按钮数应减少（组内会话项隐藏），展开后恢复
    if (!(afterFold < beforeFold && afterUnfold > afterFold))
      throw new Error(`折叠 toggle 未改变组内项数 before=${beforeFold} folded=${afterFold} unfolded=${afterUnfold}`);
    return { mainHeader: true, otherHeader: true, agentGroup: grp, foldCounts: { beforeFold, afterFold, afterUnfold } };
  });
  await shot(page, "m7-04-three-zones.png");

  // ========================================================================
  // 防串显：切到 P2（恢复 P2 种子）→ 不见 P1 的 agent 分组；切回 P1 → agent 分组回来、不见 P2 内容
  // ========================================================================
  R.no_cross_leak = await T("[防串显] 切项目侧栏只显当前项目分组、无旧项目残留", async () => {
    // 切到 P2（恢复其种子会话锁 cwd）
    await restoreSession(page, fx.p2.id, fx.p2.seed);
    const sbP2 = await readSidebar(page);
    if (sbP2.agentGroups.some((g) => g.name === AGENT_NAME))
      throw new Error("项目乙残留了项目甲的 agent 分组「" + AGENT_NAME + "」");
    // 切回 P1
    await restoreSession(page, fx.p1.id, fx.p1.seed);
    let sbP1 = null;
    for (let i = 0; i < 12; i++) {
      sbP1 = await readSidebar(page);
      if (sbP1.agentGroups.some((g) => g.name === AGENT_NAME)) break;
      await page.waitForTimeout(800);
    }
    if (!sbP1.agentGroups.some((g) => g.name === AGENT_NAME))
      throw new Error("切回项目甲后 agent 分组丢失（疑 store 未按项目恢复）");
    return { p2NoLeak: !sbP2.agentGroups.some((g) => g.name === AGENT_NAME), p1AgentBack: true, p2Groups: sbP2.agentGroups.map((g) => g.name) };
  });
  await shot(page, "m7-05-no-cross-leak.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  R.nonFilesErrors = errs.filter((e) => !/\/api\/files\//.test(e) && !e.includes("403"));
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
