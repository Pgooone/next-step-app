# V1.2 第三轮 · TOC diff 与文档性能 —— 任务进度（progress）

> vibe-coding 第 3 步。实现 = `ns-impl` agent team 串行逐卡；lead 协调 + 门禁绿即 **chrome-devtools 真浏览器验收** + 逐卡 commit。
> 规格见 `../../../docs/V1.2/第三轮-TOC-diff与文档性能/{需求文档,概要设计,详细设计}.md`；决策 `../../../docs/V1.2/QA/第三轮-TOC-diff与文档性能决策.md`（D-V1.2-15~18）+ `../../../docs/V1.2/设计决策记录.md`（D-R3-01~08）。
> 两功能：①TOC 体现版本 diff（改动章节下方纯色细实线·绿新/黄改/红删·无圆点·留间距·删除红线暗色占位）；②大文档性能（**仅 memo 化**，实测瓶颈是 ~600ms react-markdown 重渲染、非滚动非实例数）。

## 总进度
- [x] **T0** · 性能 baseline profiling（lead chrome-devtools 已完成）→ 结论：仅 memo 化
- [x] **T1** · `lib/artifact-view/toc-diff.ts`（computeTocDiff + parseTocWithLines）+ 单测（承重墙）—— commit `8314669`
- [x] **T2** · TOC 体现版本 diff（接线 + 标记条+类型符号 + 精确归属）—— commit `42d111e`（含 T2b 决策 C/视觉乙，真浏览器验过、截图存第三轮验收截图/）
- [x] **T3** · memo 化（Markdown 提常量+React.memo / 段稳定 key / DiffBlockCard memo）—— commit `1cb923d`；ultracode 对抗式核实(GO·8agent)→agent team 实现→双层验收全 PASS（见下「T3/T4 收官」）
- [x] **T4** · 双层验收 + 文档回写 完成；**push 待用户授权**（当前 HEAD=`1cb923d`，分支 v1.2，未 push）

---

## 🔻 T3 交接（新窗口接手，2026-06-22）

**当前 HEAD = `42d111e`（分支 v1.2，未 push）**。第三轮 commit 链：`acfead3`立项 → `8314669`T1 → `42d111e`T2。T0/T1/T2 已收官，**新窗口从 T3 开始**。

**T3 要做什么**（详见 `../../../docs/V1.2/第三轮-TOC-diff与文档性能/详细设计.md` §四 + ADR `D-R3-06/07/08`）：
仅 **memo 化**（用户拍板 D-V1.2-18、实测定论），消除「内容不变时重渲染重跑 react-markdown 解析」的冗余 ~600ms：
1. `components/ArtifactPanel.tsx` 的本地 `Markdown` 组件（约 :54-70）：6 个 heading 工厂 + components 对象 + `remarkPlugins=[remarkGfm]` **提到模块级常量**（现在每次渲染都新建→废掉 react-markdown 内部 memo）；`Markdown` 包 `React.memo`（props 仅 `children:string`）。
2. `InlineDiffView`（约 :650-680）的 equal 段抽成 `React.memo` 子组件（按 text 浅比较）；map 的 `key` 从 index 改**稳定 key**（保 D-R7B-04 段顺序与 block.id 对齐、改动块增删不串位）。
3. `DiffBlockCard` 包 `React.memo`。
4. **不**虚拟化、**不**按长度降级、**不**碰 lcs.ts/聚块（D-R3-06/07）。

**性能 baseline（T0 实测，T3 对比用）**：大文档只读全文渲染 render long task ~593ms、版本 diff ~596ms（实例数非放大器、瓶颈是 react-markdown 解析全文）；滚动流畅 0 掉帧。T3 目标 = 内容不变的重渲染不再触发该 ~600ms。

