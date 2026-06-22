# V1.2 第二轮 · 版本 diff 与历史 —— 任务进度（progress）

> vibe-coding 第 3 步。实现 = `ns-impl` agent team **串行逐卡**（每卡新队员）；lead 协调 + 门禁绿即**独立真浏览器验收** + **逐卡 commit**。
> 规格见 `../../../docs/V1.2/第二轮-版本diff与历史/{需求文档,概要设计,详细设计}.md`；决策 `../../../docs/V1.2/QA/第二轮-版本diff与历史决策.md`（D-V1.2-10~14）+ `../../../docs/V1.2/设计决策记录.md`（D-R2-01~07）。
> 两功能：①版本间行内 diff（选历史版即看该版 vs 上一版，只读无 ☑️❌）；②Diff 历史时间线（甲·铺满主体区覆盖正文、手风琴就地展开）。**零新增存储、纯只读重算、不碰红线**。

## 总进度
- [x] **T1** · 客户端安全聚块函数 `lib/artifact-view/version-diff.ts` + 单测（承重墙·先行）—— commit `9340c69`（16 单测、对照 computeReplaceDiffBlocks 一致）
- [x] **T2** · 需求1 版本间行内 diff（改 `ArtifactPanel.tsx` viewingHistory 分支）—— commit `723e532`（真浏览器 AC1/2/3/v1/全屏 PASS）
- [x] **T3** · 需求2 Diff 历史时间线（`[Diff历史]` 按钮 + 时间线视图 + 手风琴）—— commit `c71c082`（真浏览器 AC4/5/6 PASS；含 border shorthand 警告修复）
- [x] **T4** · 双层验收完成（逻辑层 lead 全量门禁 + 真浏览器 chrome-devtools 独立 E2E）；回写本进度；逐卡 commit 已落。**push 待用户授权**。

> 立项文档 commit `69bef82`。门禁：`lint` ✓ / `tsc` 仅 2 个预存无关错（session-grouping/useAgentStore 的 AgentProfile.mode、非本轮）/ `test` 384 过 + 1 已知 `doctor-checks` 冷缓存 flake（暖缓存复跑通过）/ **build 受 Google Fonts 环境限制失败（预存、非本轮回归，`app/layout.tsx` 未碰）**——build 不作判据，UI 卡走真浏览器（`GET /` 200 + `pageErrors=0`）。
>
> **真浏览器验收（chrome-devtools，lead 亲验）**：AC1 v2vs v1 行内 diff（del+mod+add，blockIds v-0/v-1/v-2）/ AC2 0 个✓/✗+无状态标（普通+全屏）/ AC3 逃生口只读全文 / v1 首版无对比基准 / AC4 时间线（rollback/apply 可辨、切换段+TOC 隐藏）/ AC5 手风琴就地回看+多次开合不崩 / AC6 30 块>25 降级并排 / pageErrors=0；既有 TOC/回滚/删除/引用零回归。验收截图 5 张存 `next-step-V1.2/../第二轮验收截图/`（git 外）。

---

## T1 · 客户端安全聚块函数（承重墙·先行）—— AC
- [ ] 新建 `lib/artifact-view/version-diff.ts`：`computeVersionDiffBlocks(oldContent, newContent): DiffBlock[]`
- [ ] 照搬 `groupOpsToBlocks`（`pending-change-service.ts:94-123`）纯算法逻辑；聚块循环与 `anchor.ts:36-49` **逐字一致**（连续 del+紧跟 add→mod / 纯 del / 纯 add）
- [ ] **只**从 `lib/domain/lcs.ts` 值导入 `lcsDiff/splitLines`；`DiffBlock` 仅 `import type`（D-R7B-07 红线，**绝不**值导入 `pending-change-service.ts`）
- [ ] block.id 用**确定性序号**（如 `${idx}`，绝不用 `node:crypto.randomUUID`）；`state` 取非 `'pending'`（如 `'confirmed'`）
- [ ] 单测 `version-diff.test.ts`：与 `computeReplaceDiffBlocks` 对同一 (old,new) 产出块 kind/lines/oldLines 序列一致（id 除外）；空内容 / 相同内容 → 空数组
- [ ] 门禁绿 + **dev 冒烟** `GET /` 200 + `pageErrors=0`（证无 node:fs 进客户端 bundle）→ lead 独立 commit

