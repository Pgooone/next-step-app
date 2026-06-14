# 决策表（Decision Log）

> 记录每一次有「多个选项 + 取舍」的拍板：当时的选项、最终选择、理由（含被否决项的否决理由）。
> **用途**：回溯找 bug 时，快速定位「为什么当初这么设计」，而非靠记忆或重读代码猜。
> **维护**：planner / 实现中冒出的「需 lead 拍板」点，决策后立刻追加一行（任务卡 DoD 的一部分）。改了 planner 建议的，务必记下为什么。

| 编号 | 阶段/卡 | 决策点 | 选项 | ✅ 选择 | 理由 | 关联 |
|---|---|---|---|---|---|---|
| D-01 | spike/D2 | 不 fork 内核下如何拦截 edit/write 写盘 | A) `excludeTools`+customTools　B) `noTools:"builtin"`+customTools　C) subscribe 事后拦截 | **B** | A 实测会把同名替身一起剔除（sdk.js:131-135，组合 A 替身未激活）；C 内核已异步写盘、来不及（rpc-manager.ts:75 fire-and-forget）。B 让内置集为空、同名替身存活。 | a685a91 |
| D-02 | 底座 | next-step-app 怎么起 | A) 复制 pi-web 基座为起点　B) 全新最小 Next.js | **A**（用户确认） | 文档既定路线，直接继承会话/SSE/工具/UI 与 API；后续复用 UI 的 Iter D 零额外搬运。 | f923751 |
| D-03 | A1 | 领域错误与 HTTP 的关系 | A) 领域层直接构造 HTTP 响应　B) 领域抛带 code 的错误、HTTP 映射独立 | **B** | 领域逻辑框架无关、可单测；HTTP 映射集中在 lib/api/errors.ts 供所有领域路由复用。 | d0b002a |
| D-04 | A1 | projects.json 写盘 | A) 直接 writeFileSync　B) 临时文件+rename 原子写 | **B** | 防崩溃/并发写损坏注册表；成本仅一行。 | d0b002a |
| D-05 | A2 | 前端状态层 | A) Zustand 真 store　B) useState 提升+自定义 hook | **A**（改 planner 建议） | 文档/CLAUDE.md 既定 Zustand；B/C/D 还会有 agent/dispatch/artifact 多个 store，Zustand 避免 prop 逐层钻透的返工；zustand 是文档钦定依赖、非投机。 | 44c9345 |
| D-06 | A2 | ProjectSwitcher 与既有 CWD picker | A) 替换 picker　B) 并存（项目在上、picker 保留） | **B** | 替换要删 recent/custom/default 三套交互、违反 surgical；并存让临时目录仍可用。 | 44c9345 |
| D-07 | A2 | cwd 注入点 | A) headerSlot prop + 复用 selectedCwd 受控值　B) 改会话创建逻辑 | **A** | ~3 行 surgical，不碰 /api/agent/new、rpc-manager、内核（红线）。 | 44c9345 |
| D-08 | A2 | 删除二次确认形态 | A) window.confirm　B) 内联确认条 | **B** | 不被浏览器拦截、更可控、UX 一致。 | 44c9345 |
| D-09 | A2 | zustand 版本 | A) 锁 v3（基座传递依赖）　B) 装 v5 直接依赖 | **B** | v5 是当前大版本、build 已过；基座那份 v3 是 @lobehub 传递依赖，二者独立互不影响。 | 44c9345 |
| D-10 | A2 | next-env.d.ts | A) 提交　B) gitignore | **B** | Next 构建产物、每次 build 重生，与已忽略的 .next/ 一致。 | 44c9345 |
| D-11 | 流程 | 是否建区 README | A) 不做　B) 每区薄 README（定位/归属/红线/指针） | **B**（用户提议+认可） | agent 进区即懂、降探查成本；薄+只放稳定信息+并入 DoD 防腐烂。 | d0776e3 |
| D-12 | A3 | doctor 运行方式 | A) 仅独立 npm run doctor　B) doctor + predev 自动阻断 dev | **B** | ①②失败时 predev 非 0 退出会中断 npm run dev，直接满足「阻断启动」AC；③④仅 warning 不挡。 | 1ced9fd |
| D-13 | A3 | doctor 跑 TS 的方式 | A) `node --experimental-strip-types`　B) `tsx` | **B**（改 planner 建议） | strip-types 是 Node **22.6+** 才有，Node 20/21 不支持，会让「检测 Node≥20」自相矛盾（旧 Node 连脚本都跑不起来）；tsx 在 Node 18+ 通吃、单一 TS 源。 | 1ced9fd |
| D-14 | A3 | 凭证检测手段 | A) `ModelRegistry.getAvailable().length>0`　B) authStorage.has 逐 provider | **A** | 与 /api/models:17 一致，统一覆盖 OAuth 登录态与 API Key，贴「有可用模型」语义。 | 1ced9fd |
| D-15 | A3 | 首屏向导形态 | A) 自动弹 ModelsConfig 模态　B) 可关 banner 引导 | **B** | 低打扰、符合「③缺凭证仅 warning 引导」语义；复用 ModelsConfig 不新写设置 UI。 | 1ced9fd |
| D-16 | A3 | doctor 检查逻辑放哪 | A) lib/domain/　B) lib/env/ | **B**（改 planner 建议） | 环境自检非业务领域；lib/domain 只放 Project/Agent/Artifact 业务实体；lib/env 仍在 lib/** 故 vitest 可测。 | 1ced9fd |
| D-17 | A3 | ~/.pi 可写测哪个目录 | A) ~/.pi/agent　B) ~/.pi | **B** | projects.json 固定在 ~/.pi（agentDir 的父级），测父级覆盖最全；PI_CODING_AGENT_DIR 只改 agent 子目录。 | 1ced9fd |
| D-18 | A3 | checkDeps 怎么检测「内核可加载」 | A) `createRequire().resolve(pkg)`　B) `await import(变量)`　C) `await import("字面量")` | **C**（实现期修正，非取舍） | 内核 ESM-only、`exports` 无 `require` 条件 → A 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`；B 被 webpack 当运行时动态请求、**Next 生产构建下失效**；C 可被 webpack 静态分析，vitest/tsx/Next 三上下文全通。checkDeps 因此改 async。 | 1ced9fd |
| D-19 | B1 | 删除 agent 是否删整个 `.pi/agents/<id>/` 目录 | A) 仅摘注册（仿 A1）　B) rmSync 整个目录 | **B** | 与 A1 刻意不同：项目 root 是用户真实代码目录、误删灾难性故只摘注册；agent 目录是 Next-Step 在 `.pi/` 下生成的内部资产，删档案=删目录才符合直觉、避免孤儿目录。 | 2c7187c |
| D-20 | B1 | agentMdPath/memoryPath 存相对还是绝对 | A) 相对 projectRoot　B) 绝对 | **A** | 与 docs/03 注释一致；项目目录移动/改名后相对路径仍有效，绝对路径会陈旧。消费侧 `join(root,path)` 还原。 | 2c7187c |
| D-21 | B1 | agent.json 与 .md 的分工 | A) agent.json 内联 .md 内容　B) agent.json 仅结构化元数据 + path 指向 | **B** | agent.json 为结构化真相源（list/get 扫它），.md 为正文资产、内容不内联，避免双写不同步。 | 2c7187c |
| D-22 | B1 | create 时是否校验 model/skills/tools 存在 | A) 校验　B) MVP 不校验 | **B** | 校验 model 需调 ModelRegistry、校验 skills 需扫技能目录，B1 引入耦合不划算；更适合 B2 起会话注入时校验/降级。B1 只存白名单字符串。 | 2c7187c |
| D-23 | B1/流程 | API 路由目录是否各带薄 README | A) 每个 API 路由组都加　B) 不加（沿用 projects 先例） | **B** | app/api/projects 本就无 README；API 路由是领域层的薄 HTTP 包装，契约在 docs/04 + 领域区 README，逐路由加 README 碎片化。区 README 约定仅针对 lib/** 等逻辑区。 | 2c7187c |
| D-24 | B2 | system prompt 注入点 | A) 事后改 `agent.state.systemPrompt`　B) 自建 `DefaultResourceLoader` + `appendSystemPromptOverride`　C) `systemPromptOverride` 整体替换 base | **B** | A 被 `_rebuildSystemPrompt` 多处覆盖（agent-session.js:555-556/812-816/1666-1667 每次从 loader 重读），rpc-manager.ts:321 现有先例只在「空工具且此后无 rebuild」窄路径侥幸成立、不可推广；C 会丢内核默认工具说明/guidelines（只想加不想换）。B 是唯一原生且扛 rebuild 的持久源（已核验：`DefaultResourceLoader` 导出于 index.d.ts:15、选项 `appendSystemPromptOverride` 于 resource-loader.d.ts:113、`createAgentSession` 有 `resourceLoader` 于 sdk.d.ts:50）。「头部」取「base 之后、project_context/skills 之前的显著首块」（append 段位置由 system-prompt.js 决定，字面整串最前需 C 替换 base、代价大故不取），用 `<agent_profile>`/`<agent_memory readonly>` 标签包裹强化只读语义。 | 待回填 |
| D-25 | B2 | model 单 string 解析与「模型不存在」降级 | A) 拆成 provider+modelId 两字段　B) 保持单 string、按首个 `/` 解析 `provider/modelId` | **B** | docs/03 `AgentProfile.model` 是权威单 string，A 违反契约；modelId 可能含 `/` 故按首个 `/` 切分。降级：model 空/格式非法/`registry.find` 落空 → 跳过 set_model 用内核默认 + `diagnostics.modelFallback=true`，**不阻断起会话**（本地单用户工具，档案模型失效不该整体失败；「直接 422」更严格但体验差，否决）。 | 待回填 |
| D-26 | B2 | skills 注入与「技能不存在」 | A) 校验技能存在否则报错　B) `skillsOverride` 按 name 从已发现集过滤、不存在静默忽略 + 记 `missingSkills` | **B** | 内核技能从目录发现（agentDir/skills、cwd/.pi/skills）按 frontmatter name 建 Map（skills.js:292-334）；profile.skills 是名字数组，正好用 `skillsOverride` 过滤（resource-loader.d.ts:80）。是否安装是 /api/skills/install 的事，B2 只「从已发现集选」；缺失静默忽略 + diagnostics 记录。成本一个 filter，纳入 B2 不拆。 | 待回填 |
| D-27 | B2 | B2 封装的边界（端点 + 内聚度） | A) 仅返回「注入材料」数据、createAgentSession 调用与 set_model/thinking 全留给 B3　B) 不加端点，但 B2 拥有 `assembleProfileSessionOptions` + `applyProfileRuntime`（含 model 降级），createAgentSession 调用留给调用方 | **B**（改 planner 建议） | 不加用户态端点、不碰 /api/agent/new（契约「复用不动」、新增路由表无此端点、AC 可纯单测闭环）——这点采纳 planner。但**否决** planner「仅返回数据材料」：§5.2「模型不存在」降级是 registry 查找后的边界行为，若只返回 `{provider,modelId}` 数据、由 B3 写 setModel+fallback，则该边界逻辑落在 B3、B2 测不到。故 B2 须拥有 `applyProfileRuntime(session,profile,deps)`（registry 查找 + 降级 + setModel + setThinkingLevel）这一真实可测函数；createAgentSession 调用本身因绑会话生命周期/registry 仍留给调用方（B3 + 单测用 faux）。pure helpers 独立单测。 | 待回填 |
| D-28 | B2 | profile.tools 为空时与 prompt 清空逻辑的协调 | A) 沿用 rpc-manager.ts:320 空工具清空 systemPrompt　B) 空 tools = 保留档案 prompt、不清空 | **B** | rpc-manager.ts:320-322 在 toolNames 为空时把 systemPrompt 置空，会抹掉档案注入（注入块=档案+记忆，是 prompt 核心价值）。B2 不碰 rpc-manager（归 B3 集成），故在封装注释写明此约定：profile 注入路径下空 tools=「无编码工具但保留档案 prompt」、不走清空分支；tools 收窄用 `setActiveToolsByName`（其 rebuild 从 loader 重读注入、不丢）。 | 待回填 |

> 标「待回填」的行在对应任务卡落地提交后补 commit 哈希。
> 标「改 planner 建议」的行是 lead 否决了方案设计员的推荐——回溯时重点看这些。