**验收方式（用户拍板：走 browser-e2e、别用 chrome-devtools 大快照、见 [[next-step-browser-e2e]]）**：
- 现成 perf fixture **保留可用**：registry 项目「r3-性能验收」(`ec6be7d9`)、artifact「大型设计文档」(`6bfc5e09`) 有 v1/v2/v3（v2 是可选历史版、选 v2→v2 vs v1 行内 diff + TOC diff）。
- 跑法：`source ~/.local/bin/ns-browser-env.sh` → 写 drive.mjs（Performance API：PerformanceObserver longtask + rAF 帧间隔，触发「内容不变的重渲染」对比 long task）→ `bash .claude/skills/browser-e2e/scripts/run-e2e.sh <drive 绝对路径>`（dev 已在 30141 跑会复用）。验收脚本范例可参 `/tmp/r3-t2b-drive.mjs`。
- 红线：D-D3-10（memo 别引入新 selector）、D-R7B-04（段稳定 key 不串位）、UI/性能卡走真浏览器、`build` 非 oracle（Google Fonts 环境限制）。

**T4**：逻辑层全量 lint/test + 真浏览器复跑 → 回写本 progress + memory → push（用户授权后，push v1.2 + ff master、ls-remote 实测同步）。

**门禁现状**：lint 干净 / tsc 仅 2 个预存无关错（session-grouping/useAgentStore 的 AgentProfile.mode）/ test 406 过 + 1 已知 doctor-checks 冷缓存 flake。

**残留待清（T4 收尾）**：测试 fixture（registry 的 r3 项目 + `~/pi-cwd-20260622/r3-perf` + 物化 .md）、未跟踪的 `scripts/verify-r3-*.mts`/`scripts/r3-*.mts`、`第三轮验收截图/`（截图未入 git）。

> 门禁：`lint`/`test` 绿（`doctor-checks` 冷缓存 flake 无关）；`tsc` 仅 2 个预存无关错（AgentProfile.mode）；**build 受 Google Fonts 环境限制失败（预存非回归）**；UI/性能卡铁律走 chrome-devtools（`GET /` 200 + `pageErrors=0`）。

---

## ✅ T3/T4 收官（2026-06-23）

**当前 HEAD = `1cb923d`（分支 v1.2，未 push）**。第三轮 commit 链：`acfead3`立项 → `8314669`T1 → `42d111e`T2 → `5753727`T2订正/交接 → **`1cb923d`T3·memo 化**。

**流程**：ultracode 对抗式核实（GO_WITH_FIXES·0 blocker·8 agent，确认 7 条编辑 E1~E7 + 稳定 key 方案）→ agent team(ns-impl) 实现 → lead 亲验 diff + 独立复跑门禁 + 亲跑真浏览器双场景 + 亲读截图。

**实现（仅 `components/ArtifactPanel.tsx`，零新增 import）**：
- **Markdown**：heading 工厂 / components / remarkPlugins 提模块级常量（`makeHeading`/`MD_COMPONENTS`/`MD_REMARK_PLUGINS`）+ `React.memo`。⚠️承重点：标题 text 三分支推导 + `slugify(text)` 逐字保留在 per-render 的 H 内（不下沉模块级，否则含行内 markdown 的标题 slug 漂移→TOC 静默跳不动）。
- **InlineDiffView 段稳定 key**：`change='chg:'+block.id` / `equal='eq:'+前邻 change.id??'head'`（前向游标预计算 keys[]、与 segs 等长），取代 `key={index}`。防 DiffBlockCard 局部 busy state 随 index 复用错位泄漏、保 D-R7B-04 对齐。
- **DiffBlockCard**：`React.memo`（4 props 均稳定，resolveBlock 是 useCallback）。不另抽 EqualSegment（Markdown.memo 已覆盖，KISS）。

**双层验收全 PASS**：
- 逻辑层：lint 干净 / tsc 仅 2 个预存无关错（AgentProfile.mode）/ test 406 过 +1 已知 doctor-checks 冷缓存 flake（暖跑 9/9 通过）。
- 真浏览器·性能（longtask·删除→取消循环触发内容不变重渲染，**暖态测量、丢弃首屏编译**）：
  | 路径 | BEFORE | AFTER |
  |---|---|---|
  | 场景A 只读全文 `<Markdown>` | 16 longtask / 2754ms | **0 / 0** |
  | 场景B pending InlineDiffView（6 块+多 equal 段） | 16 longtask / 2321ms / max203 | **0 / 0**（blockCards 仍 6）|
