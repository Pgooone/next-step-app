# Next-Step 进度看板（总体）

> 本目录是**工作进度跟踪器**；规格真相源在 `../../next-step/docs/`（先读 `00-overview`）。
> 每完成一张任务卡：勾选状态 → 按对应 AC 自检 → `npm run lint && npm run test` → **更新所在区 README** → 提交 commit → 回写本页。
> 凡有「选项+取舍」的拍板 → 追加一行到 [decisions.md](decisions.md)（回溯找 bug 用）。

## 里程碑

| 里程碑 | 模块文件 | 内容 | 状态 |
|---|---|---|---|
| 前置 | `spike/d2-intercept/` | D2 拦截可行性验证 | ✅ 已完成（11/11 PASS） |
| Iter A | [project-workspace.md](project-workspace.md) | 项目即工作区（A1/A2/A3） | ✅ 完成（A1 ✅ A2 ✅ A3 ✅） |
| Iter B | [agent-profiles.md](agent-profiles.md) | 多 Agent 可定义（B1/B2/B3/B4） | ✅ 完成（B1 ✅ B2 ✅ B3 ✅ B4 ✅） |
| Iter C | [dispatch.md](dispatch.md) | 多 Agent 协作派发（C1/C2） | ✅ 完成（C1 ✅ C2 ✅；真实端到端待凭证） |
| Iter D | [artifacts-diff-hitl.md](artifacts-diff-hitl.md) | 产物 Diff/版本/HITL（D1–D5，v2） | ✅ 完成（D1 ✅ D2 ✅ D3 ✅ D4 ✅ D5 ✅） |

## 主线收官 · 未了清单 · 下一阶段（2026-06-16）

**四大支柱主线（Iter A/B/C/D）全部完成** ✅——项目即工作区 / 多 Agent 可定义 /
多 Agent 协作派发 / 产物 Diff·版本·HITL（v2 灵魂支柱）。机制层全部落地并双层验收。

**未了清单**（已知缺口，进入迭代阶段前的待办；均与「卡已完成」不矛盾——属当初按
范围有意延后的接线/边角）：

1. **D-D2-6 拦截接真实会话 ⭐ 最关键**：D2 只交付「拦截层 + 注入封装 + faux 验证」
   （方案甲，有意未改业务端点）。缺 ① 装配（`assembleArtifactGuardOptions` 接进
   `profile-session-wiring` / `dispatch-runner`）② agent 读 artifact 当前内容的文件
   接口（内容存 `versions/<n>.json` 非裸文件、内置 read 读不到）。**后果**：D3/D4/D5
   的 Diff/确认/版本机制全建好且双层验过，但都用 E2E fixture 直接造 PendingChange
   验的；**真实 agent 编辑受管 artifact → 自动转 PendingChange 的活路径尚未通电**——
   让灵魂支柱真正可用的临门一脚。
2. **docs/04 SSE `artifact.created`/`version.created`**：契约已定义，按 D-D5-2 暂缓，
   待 D-D2-6 接 agent→版本后再补。
3. **D4 R（重新生成）键**（D-D4-2）：保留键位 + 降级提示，依赖 D-D2-6。
4. **D3 UX gap**（D-D3-11）：空欢迎态划选引用无可见反馈（有活跃会话时正常）。

**下一阶段：迭代新增功能**。具体方向（先补 D-D2-6 让支柱 live / 愿景的同窗口实时
agent team / 其他新功能）属产品级决策，待用户拍板（见根 `README.md` 与北极星愿景方向）。

## 依赖图

```
A → B → C
A → D
C → D        （D 依赖 A 与 C）
```

## 底座决策

`next-step-app` **以 pi-web 基座为起点**：复制 `../../next-step/pi-web-code` 为应用底座，
在其上叠加领域层（`lib/domain/**`）、领域 API（`app/api/{projects,agents,dispatch,artifacts}`）、
领域 UI（`components/ProjectSwitcher` 等）。pi 内核不 fork，只在 `lib/pi/**` 封装。

## 已确认的关键技术结论（来自 spike）

- **D2 拦截可行**：`createAgentSession({ noTools:"builtin", customTools:[替身 write/edit] })`，
  替身 execute 不写盘、转 PendingChange。**必须用 `noTools:"builtin"`，不能用 `excludeTools`**
  （后者按名 denylist 会把同名替身一起剔除）。详见 `spike/d2-intercept/README.md`。

