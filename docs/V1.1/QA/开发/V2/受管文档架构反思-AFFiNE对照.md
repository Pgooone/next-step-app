# V2 架构反思 · 「受管文档」去留 与 AFFiNE 对照（增量记录）

> 本文件**增量记录** V2 阶段关于「产物 diff / 按块确认」核心架构的讨论与决策；后续对话续记于此（按轮次追加）。
> 对照源：同目录上级 `../AFFiNE Diff 实现源码解析 · 与 Next-Step Iter D（v2）对照 …md`。
> 状态：**讨论中**（方向已逐渐清晰，最终方案待用户拍板）。

---

## 轮次 1（2026-06-18）

### 缘起
- P0 档位1（profile 会话接 artifact-guard）收官 + push + ff 并入 master（`3b4fe5f`）。
- 用户质疑「给每条对话路（profile / 主对话 / 派发 / idle）逐路装 guard」的做法：能否**最小改动、覆盖所有路、更通用**？类似 Notion——对话是对话，对话产物变文档、自带 diff。
- 用户加入 AFFiNE 源码对照文档。其核心揭示：**AFFiNE 的保护在「文档管道」、不在「对话」**——AI 用 `doc_edit` 工具吐"原文+新文"内容、固定代码 `diffMarkdown` 算 diff、`applyPatchToDoc` 落盘，**与"AI 怎么被调起"无关**。

### 用户三问 + lead 分析

**Q1 ·「受管文档」概念是否过于狭隘/无通用性/徒增复杂度？去掉有何问题、要改哪？**
- **要分「概念」与「实现」**：
  - **概念**（可审阅的「产物/文档」实体 + diff/版本/按块确认）= **北极星灵魂，保留**（AFFiNE 同样有"文档"这个单元）。
  - **实现里狭隘/复杂的是 guard 拦截层**：`artifact-guard.ts` + `artifact-intercept.ts`（resolveManagedTarget）+ P0 wire，本质是"按路拦截 agent 写一个魔法文件路径" + "managed vs 普通文件"两层。**这部分该换掉**。
  - 换成 AFFiNE 式**「提议工具」**：agent 调 `propose_edit(id, 新内容)`、返回内容、**永不直接写盘** → 真正写文档的只有"接受"那步固定代码。**主对话/idle/派发 gap 结构性消失、红线张力消失**。
- **去除 guard 层影响 = 有界**（见下「依赖面」）：删 guard/intercept/P0 wire（~3 文件 + P0 spikes）+ 加提议工具；**管道/UI/路由/版本/纯函数全部复用**。代价：刚做的 P0 guard 接线会被替换（但学习 + 管道复用不浪费）。

**Q2 · AFFiNE 判定/渲染/落地三段纯函数，我们能拆吗？直接用 AFFiNE？**
- **好消息：我们已经基本是这架构了**（查证 `pending-change-service.ts`）：
  - 判定(diff)：`computeReplaceDiffBlocks/computeEditDiffBlocks`（**纯函数**，content→DiffBlock[]）✓
  - 渲染(model)：`lib/artifact-view/{anchor,degrade,toc}`（**纯模块 + 单测**）✓
  - 落地(apply)：`applyResolvedBlocks(change) → 新内容字符串`（**纯函数**，重放 lcsDiff 取舍块）✓；fs 写盘只在 `PendingChangeStore` 薄封装
- **不能直接用 AFFiNE 代码**（它靠 block_id + Yjs/BlockSuite，我们是文本 + 纯文件）；但**架构已对齐**，至多微调（把纯 diff/apply 从 store 抽到独立 `diff-engine` 模块求极致清晰）。
- 结论：**D1-D5 已是健康架构，无需重写、无需照搬 AFFiNE。**