- 真浏览器·功能零回归：TOC 跳转 + data-slug 在、版本 diff(11 块)、Diff 历史时间线展开(v3→1 块+富渲染)、pending 全屏就地 ✓ 解析（6→已确认+剩 5，**稳定 key 无 busy 泄漏**）；**pageErrors 全程 0**；lead 亲读截图 `r3-t3-timeline.png`/`r3-t3-func2.png`。

**关键经验（写给后人）**：
1. **T0「~600ms」含 dev 编译、非纯解析**：暖态单次内容不变重渲染重解析实测约 170~200ms（react-markdown v10 同步组件 `lib/index.js:175-179` 无 useMemo、每渲染重 parse）。memo 后归零。
2. **测量首跑假阴性陷阱**：未充分预热（dev 仍在后台编译）时测的循环 longtask 会异常偏低（曾测出 83ms），误导成「memo 无用」。必须先充分预热（多次重挂载/toggle）再测；longtask 判据用 `count` + `max` 数量级落差（memo 前 N×~170ms vs 后 0），别只看总和。
3. **C7 盲区**：删除→取消只读路径无 pending → 不渲 DiffBlockCard/InlineDiffView，只验 Markdown.memo。**另造 pending 单 replace fixture（场景B）**补验 InlineDiffView+DiffBlockCard+稳定 key（`scripts/r3-pending-fixture.mts`，artifact `3f4372c1`，6 mod 块）。
4. **drive 选择器坑**：「Diff 历史」工具栏 toggle 的 title「…就地展开该版…」含「展开该版」子串，`button[title*="展开该版"].first()` 会误中 toggle 把时间线关掉（假 0 块）；entry 须用 `nth(1)` 或更精确选择器。✓ 按钮 accessible name 是 `aria-label="确认此块"`（非「✓」）。
5. **React 19 click 不同步 flush**：页面内 `button.click()` 的同步耗时为 ~0（重渲染被 defer），故 perf 判据必须用 longtask 观察器、非 click 同步计时。

**残留待清（push 前/后）**：测试 fixture（registry 的 r3 项目 + pending artifact `3f4372c1` + `~/pi-cwd-20260622/r3-perf` 物化 .md）、未跟踪的 `scripts/r3-pending-fixture.mts`/`scripts/r3-*.mts`/`scripts/verify-r*.mts`、`/tmp/r3-t3-*.mjs` drives、验收截图。

> **下一步 = 用户授权后 push**（push v1.2 + ff master、ls-remote 实测四引用同步）。本轮（第三轮）two 功能（TOC diff + 文档性能）至此全部收官。

---

## T1 · toc-diff 算法 + 单测（承重墙·先行）—— AC
- [ ] 新建 `lib/artifact-view/toc-diff.ts`：`computeTocDiff(oldContent,newContent): TocDiffItem[]`（`TocDiffItem = {level,text,slug,line,diffKind:'add'|'del'|'mod'|null, side:'base'|'target'}`）
- [ ] `parseTocWithLines(content)`：复刻 `toc.ts` 的 ATX_HEADING/FENCE/slugify 扫描、每标题带 `line`；**不改原 `parseToc`**（守 `toc.test.ts:28-32/:52`）
- [ ] 算法三步（D-R3-03）：双解析拿行号 → 一趟 lcsDiff 标 baseChangedLines/targetChangedLines → 按「下一同级/更高级标题」切区间归属；产出 base/target 合并有序序列
- [ ] 对齐 key=剥离 -1/-2 后缀的 text+level；**真同名同级撞 key → 顺序配对兜底**（D-R3-04）；改名=del+add；子改动冒泡父
- [ ] **只**值导入 `lib/domain/lcs.ts`（lcsDiff/splitLines）+ `lib/artifact-view/toc.ts`（slugify 等）；`DiffBlock` 等仅 `import type`；**绝不**值导入 pending-change-service/artifact-service（D-R7B-07）
- [ ] 单测 `toc-diff.test.ts`：纯新增章/纯删除章/章内容改/标题未变/嵌套冒泡/改名拆del+add/真同名顺序配对/首版(base空)/空白行改动算改/去重后缀错位规避
- [ ] 门禁绿 + 原 `toc.test.ts` 仍全绿 + lead 亲读确认零 node 值导入 → commit