## 进展

- ✅ 仓库骨架；✅ D2 拦截 spike 验证通过；✅ 导入 pi-web 基座。
- ✅ A1 项目注册表；✅ A2 项目选择器 + 绑 cwd；✅ A3 环境自检（doctor + /api/health + 凭证 banner）。
- ✅ **Iter A 项目即工作区 完成**（test 29/29 + lint + build + doctor exit 0）。
- ✅ B1 Agent 档案存储与三件套落盘（2c7187c，test 37/37）。
- ✅ Iter A 实地验证（dev server，API 链路全绿）；✅ 流程约定：区 README + 决策表；✅ 推送 GitHub 私有仓库。
- ✅ B2 按档案注入起会话（`lib/pi/agent-profile-session.ts`，test 50/50）：`DefaultResourceLoader` +
  `appendSystemPromptOverride` 注入 agent.md+memory（记忆只读、实测扛 rebuild）、`skillsOverride` 过滤技能、
  model 单串解析+降级、thinkingLevel 直传；`assembleProfileSessionOptions` + `applyProfileRuntime` 两函数，
  createAgentSession 留给调用方（D-24~D-28）。
- ✅ B3 Agent 管理 UI（纯 CRUD，test 66/66）：`AgentManager.tsx`（模态：列表/新建/编辑/内联删除确认）+ `useAgentStore`；
  表单 model 下拉(/api/models)、skills 多选(/api/skills)、tools 勾选内置集、删除文案强调删整个目录（D-30/31）。
  **真浏览器 E2E 验收**（Playwright + 缓存 chromium）：建→改→删全程跑通、三件套真落盘、删除真清目录、中文正常。
  E2E 发现并修复 SSR hydration 真 bug（useProjectStore 以 localStorage 作初始 state → Agents 按钮刷新后卡死禁用；改 init null + 挂载后 hydrate）。决策 D-29~D-33。
- ✅ **B4 按档案起会话接线（wiring）**（test 84/84、build 11/11 页）：新端点 `POST /api/projects/[id]/agents/[agentId]/session` + `lib/pi/profile-session-wiring.ts` 组合层 + `rpc-manager.registerInnerSession`（提取注册段、绕开旧 toolNames 段，D-B4-1）；端点带首条 message 一步建会话+发首条避内核懒落盘幻影会话（D-B4-3）；`renderAgentMd` create/update 共用、update 仅 name/role 变更才重写 agent.md（D-B4-6/D-B4-8，agent.md 定为可手编资产）。**真浏览器 E2E** 实测 AC②③④ 全 PASS（live systemPrompt 含 role/memory 特征、改 role 后只注入新 role、仅改 model 保留手编）。决策 D-B4-1~8。
- 🔄 **Iter B 完成**；下一张 Iter C（多 Agent 协作派发）或 Iter D（产物 Diff/HITL，D2 已预验）。
- ✅ **Iter C 多 Agent 协作派发（C1+C2）完成**（agent team `ns-iter-c`：c1-impl 后端 + c2-impl 前端，lead 协调）。test 113/113、lint、build(13 页) 全绿。
  - **C1**（`lib/domain/orchestrator.ts` + `dispatch-store.ts` + `lib/pi/dispatch-runner.ts` + `concurrency-gate.ts` + dispatch API 两端点）：`runDispatch` 串行起 worker→上游产物喂下游(AC③)→assistant 产物落 `.pi/artifacts/<dispatchId>/<seq>-<agent>.md`(D-C-1 轻量普通文件)→状态机 pending→running→done/failed 实时落盘；并发≤3 等待式闸门(AC⑤，gate 60s + worker 执行 5min 双超时)；`GET /api/dispatch/[taskId]` 跨项目扫描定位(D-C1-3)。faux 单测真实断言产物(D-C1-2：每次 prompt 前 `setResponses`)。
  - **C2**（`components/DispatchPanel.tsx` 模态 + `lib/stores/useDispatchStore.ts` + AppShell surgical 接线 +24/-0）：发起表单(goal+选 2–3 agent+子任务)⇄汇总视图(状态徽章+产物链接复用 `handleOpenFile`)，2s 轮询。**真浏览器 E2E 全过**（开模态/发起/状态/产物链接打开/刷新不卡死 hydration）。
  - 决策 D-C-1~3（方向）+ D-C1-1/2/3 + D-C2-1/2。
  - ✅ **真实端到端验收通过**（D-C-2，2026-06-16 配 DeepSeek deepseek-v4-flash 凭证后）：API 链路 2 worker 串行真跑 → 产物落盘 → 上游喂下游 → 状态机 done；真浏览器 E2E 全流程可用（开模态/选 agent/填子任务/发起/状态徽章/产物链接打开/刷新不卡死 hydration）。真实跑暴露并修复中文 agentName 文件名 bug（D-C1-4，faux 测不到）。最终 test 118、lint、build(13 页) 全绿。截图 `e2e-screenshots/iterc-*.png`。
