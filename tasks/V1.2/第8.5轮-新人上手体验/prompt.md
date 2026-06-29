# 第 8.5 轮 · 监工起始指令 / 新窗口续做交接（读它即可接着做）

> 自包含。新窗口打开后**读这一份**就能接上：现状 → 承重前提 → 批次 → 验收纪律 → 收官。

## 0. 怎么接上（30 秒）

- **这是什么**：V1.2「第 8.5 轮·新人上手体验」——承接「模拟新用户实测 v2」的 C/N 困惑，是卡在第八与第九轮之间的**半轮**（不抢第九轮 pipeline 查缺补漏的位）。
- **设计已定稿**（走完 brainstorm + 可视化伴侣逐屏迭代、用户逐项拍板）：
  - 权威 spec：[`../../docs/V1.2/第8.5轮-新人上手体验/前端设计.md`](../../docs/V1.2/第8.5轮-新人上手体验/前端设计.md)（5 块设计 + 验收 + 任务卡）。
  - 台账/决策：`台账-新人体验.md` §2 / §2.2（用户拍板 D-V1.2-51~63）。
  - 设计稿留痕（行为基准、不入 git）：`Next-Step/.superpowers/brainstorm/9395-*/content/*.html`。
- **任务卡**：本目录 `T1`~`T5` + `progress.md`。
- **环境**：dev 跑 `:30141`（真应用验收用）；可视化伴侣 `:58888`（设计期产物，实现期可关）。
- **状态**：设计定稿 → ultracode 审计订正（`GO_WITH_FIXES`，2 承重 blocker〔均 T1〕+4 major 逐条订正、剔 9 over-claim）→ 用户批准 → **✅ 批次 1 主体 T2/T3/T4 全收官 + push**：agent team 串行 + lead 双层验收（亲读 diff/复跑门禁/独立逻辑复核/真浏览器亲看截图），T2 `47a46ac` 流水线 UI / T4 `4ad9764` 文案中文化 / T3 `2dc4b71` 入口+建项目，含回写共 9 commit `bca110f`→`cc76b64`，**已 ff master、ls-remote 实测 origin/v1.2=origin/master=本地=`cc76b64` 四引用全同步**。决策 D-V1.2-64~70、ADR D-R8.5-01~11。
- **⏸ 剩余待续（用户拍板 D-V1.2-70）**：**T5 深色 shader 首页·试点**（prep 已 recon 就绪：shader 移植设计稿原生 WebGL 零依赖、字体取舍 D-V1.2-69 自托管标题+正文 CJK 系统回退、fontTools 已装、gstatic `--noproxy` 实测可下 woff2）+ **T1 首用引导 Tour·批次2**（先做 §0 两模态 `initial*` 承重改造 + mini-spike）。**👉 当前状态 / 每卡续做点以 [`progress.md`](progress.md) 为准**（读它 + 对应任务卡 + 前端设计 §1/§6 即可接上）。
- **T1 承重前提订正（重要）**：原设计假定深度轨 `before()` 能「调模态 open/setView」**实则不存在**（两模态 view 是内部 useState）→ T1 §0 新增「两模态加 `initial*` props / 上提 tour 编排 state」承重改造 + mini-spike 先行；深度轨步 4/5/6 在新用户空环境改「锚恒在元素 + 降级文案」（不锚 run 态元素）。详 `前端设计.md` §1 订正。

## 1. 角色与目标

你是**监工 Agent**：不亲自写业务代码，只负责按批次派 agent team 子 Agent（`subagent_type` 选型、`name` 可寻址、**本机须显式 `model:'opus'`**）实现各任务卡，每卡亲读真实 diff + 复跑门禁 + 双层验收后才 commit，更新 `progress.md`。多 Agent 纪律见 `cc-multi-agent-dev-flow` skill。

## 2. 承重前提（已评估：本轮无需独立 ultracode 承重 spike）

本轮以**前端打磨**为主，设计命门**不**系于任何「某信号恒成立 / 唯一触发点 / 原子有序」的研究继承假设，故**不立单独承重 spike**。唯一偏重的是 **T1 Tour 深度轨**——它假设「能在 Tour 里以编程方式打开 Agents/Pipeline 真模态并高亮其内部元素、且目标元素有稳定锚点」。处置：**在 T1 内部先做 mini-spike**（先打通「overlay 开真模态 + `data-tour-id` 稳定锚点 + spotlight 定位」一条最小链路，绿了再铺全 11 步），而非纸面假设直接全做。

## 3. 开发批次（被依赖的先做）

> 关键依赖：T1 Tour 的总览/深度轨要**高亮** Agents/Pipeline 入口与模态内部，而 T2(流水线 UI)、T3(入口提权) 正在改这些元素 → **T1 放最后**，避免锚到被改动的元素返工。

- **批次 1（互独立、可并行）**：
  - **T2** 流水线 UI（N1/N2/**N3**/N4，含 hover 闪烁修〔真根因订正〕+ N3 自动刷新补回）
  - **T3** 入口 C3 + 建项目 C1（C1 带后端，唯一需逻辑层单测）
  - **T4** 文案中文化（C2/C12 打字机 / C7 / C11 / C14）
  - **T5** 炫酷深色首页（shader + 字体 B 自托管 + 护栏，独立新依赖）
- **批次 2**：
  - **T1** 首用引导 Tour（tentpole；等批次 1 把入口/模态改稳后再锚；内含 anchors mini-spike）

## 4. 质量门禁（每卡，全绿才 commit）

```bash
cd next-step-V1.2
npm run lint && npm run test && npx tsc --noEmit
```
每卡**单独 commit**（门禁绿即提交，细粒度可回退）。

## 5. 双层验收（缺一不可）

1. **逻辑层**：独立 verifier 子 Agent 自写 fixture/断言复跑——**不认实现 Agent 自跑的测试**。本轮主要是 **T3 的 C1 后端**（createIfMissing 分支：不存在+勾选→建目录放行 / 不勾→维持报错 / 改路径同覆盖）。
2. **端到端层**：**所有 UI 卡走真浏览器**（`:30141` 真应用，非仿样），判据确定性 + `pageErrors=0`、lead 亲看截图。逐卡 AC 见各任务卡。
   - ⚠️ **字体 B（中文 webfont）与 shader 必须真机验**：容器 headless 取不到 Google 中文字体、WebGL 走软件渲染——以你的真 Chrome 为准。

## 6. lead 铁律

- 不信 Agent 自证；**承重处 lead 亲 `file:line` 复核**；**进度只认 `git status/log`**，不认 idle/「我做完了」。
- **每卡单独 commit**；决策留痕（用户拍板记台账 QA；lead 实现级取舍记 `设计决策记录.md` D-R8.5-01~）。
- 红线（别破）：N2 **不改 hover/click 交互**（方案 A）；C1 **只在用户勾选时才 mkdir**（守「删项目不删盘」）；字体 **禁 `next/font/google`**（用自托管 `next/font/local`）；C5 不在本轮（归第九轮 D1）、C4 不做。

## 7. 收官

5 卡全绿 + 双层验收过 → 回写 `台账-新人体验.md`「实际处置」列 + 更新 `docs/V1.2/README.md` 状态 + （待用户授权）push。设计期可视化伴侣 `:58888` 可停（`stop-server.sh`，产物留 `.superpowers/`）。

---
> 注：本轮 spec 是单份轻设计（`前端设计.md`，非 proposal/high-level/detailed 三件套）——查缺补漏式收尾轮，台账 §5 已说明可合并。需求源是 `模拟新用户实测/` 的 C/N + 台账圈定。
