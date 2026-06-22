# V1.2 第三轮 · TOC diff 与文档性能 —— 任务进度（progress）

> vibe-coding 第 3 步。实现 = `ns-impl` agent team 串行逐卡；lead 协调 + 门禁绿即 **chrome-devtools 真浏览器验收** + 逐卡 commit。
> 规格见 `../../../docs/V1.2/第三轮-TOC-diff与文档性能/{需求文档,概要设计,详细设计}.md`；决策 `../../../docs/V1.2/QA/第三轮-TOC-diff与文档性能决策.md`（D-V1.2-15~18）+ `../../../docs/V1.2/设计决策记录.md`（D-R3-01~08）。
> 两功能：①TOC 体现版本 diff（改动章节下方纯色细实线·绿新/黄改/红删·无圆点·留间距·删除红线暗色占位）；②大文档性能（**仅 memo 化**，实测瓶颈是 ~600ms react-markdown 重渲染、非滚动非实例数）。

## 总进度
- [x] **T0** · 性能 baseline profiling（lead chrome-devtools 已完成）→ 结论：仅 memo 化
- [x] **T1** · `lib/artifact-view/toc-diff.ts`（computeTocDiff + parseTocWithLines）+ 单测（承重墙）—— commit `8314669`
- [x] **T2** · TOC 体现版本 diff（接线 + 标记条+类型符号 + 精确归属）—— commit `42d111e`（含 T2b 决策 C/视觉乙，真浏览器验过、截图存第三轮验收截图/）
- [ ] **T3** · memo 化（Markdown 提常量+React.memo / 段 memo+稳定 key / DiffBlockCard memo）—— 性能卡·真浏览器 Performance API trace 对比 ← **新窗口从这里开始**
- [ ] **T4** · 双层验收 + 文档回写 + 逐卡 commit + push（用户授权后）

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

## T3 · memo 化（性能·真浏览器 trace）—— AC（T2 后）
- [ ] `Markdown`（:53-69）：6 heading 工厂 + components 对象 + remarkPlugins 提**模块级常量**；`Markdown` 包 `React.memo`
- [ ] `InlineDiffView` 段（:657-669）：equal 段抽 `React.memo` 子组件（按 text）；key 从 index 改**稳定 key**（保 D-R7B-04 段顺序对齐、改动块增删不串位）
- [ ] `DiffBlockCard` 包 `React.memo`
- [ ] 门禁绿 → **lead chrome-devtools trace 对比 baseline**：内容不变重渲染不再触发 ~600ms 重解析；功能零回归（版本diff/pending/✓✗/A3/TOC 跳转/改动块增删不串位）；pageErrors=0 → commit

## T4 · 双层验收 + 回写 + 收官 —— AC
- [ ] 逻辑层独立验证：全量 lint/test + toc-diff 自写断言（归属正确性）
- [ ] 真浏览器（chrome-devtools）复跑 T2/T3 + **lead 亲 Read 真彩色截图**（给用户确认 TOC 视觉）
- [ ] 机制层零回归：版本 diff / Diff 历史时间线 / pending 确认链 / 回滚 / 删除 / 引用 / A3 / TOC 跳转
- [ ] 回写本 progress + 勾 AC；逐卡中文 commit（含根因/结构，结尾 Co-Authored-By）
- [ ] push（用户授权后）；独立 `git --no-pager log` + `ls-remote` 确认落地

---

## DoD（每卡通用）
`lint + test` 绿（build 受字体环境限制不作判据）→ **lead 亲跑 chrome-devtools**（UI/性能卡铁律，不认 teammate 自证）→ `pageErrors=0` + Read 截图 → 勾 progress → 逐卡中文 commit。开工前对照 `详细设计.md` §六 风险护栏（尤其 #1 D-R7B-07 客户端边界、#2 D-D3-10 订阅、#4 不破 toc.test 契约）。
