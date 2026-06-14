# lib/domain（Next-Step 领域层）

> 归属：Next-Step 新增。　规格：`../../next-step/docs/03`（数据模型）、`04`（API 契约）
> 任务卡：`../tasks/`

## 作用
项目 / Agent 档案 / 派发 / 产物的**纯领域逻辑**，框架无关、不依赖 Next.js。
API 路由（`app/api/**`）只做 HTTP 转换，调用这里。纯文件存储（无 DB）。

## 关键模块
- `project-registry.ts` — 项目注册表（`~/.pi/projects.json` 的 CRUD）
- （后续）`agent-profile-store.ts` / `orchestrator.ts` / `artifact-service.ts`

## 约定 / 红线
- 领域错误抛带 `code` 的错误（如 `ProjectError`："NOT_FOUND" | "INVALID"）；
  HTTP 状态映射在 `lib/api/errors.ts`，本层**不碰 HTTP / NextResponse**。
- 写操作走「临时文件 + rename」原子落盘。
- 实体的权威 TS 类型在 `docs/03`，本层实现服从它。

## 改这个区前
先读 `docs/03` 数据模型（实体的权威类型）。
