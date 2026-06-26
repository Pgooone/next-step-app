# BF·BUG-01 · 进项目 cwd 错误（§I，选 A 补强版）

修三个相关缺陷：①空 cwd ②串别的项目 cwd ③切项目不更新。本轮**序 2**。无依赖。
详见 `../../../docs/V1.1/BUG修复记录-v1.1.md` · BUG-01（决策 Q3：naive 选 A 被证伪，改补强版）。

- [ ] 读 `AppShell.tsx`(174-175 / 390-398 / 446) + `SessionSidebar.tsx`(205-209 / 264-288 / 532) + `app/api/sessions/route.ts`
- [ ] `AppShell.tsx:390` 给 `<SessionSidebar>` 加 `key={currentProjectId}` → 切项目干净 remount（修缺陷③）
- [ ] 改 `SessionSidebar.tsx:269-288` auto-select effect：URL 会话恢复（需等 allSessions 加载）**之后**、`getRecentCwds` **之前**，插入「优先采纳 `selectedCwdProp`（项目根）」分支，且空会话场景也能执行（修缺陷①②）
- [ ] 确认不破坏：URL `?session=` 恢复优先；手动下拉选 cwd(`:532`)、自定义路径(`:307/323`) 不被覆盖；无限循环检查
- [ ] 写/补单测（auto-select 优先级：URL 恢复 > 项目根 > getRecentCwds；空会话也采纳项目根）
- [ ] 跑门禁：`vitest` + `tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收 4 场景：①无会话进新项目 → New/Skills 可用 + 主对话渲染 ②有别项目会话进新项目 → cwd=本项目根（不串） ③A↔B 切项目 → cwd 跟随 ④URL 恢复会话不破（browser-e2e，OOM 防护 lead 自跑）
- [ ] 单独 commit

**AC**：四场景全 PASS——不空、不串项目、切项目跟随、不打断 URL 恢复。