- ✅ **D1 受管 artifact 读写后端完成**（agent team `ns-impl`：d1-impl 实现 + verifier 独立验收，lead 协调）。test 135、lint、build(11 页) 全绿。
  - `lib/domain/artifact-service.ts`：受管 artifact 落 `.pi/artifacts/managed/<id>/`（`artifact.json` + `versions/<n>.json` 单版快照），与 Iter C 派发产物 `<dispatchId>/` 同根**物理隔离**(D-D1-1)；`currentVersion`(最高版号)/`version`(乐观锁)**双计数同步 +1**；`submitVersion`/`rollback` 写盘前 `assertVersionMatch`(If-Match≠当前 version→VERSION_CONFLICT/409)、新版独立文件名永不覆盖旧版(D-D1-3)；`rollback` 复制目标版成新版(不删历史)；`findArtifact` 跨项目仅扫 `managed/` 定位(契约无 projectId)。
  - **5 路由**：`GET /api/artifacts/[id]`(+`/versions`)、`POST .../submit-version`、`POST .../rollback`、`POST /api/projects/[id]/artifacts`(创建，D-D1-5)；`lib/api/if-match.ts` 解析 If-Match，抛带 `code:"INVALID"` 普通错误**鸭子类型解耦、不依赖 domain**(D-D1-7，与 errors.ts 一致)。
  - **17 个 service 领域单测**穷尽覆盖路由暴露语义（409/422/404、rollback 复制/双计数、原子写无残留、跨项目定位）；路由不单测(D-D1-6，遵循 D-23 薄壳约定)。**verifier 独立复跑 135 绿 + 落盘 19 断言 + 红线全守 PASS**。
  - 决策 D-D1-1~7。docs/02(两类布局澄清)+docs/03(managed 落盘)+docs/04(契约补 2 行)回写。
- ✅ **D2 拦截编辑工具 → PendingChange 完成**（agent team `ns-impl`：d2-impl 实现 + d2-verifier 独立验收，lead 协调）。test 164（新增 29：pending-change 17 + intercept 8 + guard faux 4）、lint、build(11 页) 全绿。
  - 装配选 **C**（D-D2-1）：保留内置工具集 + 内核 `createWriteToolDefinition/createEditToolDefinition` 注入 operations **自分流**（受管→拦截转 PendingChange 不写盘；非受管→委托真实 fs），零工具漂移、edit 语义归内核、details 内核自动生成；注入 readFile 顺带喂受管当前版内容给内核算 diff（同时解掉 agent 读 artifact 内容契约 gap 在 edit 路径上的阻塞）。
  - `lib/domain/pending-change-service.ts`（PendingChange/DiffBlock + 手写 LCS 切块 computeReplaceDiffBlocks + 落盘 managed/<id>/pending/）+ `lib/pi/artifact-intercept.ts`（resolveManagedTarget 运行时识别、不建索引 D-D2-2）+ `lib/pi/artifact-guard.ts`（自分流 + assembleArtifactGuardOptions + faux 端到端）。
  - **范围方案甲（D-D2-6）**：仅拦截层+封装+faux 验证，**未改** profile-session-wiring/dispatch-runner/orchestrator（接进真实会话 + agent 读 artifact 文件接口留接线卡）。
  - **verifier 自写独立 fixture 交叉验证不变量 2**（受管编辑不写盘→PendingChange 落盘）3/3 PASS；10/10 验收项全过。决策 D-D2-1~6。