**Q3 ·「AFFiNE 控制两端所以能用 block_id，我们不控制」——人话 + 我们能否用？**
- **人话（条形码比喻）**：AFFiNE 给每段贴隐形条形码（block_id）再给 AI 看，**且 AI 的指令也归它管**、命令"没改的段保留条形码"。两端都它控 → 条形码往返存活 → 按码**精确匹配**（不靠猜）。我们现状：agent 用通用工具写**任意文件**、没人贴码也没人要求保码 → 只能按**文本相似度猜**（`findSubsequence`，脆；D3 有锚定坑）。
- **能否用——关键洞察**：一旦走 Q1 的「提议工具」模型，对**文档型产物**我们就**控制两端了**（工具是我们的 → 可注入/剥离 block_id；提示词是我们的 → 可要求 AI 保码）→ **block_id 可用、修掉文本匹配的脆弱**。**但只适用文档型（markdown 可分块），任意代码文件不适用。**

### 查证 ·「受管文档」机制代码依赖面
- **核心域**：`artifact-service.ts`（实体/版本/物化）、`pending-change-service.ts`（纯 diff + 纯 apply + store 落盘）、`artifact-guard.ts`（guard）、`artifact-intercept.ts`（resolveManagedTarget）、`profile-session-wiring.ts`（P0 wire）。
- **视图纯函数**：`lib/artifact-view/{anchor,degrade,toc}`。
- **API（~10 路由）**：`/api/projects/[id]/artifacts` + `/api/artifacts/[id]/{·,pending,pending/[c]/resolve,submit-version,rollback,versions,versions/[v]}`。
- **UI/store**：`ArtifactPanel`/`ArtifactPicker`/`PendingChangeCard`/`ChatWindow`/`AppShell`、`useArtifactStore`、`if-match`。
- **用户露出**：「受管产物」picker、`kind`(crd/prd/design)、"Notion 式只改一段"视图。
- **要删/换 vs 复用**：删 `artifact-guard`+`artifact-intercept`+P0 wire（+ P0 spikes/fixture）；加「提议工具」；**其余（域服务/纯函数/路由/UI/版本）全部复用**。

### 三问汇合 + lead 推荐
三问指向**同一方向**：转 AFFiNE 式「**文档实体 + 提议工具 + 已有纯函数管道**」——
1. Q1：提议工具替 guard → 通用、去复杂、去红线（删 guard 层有界）。
2. Q2：纯函数管道已就绪 → 复用即可、不重写。
3. Q3：提议工具让我们对文档"控制两端" → 可上 block_id 修脆弱。
**lead 推荐**：先**确认这个方向**，再开多方案设计（提议工具形态 / 是否上 block_id / 整篇重写 vs 局部 edit / 与既有 P0/D1-D5 衔接与回退 / 迁移成本），各画一版摆一起选。

### 谁拍 / 最终
**待用户拍板** —— 本轮为 lead 分析 + 推荐，方向未最终敲定。下一轮续记于下。

---

## 轮次 2（2026-06-18）· AFFiNE 源码核验 + 多方案设计对比

> 用户：方向定了，拉多方案对比；未拍板点详析优缺点；**防文档本身错，拉 AFFiNE 全源码核验**；源码放项目根（git 外）。
> 执行：ultracode workflow（3 核验 + 4 维度 + 1 综合，8 agent）。AFFiNE canary 浅克隆于 `Next-Step/AFFiNE/`（221MB，git 外，留作后续参考）。

### 核验结论（对照文档对不对）
- **diff 计算四论断**：基本属实——diff 由确定性纯函数算(非 AI)、按 block_id 精确匹配、replace/delete/insert、纯函数可重放。小订正：文档示例的 `'update'` 不是第四类 op，是 generateRenderDiff 输出 map 的键名（真实 op 名是 `replace`）。
- **⚠️ 命门论断被证伪**：「AFFiNE 命令 AI 保留 block_id」**开源仓里不存在**——`doc_edit` 是闭源云端工具、提示词不在仓里；开源唯一提 block_id 的提示词(Section Edit)方向相反(「不要输出 block_id 注释」)。**开源真跑的 `doc_update` 是「模型吐整篇全文 → 后端按内容 LCS 重配 id、并主动 strip 掉 AI 回传的 id 注释」**(单测 `test_update_ydoc_ignores_ai_editable_comments` 证：带 id 注释回写后 after==before)。
  - **修正认知**：不是"AFFiNE 有我们做不到的 block_id 魔法"。AFFiNE 真正"稳"的机制 = **内容 LCS 重配，与我们的 LCS 文本对账同构**；"靠 AI 保留 id"那条是脆弱路、AFFiNE 自己都不信(主动 strip)。→ 我们的 LCS 路线**不是弱替代、正是 AFFiNE 的强机制本身**。
