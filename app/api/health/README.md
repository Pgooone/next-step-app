# GET /api/health（环境健康检查）

> 归属：Next-Step 新增。`force-dynamic`，每次实时检查。

复用 `lib/env/doctor-checks.ts` 的 `runAllChecks()`，供首屏判断是否需要提示配置凭证。

## 返回结构
```json
{
  "node":        { "ok": true, "version": "v22.22.3" },
  "deps":        { "ok": true },
  "credentials": { "ok": false },
  "piHome":      { "ok": true, "writable": true },
  "ok":          false
}
```

## 字段含义
- `node.ok` — Node 版本 >= 20。
- `deps.ok` — 内核依赖可解析。
- `credentials.ok` — 存在可用模型凭证；首屏 banner 据此决定是否提示「去配置」。
- `piHome.ok` / `piHome.writable` — `~/.pi` 可写。
- `ok` — 四项 AND，整体是否健康。

## 约定
- 检查函数内部已 try/catch，本路由**不会抛**，始终返回 200 + JSON。
