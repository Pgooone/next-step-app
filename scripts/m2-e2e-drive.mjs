// M2 · chat-file-upload 真浏览器验收驱动（独立验收员自写，不信实现者自证）。
// 前置：用 ?session= 恢复一个已有 faux 会话（含历史消息），让 ChatWindow 离开欢迎态、
//       ChatInput 进入「已有会话」分支（发送走 POST /api/agent/<id>）。
// 喂文件用隐藏 <input type=file> 的 setInputFiles（内存文件，绕过系统文件对话框）。
//
// 环境变量：
//   FIXTURE = {"projectId":"...","sessionId":"...","root":"..."}（由 d4-e2e-fixture.mts 造，复用其项目+会话）
// 跑法：手动 —— eval setup-browser env → cp 到 /tmp/pw → node。
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
// 用 ?session= 恢复指定会话（cwd=项目 root），让 ChatWindow 离开欢迎态 → ChatInput 在场。
const selectSessionById = async (page, sessionId) => {
  await page.goto(`${URL}/?session=${encodeURIComponent(sessionId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(WAIT);
};

// 隐藏文件 input 选择器（ChatInput.tsx：accept=image/*,.md,... + display:none）
const FILE_INPUT = 'input[type="file"][accept*="image/"]';
// 软提示容器：黄底，文案在 span。它没 testid，用文案锚定。
const noticeText = (page) =>
  page.evaluate(() => {
    // fileNotice 渲染在 attached-text-files / image preview 之后、main input 之前，黄底 rgba(234,179,8)
    for (const div of document.querySelectorAll("div")) {
      const cs = getComputedStyle(div);
      if (!cs.backgroundColor.includes("234, 179, 8")) continue;
      const span = div.querySelector("span");
      const txt = span?.textContent?.trim();
      if (txt && (txt.includes("暂不支持") || txt.includes("大文件会消耗大量 token"))) return txt;
    }
    return null;
  });
// 找发送按钮（idle 态：文案 Send）
const sendBtn = (page) => page.locator('button:has-text("Send")').first();
// 等会话回到 idle（streaming 态按钮是 Steer/Follow-up/Stop，没有 Send）。
// faux 会话发 prompt 后约 3-4s streaming，必须等它结束再做下一个发送/检查 Send.disabled，
// 否则会误判（streaming 态本就没有 Send 钮）。
const waitIdle = async (page, timeoutMs = 15000) => {
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
// 最后一条 user 气泡文本（乐观渲染：handleSend 立即 setMessages 推 user）
const lastUserBubbleText = (page) =>
  page.evaluate(() => {
    // user 消息纯文本时 content 即字符串；它会渲染进对话区。取所有含 "<file name=" 的可见文本。
    const all = [...document.querySelectorAll("*")];
    const hits = [];
    for (const el of all) {
      // 只看直接文本节点，避免父级重复
      const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      if (direct.includes("<file name=")) hits.push(direct.trim().slice(0, 200));
    }
    return hits;
  });

const R = {};
const errs = [];
const reqBodies = []; // 抓所有发往 /api/agent/<id> 的 POST 请求体
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errs.push("pageerror:" + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console:" + m.text().slice(0, 200));
});
page.on("request", (req) => {
  const u = req.url();
  if (req.method() === "POST" && /\/api\/agent\//.test(u) && !/\/events$/.test(u)) {
    try {
      reqBodies.push({ url: u.replace(URL, ""), body: req.postData() || "" });
    } catch {
      // ignore
    }
  }
});

try {
  // 前置：恢复会话离开欢迎态
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), fx.projectId);
  await selectSessionById(page, fx.sessionId);
  R.pre = await T("前置：?session= 恢复会话 → ChatInput 在场（文件 input + 发送钮）", async () => {
    let ready = false;
    for (let i = 0; i < 12; i++) {
      ready = await page.evaluate((sel) => {
        const hasInput = !!document.querySelector(sel);
        const hasSend = [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Send");
        return hasInput && hasSend;
      }, FILE_INPUT);
      if (ready) break;
      await page.waitForTimeout(1000);
    }
    if (!ready) throw new Error("恢复会话后 ChatInput 未就绪（无文件 input 或无 Send 钮）");
    return "chatinput-ready";
  });
  await shot(page, "m2-00-session-ready.png");

  // ========================================================================
  // AC① 选并发文本类文件 → chip 出现 → 发送文本含 <file name=..>
  //   断言两条独立证据：① DOM user 气泡含 <file name= ② POST /api/agent/<id> 请求体含 <file name=
  // ========================================================================
  R.ac1_text_send = await T("AC① 选文本文件(.md/.txt) → chip 出现 + 发送文本含 <file name= (DOM气泡 + 网络请求体双证)", async () => {
    // 喂两个文本文件（内存文件）
    await page.setInputFiles(FILE_INPUT, [
      { name: "note.md", mimeType: "text/markdown", buffer: Buffer.from("# 标题\n这是 markdown 正文\n第二行") },
      { name: "data.txt", mimeType: "text/plain", buffer: Buffer.from("纯文本内容 ABC") },
    ]);
    // chip 容器出现 + 两个文件名
    await page.waitForSelector('[data-testid="attached-text-files"]', { timeout: 8000 });
    const chips = await page.evaluate(() => {
      const cont = document.querySelector('[data-testid="attached-text-files"]');
      if (!cont) return { count: 0, names: [] };
      const names = [...cont.querySelectorAll("span")].map((s) => s.textContent?.trim()).filter(Boolean);
      return { count: cont.querySelectorAll(":scope > div").length, names };
    });
    if (chips.count < 2) throw new Error("文本附件 chip 数不足 2：" + JSON.stringify(chips));
    if (!chips.names.includes("note.md") || !chips.names.includes("data.txt"))
      throw new Error("chip 未显示两文件名：" + JSON.stringify(chips.names));

    // 在正文里再敲一句（验证正文 + 附件组合）
    await page.locator("textarea").first().fill("看这两个文件");
    await page.waitForTimeout(300);

    // 记录发送前已抓到的请求数，发送后只看新增的
    const before = reqBodies.length;
    await sendBtn(page).click();
    // 轮询：等 DOM user 气泡出现含 <file name= 的文本（乐观渲染）
    let bubbles = [];
    for (let i = 0; i < 15; i++) {
      bubbles = await lastUserBubbleText(page);
      if (bubbles.length) break;
      await page.waitForTimeout(600);
    }
    if (!bubbles.length) throw new Error("发送后 DOM 中未见含 <file name= 的 user 气泡");
    // 必须匹配本次喂的两个文件名（避免会话历史里旧 <file> 气泡造成假阳性）
    const bubbleOk = bubbles.some((b) => b.includes('<file name="note.md">') && b.includes('<file name="data.txt">'));
    if (!bubbleOk) throw new Error("user 气泡文本未含本次两 <file name= 块：" + JSON.stringify(bubbles));

    // 网络请求体证据：发送后应有新 POST /api/agent/<id>，body.message 含 <file name=
    let netHit = null;
    for (let i = 0; i < 15; i++) {
      const fresh = reqBodies.slice(before);
      netHit = fresh.find((r) => r.body.includes("<file name=") || (() => {
        try { return JSON.parse(r.body)?.message?.includes("<file name="); } catch { return false; }
      })());
      if (netHit) break;
      await page.waitForTimeout(600);
    }
    if (!netHit) throw new Error("未捕获含 <file name= 的发往 /api/agent/<id> 的 POST 请求体（before=" + before + " total=" + reqBodies.length + "）");
    let parsedMsg = "";
    try { parsedMsg = JSON.parse(netHit.body)?.message ?? ""; } catch { parsedMsg = netHit.body; }
    const hasBothBlocks = parsedMsg.includes('<file name="note.md">') && parsedMsg.includes('<file name="data.txt">');
    if (!hasBothBlocks) throw new Error("请求体 message 未含两个 <file name= 块：" + parsedMsg.slice(0, 300));
    // chip 容器发送后应清空（attachments 清理）
    const cleared = await page.evaluate(() => !document.querySelector('[data-testid="attached-text-files"]'));
    // 等会话回到 idle，后续用例（喂文件 + 检查 Send.disabled）才在非 streaming 态进行
    await waitIdle(page);
    // 展示「本次」匹配气泡（数组里可能混有会话历史旧 <file> 气泡，取真正含两文件名那条）
    const matchedBubble = bubbles.find((b) => b.includes('<file name="note.md">') && b.includes('<file name="data.txt">'));
    return { chips, bubbleSample: matchedBubble?.slice(0, 120), netUrl: netHit.url, msgHead: parsedMsg.slice(0, 160), chipsClearedAfterSend: cleared };
  });
  await shot(page, "m2-01-text-attach-sent.png");

  // ========================================================================
  // AC④ 非白名单/二进制 → 黄色「暂不支持…，建议转成文本」(不静默失败)
  //   （放在 AC① 后、图片前；它不进 attachedTexts，只出提示）
  // ========================================================================
  R.ac4_unsupported = await T("AC④ 非白名单文件 → 黄色软提示「暂不支持…，建议转成文本」(不静默)", async () => {
    await page.setInputFiles(FILE_INPUT, [
      { name: "evil.exe", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]) },
    ]);
    let txt = null;
    for (let i = 0; i < 10; i++) {
      txt = await noticeText(page);
      if (txt && txt.includes("暂不支持")) break;
      await page.waitForTimeout(500);
    }
    if (!txt) throw new Error("非白名单文件未出任何软提示（疑静默失败）");
    if (!txt.includes("暂不支持") || !txt.includes("建议转成文本"))
      throw new Error("软提示文案不符「暂不支持…建议转成文本」：" + txt);
    if (!txt.includes("evil.exe")) throw new Error("软提示未点名文件 evil.exe：" + txt);
    // 不该进文本附件容器
    const noChip = await page.evaluate(() => {
      const cont = document.querySelector('[data-testid="attached-text-files"]');
      return !cont || !cont.textContent.includes("evil.exe");
    });
    if (!noChip) throw new Error("非白名单文件错误地进了文本附件容器");
    return { notice: txt };
  });
  await shot(page, "m2-02-unsupported-notice.png");

  // ========================================================================
  // AC③ >256KB 文本 → 黄色「大文件会消耗大量 token」(不阻断，仍可发)
  // ========================================================================
  R.ac3_oversize = await T("AC③ >256KB 文本文件 → 黄色软提示「大文件会消耗大量 token」(不阻断)", async () => {
    const big = "x".repeat(300 * 1024); // 300KB > 256KB 阈值
    await page.setInputFiles(FILE_INPUT, [
      { name: "huge.txt", mimeType: "text/plain", buffer: Buffer.from(big) },
    ]);
    // chip 应出现（大文件不阻断，仍作为附件）
    await page.waitForSelector('[data-testid="attached-text-files"]', { timeout: 8000 });
    const hasChip = await page.evaluate(() => {
      const cont = document.querySelector('[data-testid="attached-text-files"]');
      return !!cont && cont.textContent.includes("huge.txt");
    });
    if (!hasChip) throw new Error("大文件未作为附件 chip 加入（应不阻断）");
    let txt = null;
    for (let i = 0; i < 10; i++) {
      txt = await noticeText(page);
      if (txt && txt.includes("大文件会消耗大量 token")) break;
      await page.waitForTimeout(500);
    }
    if (!txt) throw new Error("大文件未出软提示");
    if (!txt.includes("大文件会消耗大量 token")) throw new Error("软提示文案不符「大文件会消耗大量 token」：" + txt);
    if (!txt.includes("huge.txt")) throw new Error("软提示未点名 huge.txt：" + txt);
    // 不阻断：idle 态下发送按钮应可用（hasContent=true，因有附件）。先确认 idle 排除 streaming 干扰。
    const idle = await waitIdle(page);
    if (!idle) throw new Error("等待 idle 超时，无法判定 Send 钮（疑会话卡在 streaming）");
    const canSend = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Send");
      return btn ? !btn.disabled : false;
    });
    if (!canSend) throw new Error("大文件提示阻断了发送（idle 态 Send 钮仍 disabled）");
    return { notice: txt, sendEnabled: canSend };
  });
  await shot(page, "m2-03-oversize-notice.png");

  // 清理：移除已挂载的大文件附件（点 chip 的移除钮），避免污染图片用例
  await T("清理大文件 chip（点移除钮）", async () => {
    const removeBtn = page.locator('[data-testid="attached-text-files"] button[title="移除"]').first();
    if (await removeBtn.count()) {
      await removeBtn.click();
      await page.waitForTimeout(500);
    }
    // 关掉软提示
    const closeNotice = page.locator('button[title="忽略"]').first();
    if (await closeNotice.count()) await closeNotice.click();
    return "cleared";
  });

  // ========================================================================
  // AC② 图片上传不受影响：喂图片 → 图片预览出现，且不进 attached-text-files
  // ========================================================================
  R.ac2_image = await T("AC② 图片上传不受影响（图片预览出现，且不进文本附件容器）", async () => {
    // 一个最小合法 PNG（1x1 透明）
    const pngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await page.setInputFiles(FILE_INPUT, [
      { name: "pixel.png", mimeType: "image/png", buffer: Buffer.from(pngB64, "base64") },
    ]);
    // 图片预览：ChatInput 里 <img> 带 objectFit:cover、56x56；用 src^=blob: 锚定
    let imgOk = false;
    for (let i = 0; i < 10; i++) {
      imgOk = await page.evaluate(() => {
        return [...document.querySelectorAll("img")].some((im) => (im.getAttribute("src") || "").startsWith("blob:"));
      });
      if (imgOk) break;
      await page.waitForTimeout(500);
    }
    if (!imgOk) throw new Error("图片上传后未见 blob: 预览图（图片通道受影响）");
    // 图片不该进文本附件容器
    const notInText = await page.evaluate(() => {
      const cont = document.querySelector('[data-testid="attached-text-files"]');
      return !cont || !cont.textContent.includes("pixel.png");
    });
    if (!notInText) throw new Error("图片错误地进了文本附件容器");
    return { imgPreview: imgOk, notInTextContainer: notInText };
  });
  await shot(page, "m2-04-image-preview.png");
} catch (e) {
  log("FATAL", String(e.stack || e));
} finally {
  R.pageErrors = errs;
  R.capturedAgentPosts = reqBodies.length;
  await browser.close();
}

// ========================================================================
// 附加 AC：仅文本附件（无正文）也可发送 —— 在主 browser 关闭后用「独占的全新 browser」跑。
// 关键：必须用一个【与主流程不同、从未被主流程发送污染过】的会话（FIXTURE2_SESSION）。
// 主流程 AC① 已往 fx.sessionId 里发过消息写进了历史，复用它会让 faux 引擎在恢复时
// 重放这些历史（实测稳定产生 5 个 POST 且全程 streaming），把 only.md 发送时机冲掉——
// 与「仅附件可发送」功能无关，纯属会话历史回放的测试时序坑。
// ========================================================================
{
  const session2 = process.env.FIXTURE2_SESSION;
  const browser2 = await launch();
  const page2 = await browser2.newPage({ viewport: { width: 1400, height: 900 } });
  const errs2 = [];
  const posts2 = [];
  page2.on("pageerror", (e) => errs2.push("pageerror:" + e.message));
  page2.on("console", (m) => { if (m.type() === "error") errs2.push("console:" + m.text().slice(0, 200)); });
  page2.on("request", (req) => {
    const u = req.url();
    if (req.method() === "POST" && /\/api\/agent\//.test(u) && !/\/events$/.test(u)) posts2.push(req.postData() || "");
  });
  R.acx_textonly_send = await T("附加 仅文本附件(无正文)也可发送 → 发出文本即纯 <file name= 块（独占 browser + 专属未污染会话）", async () => {
    if (!session2) throw new Error("缺 FIXTURE2_SESSION（附加 AC 需专属未污染会话）");
    await page2.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.evaluate((i) => localStorage.setItem("next-step:current-project-id", i), fx.projectId);
    await page2.goto(`${URL}/?session=${encodeURIComponent(session2)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForTimeout(WAIT);
    const idle0 = await waitIdle(page2);
    if (!idle0) throw new Error("独占 browser 恢复会话后等 idle 超时");
    await page2.locator("textarea").first().fill(""); // 确保正文空
    await page2.setInputFiles(FILE_INPUT, [
      { name: "only.md", mimeType: "text/markdown", buffer: Buffer.from("仅附件无正文") },
    ]);
    await page2.waitForSelector('[data-testid="attached-text-files"]', { timeout: 8000 });
    // chip DOM 出现 ≠ React state 已落定：handleSend 闭包读的是 attachedTexts state，
    // 喂文件后须给 setAttachedTexts 时间提交，否则点击时闭包里附件仍为空 → handleSend 早 return 不发。
    await page2.waitForTimeout(1200);
    const canSend = await page2.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Send");
      return btn ? !btn.disabled : false;
    });
    if (!canSend) throw new Error("仅文本附件（无正文）时 idle 态 Send 钮仍被禁用");
    await page2.locator('button:has-text("Send")').first().click();
    // 证据用「乐观渲染的 user 气泡」（handleSend 第一步即 setMessages 推 user，最可靠，
    // 不依赖网络请求捕获时序——后者在独占 browser+close 编排下有竞态）。
    // 这是全新干净会话（user=1），历史里只有占位首问、绝无 <file> 块，故气泡含 only.md 即本次发送。
    let bubbleMsg = null;
    for (let i = 0; i < 15; i++) {
      bubbleMsg = await page2.evaluate(() => {
        for (const el of document.querySelectorAll("*")) {
          const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
          if (direct.includes('<file name="only.md">')) return direct.trim();
        }
        return null;
      });
      if (bubbleMsg) break;
      await page2.waitForTimeout(500);
    }
    if (!bubbleMsg) throw new Error("仅附件发送后 DOM 未见含 only.md 的 user 气泡（疑发送被吞）");
    // 纯附件：气泡文本应以 <file name="only.md"> 开头（无正文前缀）
    if (!bubbleMsg.startsWith('<file name="only.md">'))
      throw new Error("纯附件气泡未以 <file 块开头（疑混入空正文分隔）：" + bubbleMsg.slice(0, 120));
    // 旁证：网络若也捕到则一并报（容竞态，不作硬断言）
    const netAlso = posts2.some((b) => b.includes('<file name="only.md">'));
    await shot(page2, "m2-05-textonly-sent.png");
    return { sendEnabled: canSend, bubbleHead: bubbleMsg.slice(0, 80), netAlsoCaptured: netAlso };
  });
  R.pageErrors2 = errs2;
  await browser2.close();
}

log("RESULT_JSON " + JSON.stringify(R));