- **三段纯函数**：判定+归并是纯函数且单测足；落地有副作用；另有第四个有状态编排层 `BlockDiffService`(diffMap$/rejects$/accept/reject/acceptAll) = 真正的 HITL 承重墙，是我们 PendingChange 领域服务的架构参照。

### 我方代码命门事实（查证，定方案）
- **`applyResolvedBlocks` 只支持 op=replace、patch 抛 INVALID**(pending-change-service.ts:217-219) → **整篇重写是唯一有物化通路的形态**；局部 edit 要新写一套(违 P0 最小闭环)。
- guard 生产接入点唯一(profile-session-wiring.ts:126-135)，纯函数管道与 guard 解耦 → 迁移成本本就低。
- 受管目录在 agent cwd 下(artifact-service.ts:77)，且 **bash 是真逃生口**(guard 没管 bash，`echo>versions/n.json` 可绕过 write/edit 守卫) → 收口够不够，取决于给不给 agent bash。

### 三方案对比 + 推荐
- **方案 A 极简整篇提议**(整篇 propose + 不上 block_id + 增量迁移 + 存储层兜底 guard、受管留 cwd)：复用面最大零新纯函数、faux 可验、护 P0 最友好。**推荐为 P0 首发。** 短板：长文档 token + diff 噪声、bash 漏洞(若给 bash)。
- **方案 B 整篇提议 + 物理隔离**(受管移出 cwd、根上断 bash)：唯一能真堵 bash 的方案，可保 agent 完整 coding。**条件采纳**——若决定给 bash 则必叠。代价：碰"项目自包含"哲学 + 迁移成本(三处拼路径 + 数据迁移)。
- **方案 C 块标记整篇提议**(读端注入 block_id + 写端**内容 LCS 重配**=走强机制非脆弱路)：消除长文档噪声 + 行内锚定鲁棒。**登记为后续增量增强**——跨判定/提示/显示三层、改 12 单测，与 P0 最小闭环冲突；A 稳定后确有噪声痛点再做。

**总推荐路径**：A 首发 → 视"给不给 bash"决定是否叠 B 物理隔离 → C 后置。
**推荐四维取值**：①整篇重写；②不上 block_id(LCS+findSubsequence+并排兜底)；③增量迁移(guard 暂留→验完删)；④存储层极轻 guard 为底，**给 bash 则叠 B 物理隔离**。

### 待用户拍板的开放问题
1. **【分水岭】propose 会话给不给 agent 通用 bash？** 给→必叠方案 B(物理隔离)；不给(收紧工具集只留 read+propose+安全子集)→方案 A 存储层兜底足矣。
2. 若叠 B：受管存储根放哪(app 级 `~/.pi/managed/<projectId>/`?)？能否接受"项目目录不再完全自包含"(触北极星"项目即工作区")？
3. 长文档 token/噪声容忍度：现在就上 C(block_id)/拆小文档，还是先 A、有痛点再做 C？
4. 迁移节奏：接受增量(过渡期 guard+propose 双通路共存，须补共存单测)还是大爆炸一步删 guard？
5. propose 的 artifactId 来源：上下文注入"当前受管文档清单"，还是加 list_artifacts 只读工具让 agent 自查？
6. 非 profile 路径(主对话/dispatch/idle)起 propose 时 sourceActor 填什么(否则 PendingChangeCard「变更来自」无值)？

### 谁拍 / 最终
**待用户拍板**（尤其问题 1 的 bash 分水岭）。

---

## 轮次 3（2026-06-18）· 用户六问 + 并行 agent team 调查

> 用户六问，要求"用 agent team 并行"。4 个并行 agent 查证 Q1/Q2/Q4/Q5/Q6（Q3 lead 直答）；Q6 首个 agent 空跑失败、已重派。