## T2 · 需求1 版本间行内 diff —— AC（T1 后开）
- [ ] 取前驱版（D-R2-04）：`store.versions[]` 按 version 升序、取选中版**前一个元素**作 base（**非**「版号-1」）；选中版作 target
- [ ] `computeVersionDiffBlocks(base, target)` → 参数化 `InlineDiffView`（接受裸 `oldContent/newContent/diffBlocks`，**不传** changeIdByBlock/resolveBlock/isFullscreen）→ equal=Markdown / change=`DiffBlockCard`
- [ ] 去 ☑️❌：靠不传 resolve 三件套，`canResolveHere`（`ArtifactPanel.tsx:551`）恒 false、状态标（:618）也不显；**零改 DiffBlockCard 内部**
- [ ] 降级护栏（D-R2-03）：按 `blocks.length > effectiveLimit` 降级 `DiffBlocksView`（复用 `INLINE_HL_LIMIT`/`FULLSCREEN_INLINE_HL_LIMIT`）
- [ ] v1（无前驱）→ 只读全文 + 「首版，无对比基准」提示
- [ ] 逃生口（D-R2-07）：「对比上一版 ⇄ 只读全文」小开关，默认对比
- [ ] 改 `viewingHistory` 分支（:387-391）；**保留** TOC / `data-block-id`(A3) / 引用到对话框 / rollback / 删除 不回归
- [ ] 门禁绿 → **lead 独立真浏览器验收**（AC1 相邻 diff / AC2 无 ✓✗ 无状态标含全屏 / AC3 逃生口 / AC6 降级 / pageErrors=0）→ commit

## T3 · 需求2 Diff 历史时间线 —— AC（T2 后开）
- [ ] 工具栏版本下拉右侧加 `[Diff历史]` toggle 按钮（常驻可见，D-R2-06），切 `store.historyMode`（瞬态标量）
- [ ] `historyMode` 时主体区渲时间线**覆盖正文**（甲，D-V1.2-14）：`store.versions[]` 倒序，每条目 `v{n} · {note} · 相对时间 · {author}`（rollback 条目 note 自带语义）
- [ ] 手风琴就地展开（D-R2-05）：点条目 → `expandedHistoryVersion`（标量）→ **懒算**该版 vs 前驱 diff（复用 T2 渲染器）就地展开、再点收起；v1 条目→无对比基准提示
- [ ] 时间线模式隐藏 `[行内│查看Diff]` 段（:347-366 加 `&& !historyMode`）；再点按钮 / 操作版本下拉 → 退出
- [ ] store 新增态全用**标量**，**禁**返回新数组/对象的派生 selector（D-D3-10）
- [ ] 门禁绿 → **lead 独立真浏览器验收**（AC4 时间线+切换段隐藏 / AC5 就地行内回看+多次开合不崩〔无限渲染回归〕/ pageErrors=0）→ commit

## T4 · 双层验收 + 收官同步 —— AC
- [ ] 逻辑层独立 verifier（自写 fixture、不认 impl 自跑）：全量 `lint`/`test` + 自写断言（version-diff 与 computeReplaceDiffBlocks 一致性、段序对齐）
- [ ] 真浏览器独立 e2e（browser-e2e skill，repo-vendored run-e2e）复跑 T2/T3 三点确定性 PASS；**lead 亲 Read 截图**
- [ ] 机制层零回归（AC7）：受管文档 propose→确认链、版本下拉/rollback/删除、TOC/A3、引用到对话框
- [ ] 回写本 progress + 勾 AC；逐卡**中文 commit**（含根因/结构，遵 `CLAUDE.md` 提交规范，结尾 `Co-Authored-By`）
- [ ] push（用户授权后）；**独立 `git --no-pager log` 确认落地**（防幻象 hash，git 写须禁沙箱）

---

## DoD（每卡通用）
`lint + test` 绿（build 受字体环境限制、不作判据）→ **lead 亲跑真浏览器**（项目红线：UI 卡必走，不认 teammate 自证）→ `pageErrors=0` + Read 截图核对 → 勾 progress → 逐卡中文 commit。每卡开工前对照 `详细设计.md` §五 风险护栏（尤其 #1 客户端边界 D-R7B-07、#3 zustand 订阅 D-D3-10）。
