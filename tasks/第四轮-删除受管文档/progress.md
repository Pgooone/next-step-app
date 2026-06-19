# 第四轮进度（删除受管文档）

> vibe-coding 任务跟踪。规格真相源：`../../docs/第四轮-删除受管文档/详细设计.md` + QA `../../docs/QA/开发/删除受管文档决策.md`。
> 每完成一卡：勾选 → 按详设 §七验收自检 → 过门禁 → 更新区 README → 回写本页 → 单独 commit。
> 用户拍板：**A1 彻底删除（侧车+磁盘 .md 双删）/ B2 两处入口（ArtifactPanel 头部 + 受管分组行垃圾桶）/ C1 仅用户可删**。

## 批次进度（串行）
- [x] T1 · 后端删除（deleteArtifact + DELETE 路由 + 单测）—— +7 单测、test 336
- [x] T2 · 前端入口与二次确认（store.delete + 两处入口 + 刷新接线）—— 待 T3 真浏览器坐实
- [x] T3 · 真浏览器验收 + 机制层零回归 —— 真浏览器 4 断言全 PASS、pageErrors=0

## 关键约束（实现必看）
- **删除 = 结构操作、豁免「propose→按块确认」红线**（D-V4-02，那条红线管内容修改）；与 createArtifact 对称、只新增、不动既有三写方法/侧车格式/提议工具。
- 彻底删 = `rmSync` 侧车目录（meta+versions+pending）+ 容错删物化 .md（best-effort，D-V4-03）。
- 带 If-Match 乐观锁（D-V4-04）；删的若正打开 → close()。
- 两入口接同一 `store.delete` + 同一二次确认范式。
- 真浏览器 fixture 项目根须放 `~/pi-cwd-<date>/`（文件 API 允许根）、断言前轮询等树就绪。

## 本期不做（登记）
删除撤销/回收站；AI 删除（C1，如需走「提议→确认」另立项）；入口②删非当前打开项的 If-Match（可先不带）；普通 .md 手动转受管（仍后置）。

## 验收结论（T3，2026-06-20）
真浏览器（repo-vendored browser-e2e）+ 机制层零回归，全部通过。fixture 复用 `scripts/v3-e2e-fixture.mts`，drive = `scripts/v4-e2e-drive.mjs`。

- **真浏览器 4 断言全 PASS、pageErrors=0**：①删除入口可见（ArtifactPanel 头部按钮 + 受管分组行 hover 垃圾桶）②点删除→两步确认、不立即删、取消→文档仍在 ③入口②行垃圾桶删他项 artPend（artClean 仍打开）→ artPend 没了、artClean 右栏不误清（close 守卫生效）④入口①删当前打开的 artClean → 后端删除（分组重取后消失）+ 磁盘 .md 删除（**树证**：删后该 artifact 不再被去重隐藏，同一 bump 触发普通树重取，.md 仍不重现普通树 = 已从磁盘删、非降级）+ 右栏退回 FileViewer/空 + 分组空。
- **机制层零回归**：artifact-service(49 含 +7 删除单测)/pending-change-service/doc-tools 共 94 tests 全绿；`npm run test` 336 / tsc 0 / lint 0。
- **验收要点（写给后人）**：①验「已删」改用 **DOM/树证明**而非 fetch 探测已删资源——后者浏览器会把 4xx 记成 console error 污染 pageErrors（探针 4 条 404 全是测试自身造的、非 app 错，已规避）。②入口①刷新走 explorerRefreshKey bump 异步链，断言须**轮询**等分组/右栏更新（定长 wait 不够，曾假失败「分组应空实为 1」）。③中栏 PendingChangeCard 删后消失需会话上下文（同 V3 AC⑨ Tier2 约束）本轮未在浏览器复跑；删带 pending 文档时 pending 随侧车一并清已由 T1 unit「带 pending 删后 pending 目录清」直证。
