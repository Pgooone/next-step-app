# lib/env（环境自检逻辑区）

> 归属：Next-Step 新增。

## 作用
启动前 / 运行时的**环境自检纯逻辑**，框架无关。
被 CLI（`scripts/doctor.ts`）与健康路由（`app/api/health`）共用同一份实现。

## 关键模块
- `doctor-checks.ts` — 四项检查 + 汇总
  - `isNodeVersionOk(version, min)` — 纯函数，解析主版本号比较
  - `checkNode(min)` — Node 版本（阻断级）
  - `checkDeps()` — 内核依赖 `@earendil-works/pi-coding-agent` / `pi-ai` 是否可加载（阻断级，async）
  - `checkCredentials()` — 是否存在可用模型凭证（warning 级，惰性 import 内核）
  - `checkPiHome(piHome)` — `~/.pi` 是否可写（warning 级，piHome 可注入便于单测）
  - `runAllChecks()` — 汇总，供 doctor / health 复用

## 约定 / 红线
- 检查函数内部各自 try/catch，**不向外抛**（health 路由零容错依赖此点）。
- `checkDeps` / `checkCredentials` 用**字符串字面量** `import("…")` 加载内核：
  内核 ESM-only（无 require 条件，`require.resolve` 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED）；
  且 `import(变量)` 在 Next 生产构建里会被 webpack 当作运行时动态请求而找不到模块，
  只有字面量 import 才能被静态分析并正确打包。如此兼容 tsx / Next 生产 / vitest 三上下文。
- 凭证判定与 `app/api/models/route.ts` 保持一致：`ModelRegistry.create(AuthStorage.create()).getAvailable().length > 0`。
- 检查的「阻断 vs warning」语义由调用方（doctor / banner）决定，本层只返回 `{ ok, detail }`。