### 逐问结论（均带代码/来源证据）
- **Q1（关 bash 影响读文档？）→ 否。** read/bash 是 7 个独立工具，read 直接用 `fs`、不经 bash/子进程；"档案/记忆/项目上下文"由 DefaultResourceLoader 注入 system prompt、**不靠任何工具**；只有"逐个读文件内容"需 read 工具。→ 文档 agent 只需白名单含 `read`(+propose+list)、**不必给 bash**。(证据 read.js:4/22、sdk.js:132、spike Case B `["read"]`)
- **Q2（移出 cwd 放哪 + agent 怎么找 + 改哪）**：①推荐 `~/.pi/managed/<projectId>/`(与 ~/.pi 同源、projectId 稳定隔离；Iter C 派发产物不一起搬)。②**当前 agent 靠文件路径找、不靠 id**（注入块无 id/无清单），"物理存哪不影响 agent 找"**只在 V2 提议工具模型下成立** → **搬存储 = 必须同时上提议工具、不能只搬**。③前端/API 已纯 id（零改）；要改 = 域层 3 处路径常量(artifact-service:77/290、pending-change-service:314) + 拦截层 resolveManagedTarget/guard 换成提议工具 + 测试硬编码路径 + 一次性数据迁移。
- **Q3（长文档噪声 C 现在/先忍）**：C = 读端注入 block_id + 写端**内容 LCS 重配**（强机制、不靠 AI 保 id）；**推荐先忍、A 首发、C 登记后置**。
- **Q4（list_artifacts 工具可行？）→ 可行、机制现成。** customTools 已在用、`listArtifacts(projectId)` 现成；唯一坑 = execute 的 ctx 不带 projectId → **闭包注入**（照搬 artifact-guard 的 sourceActor 先例）。已出最小实现草图。
- **Q5（建 pi 包/扩展 vs 写 next-step 代码）→ 写成 next-step 代码（defineTool + customTools，沿用 artifact-guard 范式）。** pi 有 4 种加工具方式，但 next-step 是服务端 embedding pi SDK、程序化起会话，customTools 是唯一无需文件发现/信任流程的直传入口；pi 包只是分发壳、本地单用户无分发需求、属过度设计；defineTool/customTools 是 pi 公开 API、不碰内核红线。
- **Q6（Notion/AFFiNE 没 AI 时怎么做 diff/版本 + 反思）**：二者版本/diff/回退**都生长在文档/存储层、完全不知"AI"存在**——AFFiNE 历史层零 AI 分支、所有写经同一个 `pushDocUpdate(update,origin)`（origin 只是来源标签、10 分钟自动快照、回退用 Yjs 反向 update）；Notion 版本是页面与生俱来能力（10 分钟快照 + 块级/行内 diff 高亮 + restore），AI 内容与手打内容走同一套。**→ "diff 做成文档层通用能力、AI 只是众多调用方之一" 被两个成熟产品验证为正确解耦。** 两点注意：①Next-Step 的"提议→按块确认→才落版"HITL 闸门是**独有增量**（Notion/AFFiNE 都直接落盘 + 事后回退、无提议）；②回退**别照搬 CRDT**（那是为多人协作；Next-Step 单用户，简单版本快照 + 整块替换即可，已是现状）。

### 大综合：用户反思成立，且我们已基本建好
diff/版本/按块确认本就该是**文档层通用能力**，agent 退化为"产内容→调提议工具"的调用方——正是 Notion/AFFiNE 的分层。**Next-Step 的 PendingChange/diff/版本/按块确认管道已经是这个文档层能力（纯函数 + ArtifactService + UI 全现成）**；唯一把它和"对话"耦在一起的就是 **guard（路径拦截）**。**把 guard 换成 propose 工具，agent 即成"纯调用方"——正是用户想要的。**

### bash 分水岭已解开 → 方案收敛
Q1+Q2 合起来：决定 A vs B 的是"**改文档的 agent 给不给 write/bash**"——
- **文档型 agent**（工具集 = read + list_artifacts + propose，**不给 write/edit/bash**）→ 无任何直接写文件能力可绕过 → **方案 A 安全、受管目录留 cwd 也行、不必物理移出（B）**。产物是"文档型"(北极星)、agent 本就靠 propose 产出、不需 bash。
- 仅当要给同一 agent 完整 coding（写代码/跑命令）才需方案 B 物理隔离。

