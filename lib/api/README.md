# lib/api（Next-Step API 辅助）

> 归属：Next-Step 新增。　规格：`../../next-step/docs/04`（接口契约）

## 作用
`app/api` 领域路由共用的 HTTP 辅助，把领域层与 HTTP 解耦。

## 关键模块
- `errors.ts` — `domainErrorResponse`：把领域错误的 `code` 映射为 HTTP
  （NOT_FOUND→404 / INVALID→422 / VERSION_CONFLICT→409 / 其他→500），响应体 `{ error, code }`。
- `if-match.ts` — `parseIfMatch(req)`：解析乐观锁 `If-Match` 头为整数（缺省→undefined 放行、非整数→抛带 `code:"INVALID"` 的错误（鸭子类型，不依赖 domain）→422），供 artifact 写路由（submit/rollback）复用，集中守卫。

## 约定
- 领域层只抛带 `code` 的错误、不构造 HTTP 响应；路由 `catch` 后交给本区映射。
- 错误码与状态以 `docs/04` 并发与错误码一节为准。

## 改这个区前
先读 `docs/04`。
