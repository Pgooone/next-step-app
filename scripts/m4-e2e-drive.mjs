// M4 · AgentManager 玻璃卡片重写 真浏览器验收驱动（独立验收员自写，不信实现者自证）。
// 单 browser / 单 page（内存友好，本机 3.4G 无 swap）。自建临时项目走 API，UI 走新 testid。
//
// 新交互：卡片网格(agent-item) → 点整卡弹 agent-menu 浮层（起会话/配置/删除三段）；
//        旧 agent-edit-btn/agent-start-btn 已移除；thinking 是按钮组(data-thinking/data-selected)。
// 跑法：eval setup-browser env → cp 到 /tmp/pw → node。
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
const selectProject = async (page, id) => {
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WAIT);
};
// 打开 AgentManager（底部工具栏 Agents 按钮 → open-agents-btn；需已选项目才 enable）
const openManager = async (page) => {
  await page.waitForSelector('[data-testid="open-agents-btn"]', { timeout: 10000 });
  await page.click('[data-testid="open-agents-btn"]');
  await page.waitForSelector('[data-testid="agent-manager"]', { timeout: 8000 });
};
// 在「新建表单」里建一个 agent（agent-new-btn → 填 name → agent-save-btn）
const createAgent = async (page, name) => {
  await page.click('[data-testid="agent-new-btn"]');
  await page.waitForSelector('[data-testid="agent-form-name"]', { timeout: 8000 });
  await page.fill('[data-testid="agent-form-name"]', name);
  await page.click('[data-testid="agent-save-btn"]');
  // 建完回网格，等该名字的卡出现
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('[data-testid="agent-item"]')].some((c) => c.getAttribute("data-agent-name") === n),
    name,
    { timeout: 10000 },
  );
};
// 点某名字的卡 → 弹 agent-menu
const openCardMenu = async (page, name) => {
  await page.click(`[data-testid="agent-item"][data-agent-name="${name}"]`);
  await page.waitForSelector('[data-testid="agent-menu"]', { timeout: 8000 });
};
// 读菜单里 thinking 当前选中值（data-selected="true" 的按钮的 data-thinking）
const readThinking = (page) =>
  page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-testid="agent-form-thinking"]')];
    const sel = btns.find((b) => b.getAttribute("data-selected") === "true");
    return { selected: sel ? sel.getAttribute("data-thinking") : null, count: btns.length };
  });

