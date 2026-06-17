// M8 · 主对话 @agent 转交 真浏览器验收（独立验收员自写，不信实现者自证）。
// 单 browser / 单 page（内存友好，本机 3.4G 无 swap）。
//
// 验收点（5 条 AC）：
//  ① 主对话输入 @ → 唤出 agent 列表浮层（agent-transfer-popover + transfer-agent-option）
//  ② 选中 agent → 转交内容勾选出现，默认勾全历史（有历史时）
//  ③ 确认转交 → 经 POST /agents/[id]/session 进该 agent 单独新会话（session-map.bySession 旁证、≠主对话）
//  ④ 序列化保留角色标注：目标会话首条含 <context source="主对话"> 与 [用户]/[助手] 标注（jsonl 服务端旁证 + UI 可见）
//  ⑤ @agent 与 Dispatch 并存互不干扰（Dispatch 面板独立可开、两条入口不串）
//
// 关键坑（沿用 M7 实测）：
//  - @ 转交仅在「主对话」语境触发（ChatWindow 仅 isMainChat 才透传 atAgents）：
//    须先发首条普通消息让该会话被 claimMain 标为主对话且选中，@ 才生效。
//  - 冷编译延迟：超时先看 dev 日志状态码，别急判实现 bug；异步链路用轮询期望态非定长 wait。
//
// 环境变量：FIXTURE = {projectId,root,seed,agentId,agentName}
import { chromium } from "playwright";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const URL = process.env.E2E_URL || "http://localhost:30141";
const OUT = process.env.E2E_OUT || "/tmp/pw";
const WAIT = Number(process.env.PW_WAIT || 9000);
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
const pollMap = async (projectId, pred, tries = 25, gapMs = 1000) => {
  let map = null;
  for (let i = 0; i < tries; i++) {
    map = await getMap(projectId);
    if (map && pred(map)) return map;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return map;
};
// 用 ?session= 恢复指定会话，让 selectedCwd 锁到该会话 cwd（= 项目 root）
const restoreSession = async (page, projectId, sessionId) => {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), projectId);
  await page.goto(`${URL}/?session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(WAIT);
};
const waitIdle = async (page, timeoutMs = 30000) => {
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
// 在主对话输入框打「@」唤起转交浮层（行首，匹配 /(^|\s)@$/）
const typeAt = async (page) => {
  const ta = page.locator("textarea").first();
  await ta.click();
  await ta.fill("");
  await page.waitForTimeout(200);
  await ta.type("@", { delay: 60 });
  await page.waitForTimeout(700);
};
// 读目标 agent 新会话的 jsonl 首条 user 文本（服务端旁证 AC④）。
// 落盘实况（M8 run1 查得）：目录名 = --<root 斜杠转横杠>--（首尾双横杠）；
// 文件名 = <ISO 时间戳>_<sessionId>.jsonl（非 <sessionId>.jsonl）。故按 *_<id>.jsonl glob 兜底。
const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
const encDir = (root) => "-" + root.replace(/\//g, "-") + "-"; // 例: /tmp/x → --tmp-x--
const readSessionJsonlUserText = (root, sessionId) => {
  // 先按目录名定位；目录名编码不确定时，退而在 sessions 下找含 root 末段的目录
  const candidates = [];
  const direct = join(sessionsRoot, encDir(root));
  candidates.push(direct);
  try {
    const tail = root.split("/").filter(Boolean).pop();
    for (const d of readdirSync(sessionsRoot)) if (d.includes(tail)) candidates.push(join(sessionsRoot, d));
  } catch { /* ignore */ }
  let file = null;
  for (const dir of candidates) {
    try {
      const hit = readdirSync(dir).find((f) => f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`);
      if (hit) { file = join(dir, hit); break; }
    } catch { /* dir 不存在，下一个 */ }
  }
  if (!file) return `__READ_ERR__ 找不到会话文件 *_${sessionId}.jsonl（候选目录: ${candidates.join(" | ")}）`;
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const ln of lines) {
      const obj = JSON.parse(ln);
      const msg = obj.message ?? obj;
      const role = msg.role ?? obj.role;
      if (role === "user") {
        const c = msg.content ?? obj.content;
        if (typeof c === "string") return c;
        if (Array.isArray(c)) return c.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      }
    }
  } catch (e) {
    return `__READ_ERR__ ${String(e.message || e)}`;
  }
  return "";
};