- ✅ **D3 ArtifactPanel 产物渲染完成**（commit `9081134`；agent team `ns-impl`：d3-impl 实现/接力 + d3-verifier 逻辑层验收 + d3-e2e 真浏览器验收，lead 协调）。test **201**、lint clean、build(11 页) 全绿；**真浏览器 E2E 6 AC + SSR 全 PASS**。
  - 纯渲染层（§5.4，D-D3-1）：**只读**，不含 resolve/确认/版本切换（留 D4/§5.5、§5.6）。
  - 后端只读数据源：`listPendingChanges` + `GET /api/artifacts/[id]/pending`（对齐 docs/04，D-D3-2）、`listArtifacts` + `GET /api/projects/[id]/artifacts`（D-D3-6）。
  - 纯函数区 `lib/artifact-view/`（可单测，D-D3-5）：`toc`(解析) / `anchor`(连续子串锚定) / `degrade`(块>25 降级，INLINE_HL_LIMIT=25)；28 单测。
  - 前端：`useArtifactStore`（不持久化、天然无 SSR mismatch，D-D3-8）+ `ArtifactPanel`(内容+TOC、三态高亮 add绿/del红/mod黄、并排 Diff 逐块 D-D3-9、划选引用) + `ArtifactPicker`(打开入口) + AppShell 产物/文件视图互斥切换(D-D3-7) + ChatWindow QuoteBar 引用条。
  - **两处 bug 修复**：① 交接的 artifact-service JSDoc `*/` 提前闭合致 build 崩（接力发现，前 teammate「后端 done」从未跑过 build）；② `selectPendingBlocks` 派生 selector 返回新数组引用 → zustand 无限重渲染、ArtifactPanel 一开即崩 → `useShallow`（D-D3-10，**真浏览器 E2E 暴露、单测/逻辑层抓不到**，同 B3 旨趣）。
  - 已知 UX gap（D-D3-11，留后续）：空欢迎态下划选引用无可见反馈（有活跃会话时 AC⑥ 正常）。决策 D-D3-1~11。E2E 复验脚本 gitignore 不入库。
  - **过程**：team 运行时一度整体丢失（疑上下文压缩，落盘成果保留），靠 git status 核进度 + 重建 team + 精确交接接力恢复（[[next-step-agent-team-recovery]]）。
- ✅ **D4 PendingChangeCard + 按块确认完成**（commit `54503ec`；agent team `ns-impl`：d4-impl 实现 + d4-verifier 逻辑层验收 + d4-e2e 真浏览器验收，lead 协调拍板）。test **222**（pending-change-service 42，新增 16）、lint clean、build(11 页) 全绿；**双层验收全 PASS**（verifier 自写 8/8 fixture + 红线全守；真浏览器 E2E 12/12、pageErrors 空）。
  - HITL 闭环最后一环（§5.5）：对话框卡片逐块确认/拒绝 → 一条 PendingChange 全块非 pending → 服务端重建内容 + 物化新版本，守「确认后才写盘」红线。
  - **内容重建**（D-D4-1）：`applyResolvedBlocks` 纯函数重放 lcsDiff+同序聚块、按块 state 取舍；不变量「全 confirmed=newContent / 全 rejected=oldContent」+ 混合行序均单测；仅 op=replace、失配/patch 抛 INVALID（不在 DiffBlock 冗余行号）。
  - **写盘落 service**（D-D4-4/5）：「一组」=单条 PendingChange；`resolveAndMaterialize`（注入 ArtifactService）翻块后「全块非 pending」则重建 + `submitVersion`(当前 version If-Match) + `remove`，路由薄壳；`resolveBlock` 纯翻 state 独立可测；写盘**唯一**在全决分支（verifier 核红线）。
  - **D 键聚焦面板**（D-D4-3 选 **B**，lead 否决 impl 预拍 A）：`diffFocusNonce` + `requestDiffFocus()` 信号 + AppShell +1 useEffect（nonce>0 展开右面板），解决「面板收起后按 D 静默无反馈」（AC④「聚焦」语义，同 D-D3-11 类 gap 这次避掉）；真浏览器实测收起面板→D→可靠展开并排 Diff。
  - **R 重生降级**（D-D4-2，接线卡）：后端 resolve 契约只 confirm/reject；R 依赖 agent 会话向受管路径再写（= D-D2-6 gap），D4 保留键位 + 按下提示「需会话接线」，留接线卡待 D-D2-6 一并接。
  - 决策 D-D4-1~5。E2E 脚本 `scripts/d4-e2e-*` gitignore 不入库；新环境坑见 [[next-step-d4-verified]]（Skill 默认拉全局 `run-e2e.sh` APP_ROOT 推断错、须用 repo-vendored 那份）。
  - **过程**：D 键方案 lead 三轮按住 B（消息交错 impl 一度按 A 后纠正），真浏览器验证 B 正确；impl 主动把写盘从路由下沉 service（更合 D-D4-5 本意）。
