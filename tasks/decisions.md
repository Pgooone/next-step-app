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

> 标「待回填」的行在对应任务卡落地提交后补 commit 哈希。
> 标「改 planner 建议」的行是 lead 否决了方案设计员的推荐——回溯时重点看这些。