const R = {};
const errs = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "m4-e2e-"));
const proj = await (await api("POST", "/api/projects", { name: "M4-验收", root })).json();
log("临时项目", proj.id, root);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200)); });

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await selectProject(page, proj.id);
  await openManager(page);
  await shot(page, "m4-00-manager-open.png");

  // ========================================================================
  // AC8(部分) + 前置：agent-manager / agent-new-btn 在
  // ========================================================================
  R.ac8_base_testids = await T("AC8 基础 testid：agent-manager + agent-new-btn 在", async () => {
    const probe = await page.evaluate(() => ({
      manager: !!document.querySelector('[data-testid="agent-manager"]'),
      newBtn: !!document.querySelector('[data-testid="agent-new-btn"]'),
    }));
    if (!probe.manager) throw new Error("无 agent-manager");
    if (!probe.newBtn) throw new Error("无 agent-new-btn(+卡)");
    return probe;
  });

  // ========================================================================
  // AC6 新建：点 +卡 → 表单 → 创建成功、新卡出现在网格（建 2 个：A 用于配置/起会话，B 用于删除）
  // ========================================================================
  const AGENT_A = "验收档案甲";
  const AGENT_B = "验收档案乙";
  R.ac6_create = await T("AC6 新建 agent（+卡→表单→创建，新卡入网格）", async () => {
    await createAgent(page, AGENT_A);
    await createAgent(page, AGENT_B);
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="agent-item"]')].map((c) => c.getAttribute("data-agent-name")),
    );
    if (!names.includes(AGENT_A) || !names.includes(AGENT_B))
      throw new Error("新建后网格缺卡：" + JSON.stringify(names));
    // 落盘核验：.pi/agents 下应有两个档案目录
    const dirs = (() => {
      try { return fs.readdirSync(path.join(root, ".pi", "agents")).filter((n) => {
        try { return fs.statSync(path.join(root, ".pi", "agents", n)).isDirectory(); } catch { return false; }
      }); } catch { return []; }
    })();
    return { names, diskDirs: dirs.length };
  });
  await shot(page, "m4-01-grid-after-create.png");

  // ========================================================================
  // AC1 卡片是正方形玻璃卡（glass-card + aspectRatio:1 + 首字母色块 + 真名）
  // ========================================================================
  R.ac1_glass_card = await T("AC1 agents 呈正方形玻璃卡片网格（glass-card+方形+首字母色块+真名）", async () => {
    const probe = await page.evaluate((nameA) => {
      const card = [...document.querySelectorAll('[data-testid="agent-item"]')].find(
        (c) => c.getAttribute("data-agent-name") === nameA,
      );
      if (!card) return { found: false };
      const cs = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const isGlass = card.classList.contains("glass-card");
      // 近似正方形（aspectRatio:1）
      const squareish = Math.abs(rect.width - rect.height) / Math.max(rect.width, rect.height) < 0.15;
      // 首字母色块：卡内有个带背景色的小方块，含一个字符
      const initialBlock = [...card.querySelectorAll("div")].find((d) => {
        const t = d.textContent?.trim();
        const dcs = getComputedStyle(d);
        return t && t.length <= 2 && dcs.borderRadius !== "0px" && dcs.backgroundColor !== "rgba(0, 0, 0, 0)";
      });
      const showsName = card.textContent.includes(nameA);
      return { found: true, isGlass, squareish, w: Math.round(rect.width), h: Math.round(rect.height), hasInitialBlock: !!initialBlock, showsName, blur: cs.backdropFilter };
    }, AGENT_A);
    if (!probe.found) throw new Error("找不到卡片");
    if (!probe.isGlass) throw new Error("卡片无 glass-card 类");
    if (!probe.squareish) throw new Error(`卡片非正方形 w=${probe.w} h=${probe.h}`);
    if (!probe.hasInitialBlock) throw new Error("卡片无首字母色块");
    if (!probe.showsName) throw new Error("卡片未显真名");
    return probe;
  });

  // ========================================================================
  // AC2 点卡 → 弹 agent-menu，含三段：起会话 / 配置 / 删除
  // ========================================================================
  R.ac2_menu = await T("AC2 点卡(agent-item)→弹 agent-menu 浮层（起会话/配置/删除三段）", async () => {
    await openCardMenu(page, AGENT_A);
    const probe = await page.evaluate(() => {
      const menu = document.querySelector('[data-testid="agent-menu"]');
      if (!menu) return { found: false };
      const txt = menu.textContent || "";
      return {
        found: true,
        hasStart: !!menu.querySelector('[data-testid="agent-start-input"]') && txt.includes("起会话"),
        hasConfig: !!menu.querySelector('[data-testid="agent-save-btn"]') && txt.includes("配置"),
        hasDelete: !!menu.querySelector('[data-testid="agent-delete-btn"]'),
      };
    });
    if (!probe.found) throw new Error("点卡后无 agent-menu");
    if (!probe.hasStart) throw new Error("菜单缺起会话段");
    if (!probe.hasConfig) throw new Error("菜单缺配置段");
    if (!probe.hasDelete) throw new Error("菜单缺删除段");
    return probe;
  });
  await shot(page, "m4-02-menu-popover.png");

  // ========================================================================
  // AC8 新 testid：agent-menu + agent-back-btn 在；AC4 无 agent-edit-btn
  // ========================================================================
  R.ac8_new_testids = await T("AC8 新 testid agent-menu + agent-back-btn 在 / AC4 无 agent-edit-btn", async () => {
    const probe = await page.evaluate(() => ({
      menu: !!document.querySelector('[data-testid="agent-menu"]'),
      backBtn: !!document.querySelector('[data-testid="agent-back-btn"]'),
      editBtn: !!document.querySelector('[data-testid="agent-edit-btn"]'),
      startBtnOld: !!document.querySelector('[data-testid="agent-start-btn"]'),
    }));
    if (!probe.menu) throw new Error("无 agent-menu");
    if (!probe.backBtn) throw new Error("无 agent-back-btn");
    if (probe.editBtn) throw new Error("AC4 违反：agent-edit-btn 仍存在");
    if (probe.startBtnOld) throw new Error("旧 agent-start-btn 仍存在（应已移除）");
    return probe;
  });

  // ========================================================================
  // AC3【核心】配置现场改并保存生效：改 thinking → 保存 → 重开菜单确认持久
  // ========================================================================
  R.ac3_persist = await T("AC3【核心】菜单改 thinking→保存(agent-save-btn)→重开该卡菜单确认持久(走 update→后端)", async () => {
    // 当前在 AGENT_A 菜单。读初始 thinking
    const before = await readThinking(page);
    if (before.count < 2) throw new Error("thinking 选项按钮不足：" + JSON.stringify(before));
    // 选一个与当前不同的目标值
    const target = before.selected === "high" ? "low" : "high";
    await page.click(`[data-testid="agent-form-thinking"][data-thinking="${target}"]`);
    await page.waitForTimeout(300);
    const afterClick = await readThinking(page);
    if (afterClick.selected !== target) throw new Error(`点击后未选中目标 thinking=${target}，实际=${afterClick.selected}`);
    // 保存 → handleUpdate → update(PATCH)→refresh→backToList（自动回网格）
    await page.click('[data-testid="agent-save-btn"]');
    // 等回到网格（agent-menu 消失、agent-item 重现）
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="agent-menu"]') && document.querySelector('[data-testid="agent-item"]'),
      { timeout: 10000 },
    );
    await page.waitForTimeout(800);
    // 重新打开该卡菜单，读 thinking 是否为新值（证明持久化到后端、refresh 后重读）
    await openCardMenu(page, AGENT_A);
    const reopened = await readThinking(page);
    if (reopened.selected !== target)
      throw new Error(`重开菜单 thinking 未持久：期望 ${target}，实际 ${reopened.selected}（疑只接受输入未走 update→后端）`);
    // 旁证：直接查后端 GET，确认落盘
    const list = await (await api("GET", `/api/projects/${proj.id}/agents`)).json().catch(() => null);
    let backendThinking = null;
    if (Array.isArray(list)) {
      const a = list.find((x) => x.name === AGENT_A);
      backendThinking = a ? a.thinkingLevel : null;
    }
    return { before: before.selected, target, afterReopen: reopened.selected, backendThinking };
  });
  await shot(page, "m4-03-config-persisted.png");

  // ========================================================================
  // AC5(起会话) 菜单里 agent-start-input + agent-start-submit 可用
  //   （只验输入可填 + 提交钮存在；真起会话会切走/关管理器，故只验控件就绪不实际提交，避免破坏后续断言）
  // ========================================================================
  R.ac5_start = await T("AC5 菜单起会话控件可用（agent-start-input 可填 + agent-start-submit 存在）", async () => {
    // 当前在 AGENT_A 菜单
    await page.fill('[data-testid="agent-start-input"]', "你好，开始第一条消息");
    const probe = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="agent-start-input"]');
      const submit = document.querySelector('[data-testid="agent-start-submit"]');
      return {
        inputVal: input ? input.value : null,
        submitExists: !!submit,
        submitDisabled: submit ? submit.disabled : true,
      };
    });
    if (probe.inputVal !== "你好，开始第一条消息") throw new Error("起会话输入框不可填");
    if (!probe.submitExists) throw new Error("无 agent-start-submit");
    if (probe.submitDisabled) throw new Error("有输入后起会话提交钮仍禁用");
    // 清掉输入，避免误触发
    await page.fill('[data-testid="agent-start-input"]', "");
    return probe;
  });

  // ========================================================================
  // AC5(删除) 菜单里 agent-delete-btn → agent-delete-confirm（显真名），对 AGENT_B 实测删除
  // ========================================================================
  R.ac5_delete = await T("AC5 删除 agent-delete-btn→agent-delete-confirm(显真名)→卡消失", async () => {
    // 先回网格再开 AGENT_B 菜单（当前在 AGENT_A 菜单）
    await page.click('[data-testid="agent-back-btn"]');
    await page.waitForSelector('[data-testid="agent-item"]', { timeout: 8000 });
    await openCardMenu(page, AGENT_B);
    // 点删除 → 出二次确认
    await page.click('[data-testid="agent-delete-btn"]');
    await page.waitForSelector('[data-testid="agent-delete-confirm"]', { timeout: 6000 });
    // 确认文案显真名
    const confirmShowsName = await page.evaluate((nameB) => {
      const menu = document.querySelector('[data-testid="agent-menu"]');
      return menu ? menu.textContent.includes(nameB) : false;
    }, AGENT_B);
    if (!confirmShowsName) throw new Error("删除二次确认未显真名 " + AGENT_B);
    // 确认删除 → 回网格、该卡消失
    await page.click('[data-testid="agent-delete-confirm"]');
    await page.waitForFunction(
      (nameB) =>
        !document.querySelector('[data-testid="agent-menu"]') &&
        ![...document.querySelectorAll('[data-testid="agent-item"]')].some((c) => c.getAttribute("data-agent-name") === nameB),
      AGENT_B,
      { timeout: 10000 },
    );
    const remain = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="agent-item"]')].map((c) => c.getAttribute("data-agent-name")),
    );
    if (remain.includes(AGENT_B)) throw new Error("删除后 " + AGENT_B + " 卡仍在");
    return { confirmShowsName, remainNames: remain };
  });
  await shot(page, "m4-04-after-delete.png");

  // ========================================================================
  // AC7 深/浅色玻璃卡均可读（切 theme，截两张图肉眼核对；断言卡片在两模式下都可见且有文字色对比）
  // ========================================================================
  R.ac7_theme = await T("AC7 深/浅色模式玻璃卡均可读（切 theme 后卡片仍渲染且名字可见）", async () => {
    // 读当前 theme 下卡片可读性
    const readAt = async () => page.evaluate((nameA) => {
      const card = [...document.querySelectorAll('[data-testid="agent-item"]')].find(
        (c) => c.getAttribute("data-agent-name") === nameA,
      );
      if (!card) return null;
      const nameEl = [...card.querySelectorAll("div")].find((d) => d.textContent?.trim() === nameA);
      return { visible: !!card.offsetParent || card.getClientRects().length > 0, nameColor: nameEl ? getComputedStyle(nameEl).color : null };
    }, AGENT_A);
    const cur = await readAt();
    await shot(page, "m4-05-theme-A.png");
    // 切 theme：找主题切换钮（title 含 切换/主题/dark/light，或 data-testid theme-toggle）。
    const toggled = await page.evaluate(() => {
      const cand = [...document.querySelectorAll("button")].find((b) => {
        const t = (b.getAttribute("title") || "") + (b.getAttribute("aria-label") || "");
        return /主题|theme|dark|light|深色|浅色/i.test(t);
      });
      if (cand) { cand.click(); return true; }
      return false;
    });
    await page.waitForTimeout(1200);
    const after = toggled ? await readAt() : null;
    await shot(page, "m4-06-theme-B.png");
    if (!cur || !cur.visible) throw new Error("当前模式卡片不可见");
    if (toggled && (!after || !after.visible)) throw new Error("切 theme 后卡片不可见");
    return { themeA: cur, toggled, themeB: after };
  });
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  log("RESULT_JSON " + JSON.stringify(R));
  await browser.close();
  // 清理：删测试项目注册 + 临时目录（含 .pi/agents 落盘）
  await api("DELETE", "/api/projects/" + proj.id).catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
}
