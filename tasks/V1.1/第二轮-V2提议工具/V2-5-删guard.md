# V2-5 · 删 guard 层

> 批次 4，依赖 V2-4（接线切走后才能安全删）。详见 `../../docs/第二轮-V2提议工具/详细设计.md` · V2-5。

## 目标
删除 artifact-guard / artifact-intercept，清理残留 import。

## AC
- [ ] 删 `lib/pi/artifact-guard.ts` + `artifact-guard.test.ts`、`lib/pi/artifact-intercept.ts` + `artifact-intercept.test.ts`。
- [ ] 清理 `wiring.ts` 的 `assembleArtifactGuardOptions` import（V2-4 已替换）。
- [ ] grep 确认无活引用：`artifact-guard` / `artifact-intercept` / `assembleArtifactGuardOptions` / `resolveManagedTarget`。
- [ ] `tsc` 无未解析 import；门禁绿。

## 注意
`resolveManagedTarget`：V2 不再拦路径（受管内容经工具按 id 操作）→ 可删；删前 grep 确认无其它依赖（若 V2-1 物化用到则迁移而非删）。