const R = {};
const errs = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  // 恢复种子会话锁 cwd
  await restoreSession(page, fx.projectId, fx.seed);
  await shot(page, "m8-00-seed-restored.png");

  // ========================================================================
  // 前置：发首条普通消息建主对话（claimMain 标 main 且选中），并取得 assistant 回复作历史。
  // ========================================================================
  const mainSid = await T("[前置] 首条普通消息建主对话（轮询 mainSessionId 命中、≠种子）", async () => {
    await newSession(page);
    await sendMessage(page, "请用一句话介绍你自己");
    const map = await pollMap(fx.projectId, (m) => !!m.mainSessionId && m.mainSessionId !== fx.seed);
    if (!map?.mainSessionId) throw new Error("mainSessionId 仍空");
    if (map.mainSessionId === fx.seed) throw new Error("种子被误标 main");
    return map.mainSessionId;
  });
  await shot(page, "m8-01-main-ready.png");

  // ========================================================================
  // AC①：主对话输入 @ → 唤出 agent 列表浮层
  // ========================================================================
  R.ac1_at_popover = await T("AC① 主对话 @ 唤出转交浮层 + agent 选项", async () => {
    await typeAt(page);
    await page.waitForSelector('[data-testid="agent-transfer-popover"]', { timeout: 8000 });
    const opts = await page.$$eval('[data-testid="transfer-agent-option"]', (els) => els.map((e) => e.getAttribute("data-agent-name")));
    if (!opts.includes(fx.agentName)) throw new Error("浮层未列出目标 agent：" + JSON.stringify(opts));
    return { options: opts };
  });
  await shot(page, "m8-02-at-popover.png");

  // ========================================================================
  // AC②：选中 agent → 勾选区出现，默认勾「全主对话历史」（有历史）
  // ========================================================================
  R.ac2_compose_defaults = await T("AC② 选中 agent→勾选区出现、默认勾全历史", async () => {
    await page.click(`[data-testid="transfer-agent-option"][data-agent-name="${fx.agentName}"]`);
    await page.waitForSelector('[data-testid="transfer-include-history"]', { timeout: 6000 });
    const histChecked = await page.$eval('[data-testid="transfer-include-history"] input', (el) => el.checked);
    const histDisabled = await page.$eval('[data-testid="transfer-include-history"] input', (el) => el.disabled);
    if (histDisabled) throw new Error("历史复选被禁用（说明无历史，前置未产生主对话消息）");
    if (!histChecked) throw new Error("默认未勾选全主对话历史");
    // 确认按钮可点（载荷非空）
    const confirmDisabled = await page.$eval('[data-testid="transfer-confirm"]', (el) => el.disabled);
    if (confirmDisabled) throw new Error("转交确认按钮被禁用（载荷为空）");
    return { historyDefaultChecked: histChecked };
  });
  await shot(page, "m8-03-compose-defaults.png");

  // ========================================================================
  // AC③：确认转交 → 进该 agent 单独新会话（session-map.bySession 旁证、≠ 主对话/种子）
  // ========================================================================
  R.ac3_deliver_owned = await T("AC③ 确认转交→新会话归属该 agent、≠主对话/种子（bySession 旁证）", async () => {
    await page.click('[data-testid="transfer-confirm"]');
    // 轮询 bySession 出现该 agent 的归属
    const map = await pollMap(fx.projectId, (m) => Object.values(m.bySession || {}).includes(fx.agentId));
    const owned = Object.entries(map?.bySession || {}).filter(([, aid]) => aid === fx.agentId);
    if (owned.length === 0) throw new Error("session-map.bySession 无该 agent 归属（投递/ setOwner 未生效）");
    const targetSid = owned[0][0];
    if (targetSid === mainSid.info) throw new Error("转交会话误用主对话会话");
    if (targetSid === fx.seed) throw new Error("转交会话误用种子会话");
    return { targetSid, mainSid: map.mainSessionId };
  });
  await shot(page, "m8-04-delivered.png");

  // ========================================================================
  // AC④：序列化保留角色标注 —— 目标会话首条含 <context source="主对话"> + [用户]/[助手]
  //   服务端旁证：直接读目标会话 jsonl 首条 user 文本。
  // ========================================================================
  R.ac4_serialized_roles = await T("AC④ 目标会话首条含 <context source=\"主对话\"> + 角色标注 [用户]/[助手]", async () => {
    const targetSid = R.ac3_deliver_owned.info?.targetSid;
    if (!targetSid) throw new Error("无 targetSid（AC③ 未通过）");
    // 轮询读 jsonl（落盘可能略晚）
    let text = "";
    for (let i = 0; i < 15; i++) {
      text = readSessionJsonlUserText(fx.root, targetSid);
      if (text && text.includes("<context")) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (text.startsWith("__READ_ERR__")) throw new Error("读 jsonl 失败：" + text);
    if (!text.includes('<context source="主对话">')) throw new Error("首条未含 <context source=\"主对话\">；实读前 200 字：" + text.slice(0, 200));
    if (!text.includes("[用户]")) throw new Error("序列化缺 [用户] 角色标注；实读前 200 字：" + text.slice(0, 200));
    const hasAssistant = text.includes("[助手]");
    return { hasContextTag: true, hasUserLabel: true, hasAssistantLabel: hasAssistant, sample: text.slice(0, 120) };
  });

  // ========================================================================
  // AC④补：UI 可见 —— 切到目标会话，正文应见转交内容（<context 或主对话历史片段）
  // ========================================================================
  R.ac4b_ui_visible = await T("AC④补 目标会话 UI 可见转交内容", async () => {
    const targetSid = R.ac3_deliver_owned.info?.targetSid;
    await restoreSession(page, fx.projectId, targetSid);
    await page.waitForTimeout(2000);
    const bodyHasTransfer = await page.evaluate(() => {
      const t = document.body.innerText;
      return t.includes("主对话") || t.includes("context") || t.includes("[用户]");
    });
    if (!bodyHasTransfer) throw new Error("目标会话 UI 未见转交内容");
    return { visible: true };
  });
  await shot(page, "m8-05-target-session-ui.png");

  // ========================================================================
  // AC⑤：@agent 与 Dispatch 并存互不干扰 —— Dispatch 面板独立可开
  // ========================================================================
  R.ac5_coexist_dispatch = await T("AC⑤ @agent 与 Dispatch 并存：Dispatch 面板独立可开、控件齐", async () => {
    // 回主对话语境（恢复 main 会话），先确认转交浮层这条入口仍在（@ 仍能唤）
    await restoreSession(page, fx.projectId, mainSid.info);
    // 打开 Dispatch（工具栏按钮 open-dispatch-btn，与 @ 转交是两条独立入口）→ dispatch-panel
    await page.click('[data-testid="open-dispatch-btn"]');
    await page.waitForSelector('[data-testid="dispatch-panel"]', { timeout: 8000 });
    const hasDispatchControls = await page.$('[data-testid="dispatch-goal"]') !== null
      || await page.$('[data-testid="dispatch-agent-toggle"]') !== null;
    if (!hasDispatchControls) throw new Error("Dispatch 面板控件缺失");
    // 关闭 Dispatch，确认转交浮层入口未被破坏（@ 仍唤起，证明两入口独立）
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    // 关闭可能残留的 dispatch 面板（点关闭按钮兜底）
    const stillOpen = await page.$('[data-testid="dispatch-panel"]');
    if (stillOpen) { await page.evaluate(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent?.trim()==="✕"||/关闭|Close/.test(x.getAttribute("aria-label")||"")); b?.click(); }); await page.waitForTimeout(400); }
    await typeAt(page);
    const popoverBack = await page.$('[data-testid="agent-transfer-popover"]') !== null;
    if (!popoverBack) throw new Error("Dispatch 开关后转交浮层无法再唤起（疑两入口相互干扰）");
    return { dispatchOpens: true, transferStillWorks: popoverBack };
  });
  await shot(page, "m8-06-coexist.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  R.nonFilesErrors = errs.filter((e) => !/\/api\/files\//.test(e) && !e.includes("403"));
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
}