### 收敛推荐方案 = 「文档层能力 + propose 工具 + 受限工具集」（比上轮 A 更简）
- 文档层：复用现有 PendingChange/diff/版本/按块确认（纯函数 + ArtifactService + UI），零重写。
- 工具：next-step 代码加 `propose(artifactId, 新全文)` + `list_artifacts`（defineTool+customTools，闭包注入 deps）。
- 工具集：文档会话只给 read + list_artifacts + propose（不给 write/edit/bash）→ **无绕过路径 → 受管目录可留 cwd（省掉方案 B 的物理移出 + 数据迁移）**。
- 迁移：增量（先加 propose、guard 暂留兜底、验完删 guard）。block_id(C) 后置；回退维持整块替换、不上 CRDT。

### 待用户拍板
1. **改文档的 agent 是"文档型受限工具集"还是"通用 coding"？**（决定要不要方案 B 物理隔离；推荐受限 → 方案 A 最简）
2. agent 如何"**新建**"文档（vs 只编辑已有）：propose 只改已有；新建是 user 发起，还是另给 create 工具？
3. 非 profile 路径（主对话/dispatch）起 propose 时 sourceActor 填谁？

### 谁拍 / 最终
**待用户拍板**（核心 = 上面第 1 条：受限工具集 vs 通用 coding）。

---

## 轮次 4（2026-06-18）· 用户具体化需求（CRD 文档生产流）+ lead 深度分析

> 用户形容真实场景：对话里丢 PDF/Word → 用 skill 解析 + skill 转化(原始需求→CRD) → 创建 crd.md → 之后每轮修改都带版本/diff/高亮/确认(可为撤销键)，类似 Notion/AFFiNE/Word。

### lead 分析
- **用户要的四样大部分已建好**（Iter D）：版本=ArtifactVersion(D5)、diff=computeReplaceDiffBlocks、高亮=InlineHighlightView(D3)、确认/撤销=PendingChangeCard 按块✓/✗(D4)。"为什么不能写出来让 agent 用"——**已写出来**；缺的只是 ①agent 怎么**创建** ②agent 怎么**改**(换 propose) ③**PDF/Word 解析**(真没建)。
- **流程两段、语义不同**：第1轮创建=存 v1、**无需 diff**(全新、无上一版)；第2轮+修改=diff→确认→新版。**创建即受管文档**(诞生即有版本/可 diff)——顺手消掉"先建普通文件再标记受管"的别扭。
- **"确认=撤销键"= Word 修订模式**：按块 ✓接受/✗拒绝即 track-changes。差别：我们"**先拦后确认**"(更安全、红线)，Word/Notion"先落盘后撤销"；对 AI 产出建议保持先拦后确认、UX 做成修订视图手感。
- **skill 与文档机器正交**：skill 管内容(解析/转化)、文档机器管生命周期(版本/diff/确认)；文档机器不关心内容来源(印证轮次2·Q6 分层)。
- **工具集分水岭已定**：文档 agent 全程 = 读材料→调 skill→调创建/提议工具，**不需 bash/通用 write** → 工具集 = read+skill+create+propose+list → **方案 A 成立、受管留 cwd、不必物理移出**。

### 建议（按优先级）
1. 文档工具(next-step 代码 defineTool+customTools)：`create_artifact`(存 v1) + `propose_edit`(diff→确认→新版) + `list_artifacts`；文档会话收紧工具集(不给 bash/write)。
2. **PDF/Word 解析** = 真正的新活、是场景入口；docx 有 mammoth 依赖、PDF 需引库；V1.1 曾显式推迟("先纯文本、PDF/Office 后续")、现被提为入口必需 → 独立工作线。
3. 转化 skill(原始→CRD) = prompt 型 skill、较轻。
4. 迁移 = 增量(先加工具、guard 暂留兜底、验通删 guard)。

### 待用户澄清
1. crd.md 是"app 内的文档"还是"项目里能用编辑器打开的真实文件"？(影响存储/收口)
2. 创建由谁发起：agent 自建(给 create_artifact 工具，推荐) vs 用户在 UI 先建空文档让 agent 填充？