## T2 · TOC 接线 + 色线渲染（UI·真浏览器）—— AC（T1 后）
- [ ] viewingHistory 处 `tocDiff = useMemo(computeTocDiff(historyBaseContent??'', displayContent), [...])`（**不建 store selector**，D-D3-10）；传 `TocSidebar`
- [ ] `TocSidebar` 按 diffKind 给目录条加 `borderBottom: 2px solid <KIND_STYLE 色>`（add `#4ade80`/mod `#eab308`/del `#f87171`）+ `paddingBottom`/`marginBottom` 间距；**无圆点**
- [ ] `del` 条目：暗色（opacity ~0.55）+ 不可点击（无 data-slug、onClick no-op、cursor default）；`null` 未变条目同现状（零回归）
- [ ] 范围仅 viewingHistory；普通查看/pending/时间线态 TocSidebar 收到无 diff → 渲染同现状
- [ ] 点击改动/未变章节仍 querySelector data-slug 跳转；保活 TOC 现有交互
- [ ] 门禁绿 → **lead chrome-devtools 真彩色截图给用户看**（改动色线 新绿/改黄/删红 + 间距无圆点 / del 不可点 / 跳转 / 普通态零回归 / pageErrors=0）→ commit

## T3 · memo 化（性能·真浏览器 trace）—— AC（T2 后）✅ commit `1cb923d`
- [x] `Markdown`：6 heading 工厂 + components 对象 + remarkPlugins 提**模块级常量**；`Markdown` 包 `React.memo`
- [x] `InlineDiffView` 段：key 从 index 改**稳定 key**（chg:block.id / eq:前邻 change.id??head，前向游标）；**不另抽 EqualSegment**（Markdown.memo 已覆盖，KISS·dropEqualSegmentComponent）
- [x] `DiffBlockCard` 包 `React.memo`
- [x] 门禁绿 → **lead 真浏览器 longtask 对比 baseline**：内容不变重渲染 16 longtask → 0（场景A/B 双路径）；功能零回归（版本diff/timeline/pending ✓✗/TOC 跳转/稳定 key 无泄漏）；pageErrors=0 → commit

## T4 · 双层验收 + 回写 + 收官 —— AC
- [x] 逻辑层独立验证：全量 lint（干净）/ test（406 过 +1 已知 flake，暖跑通过）/ tsc（仅 2 预存无关错）
- [x] 真浏览器复跑 T3（性能 longtask 双场景 + 功能回归）+ **lead 亲 Read 截图**（timeline / func2 全屏 pending diff）
- [x] 机制层零回归：版本 diff(11块) / Diff 历史时间线(展开 v3→1块) / pending 确认链(✓→已确认+剩5) / TOC 跳转 + data-slug；pageErrors 全程 0
- [x] 回写本 progress + 勾 AC；逐卡中文 commit `1cb923d`（含根因/结构 + Co-Authored-By）
- [ ] **push（待用户授权）**；独立 `git --no-pager log` + `ls-remote` 确认落地

---

## DoD（每卡通用）
`lint + test` 绿（build 受字体环境限制不作判据）→ **lead 亲跑 chrome-devtools**（UI/性能卡铁律，不认 teammate 自证）→ `pageErrors=0` + Read 截图 → 勾 progress → 逐卡中文 commit。开工前对照 `详细设计.md` §六 风险护栏（尤其 #1 D-R7B-07 客户端边界、#2 D-D3-10 订阅、#4 不破 toc.test 契约）。