- ✅ **D5 版本管理完成**（commit `89af26d`；agent team `ns-impl`：d5-impl 实现 + d5-verifier 逻辑层独立验收 + d5-e2e 真浏览器独立验收，lead 协调拍板）。test **225**（+3 getVersion）、lint clean、build(11 页) 全绿；**双层独立验收全 PASS**（verifier 自写 7/7 fixture + 红线全守；真浏览器 7/7、pageErrors 仅 4 条与 D5 无关的 /tmp 文件树 403）。
  - **范围 scope B**（D-D5-1 用户拍板）：只做版本管理，ArtifactPanel 保持只读、**不引入手动编辑器**（§5.6 AC⑤ 撤销重做留独立后续卡，要做须先拍它与 PendingChange 红线关系）；AC① 由 D4 pending 态满足、AC②⑥ 由 D1 满足（本卡验收确认）、**AC③④ 本卡新增**。
  - **D-D5-2 用户拍板 A：暂缓 SSE 设施、前端直刷**——精读接缝发现既有 SSE 是按会话流（events/route.ts 全由 `session.onEvent` 喂）、无通用事件总线，且当前无「agent 自动写版本」的跨上下文生产者（D-D2-6 未接线），为不存在的生产者提前造设施违 Simplicity First；同一 store/同浏览器下前端 `refresh()` 已覆盖今天所有版本变更（rollback/D4 resolve）。docs/04 SSE 契约保留为待办，留 D-D2-6 接 agent→版本后再补。**未建任何 SSE、未动 useAgentSession**。
  - **后端缺口①**（D-D5-3）：公开 `getVersion` + 新路由 `GET /api/artifacts/[id]/versions/[version]`（取某版完整 ArtifactVersion，version 非整数→422、不存在→404、findArtifact 跨项目定位）。
  - **前端**：`useArtifactStore` +版本 action（listVersions/selectVersion/rollback，rollback 带 If-Match=当前 version、成功后 refresh+复位跟随最新、409 处理）；`ArtifactPanel` 头部版本下拉（selVer==null 跟随最新）+ rollback 两步二次确认（D-D5-5）；**看历史版只读、无 pending 高亮/Diff/视图切换控件**（D-D5-4）。版本列表刷新落 panel useEffect 监听 currentVersion（一处覆盖 rollback 与 D4 物化两条 +1 路径、refresh 本身不动 surgical）。
  - 决策 D-D5-1~5。E2E 脚本 `scripts/d5-e2e-*` gitignore 不入库。乐观锁字段是 `version`（非 currentVersion），前端发 `If-Match: String(artifact.version)`。
  - **过程教训**：① impl 把实现+E2E+改记忆三件事全自干、并自标「双层验收全 PASS」——lead 不认自跑 E2E（同脚本同盲区≠独立验收，D3 教训），另派 d5-verifier/d5-e2e **独立**复核（各自自写 fixture/驱动），独立确认后才收口。② E2E 真凶常是冷编译延迟 vs 定长 wait（用 waitForResponse+轮询、非 waitForRequest+sleep），见 [[next-step-d5-verified]]。
- ✅ **Iter D（产物 Diff/版本/HITL，v2 主线）收官**（D1–D5 全 ✅）。灵魂支柱「产物细粒度可控与可回溯」机制闭环：拦截编辑→PendingChange→面板渲染→按块确认→物化新版→版本切换/rollback。未了正交 gap（非 D5 范围）：D-D2-6 拦截接真实会话（① 装配 ② agent 读 artifact 文件接口）、D4 R 重生降级（D-D4-2）、D3 UX gap（D-D3-11）。