### 谁拍 / 最终
待用户澄清上面两点 + 拍板"是否按此收敛去拆任务"。

---

## 轮次 5（2026-06-18）· 用户澄清两点 → 模型定型

> 用户答轮次4 两问：① **crd.md = 项目里真实文件**（本地可开 + pi-web file panel 可见，类 Notion 页），非 app 内抽象实体；② **agent 直接建**（确认 create_artifact 工具）。

### 设计定型（关键）
- **当前内容 = 真实 `crd.md`**（纯 markdown 落在项目里，本地/git/file panel 都可见——纯文件、项目即工作区哲学不破）；**版本历史 + 待确认改动 = 旁挂"受管侧车"**（`.pi/artifacts/managed/<id>/` 的 versions/+pending/，artifact.json 记它对应哪个真实文件）；**只有"确认"流水线写 crd.md**。
- **新增一小块**（现状没有）：把"当前版"**物化成项目里真实 .md 文件**——现状受管内容只存 versions JSON、无真实文件。
- **收口直接靠受限工具集**：doc-agent 工具集 = read+skill+create+propose+list、**无 write/bash** → 写不了任何文件 → 只能 propose → **guard 彻底可删、受管留 cwd、不必方案 B/数据迁移**。
- **边界（待用户认）**：外部(编辑器/其它工具/带 bash 的 agent)直接改 crd.md **不会自动进版本/diff**——只有"AI 改"这条路走版本/确认；"外部改动也自动快照"(类 Notion 10min/文件监听)作后续增强。

### 收敛模型（可拆任务）
- 工具(next-step 代码 defineTool+customTools)：`create_artifact`(→真实文件+v1 侧车) / `propose_edit`(path或id, 新全文→diff→确认→新版) / `list_artifacts`；文档会话受限工具集；**删 guard**；复用 D3-D5 的 diff/版本/高亮/确认。
- PDF/Word 解析 skill = 独立工作线（docx 有 mammoth、PDF 需引库；V1.1 曾推迟、现为入口必需）；转化 skill(原始→CRD)=prompt 型、轻。

### 待定（实现级取舍，拆任务时定）
propose 收 path 还是 id；crd.md 放项目哪个目录；create 与 propose 是否合一；外部改动监听是否做。

### 谁拍 / 最终
模型已定型。用户决定：**"外部改动自动版本"暂不做、登记为待考量**（见下）；下一步在**新窗口**拍"开 vibe-coding 拆任务 / 再讨论"。

---

## 📌 待考量（登记不丢）

- **外部改动自动进版本**：crd.md 是项目里的真实文件，外部（编辑器 / git / 带 bash 的 agent）直接改它**不会自动进版本/diff**——只有"AI 改（propose→确认）"这条路走版本/确认。"任何改动都自动快照"（类 Notion 10 分钟自动快照 / 文件监听）作**后续增强**，**用户决定本期不做、仅登记**（2026-06-18）。

## 🧭 当前状态与下一步（交接锚点 · 给新窗口）

- **状态**：V2 方向 + 收敛模型**已定型**（见轮次5「收敛模型」）；AFFiNE 已核验纠偏（block_id"控制两端"系对照文档误导、我们的 LCS 文本对账即其真实强机制）。
- **取代关系**：本模型**取代** P0 的"逐路装 guard"档位2/3——改为**删 guard + 提议工具**（P0 的 pipeline/接线机制复用、不浪费）。
- **下一步（用户在新窗口拍板）**：① 开 **vibe-coding 正式拆任务**（需求 → 设计 → 任务卡 → agent team 实现）；或 ② 再讨论某一块。**模型已可开工。**
- **拆任务前要定的实现级取舍**：propose 收 path 还是 id；crd.md 放项目哪个目录；create 与 propose 是否合成一个工具。（外部改动监听 = 已登记后续、本期不做。）
- **配套**：完整讨论 = 本文件轮次 1~5；AFFiNE 源码浅克隆 = `Next-Step/AFFiNE/`（git 外，221MB）；记忆锚点 = `next-step-v2-propose-model`。
