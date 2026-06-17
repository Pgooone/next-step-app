# BF·BUG-02 · 全局 toast（§G + 操作回执）

自建最小 toast 基建 + 分批接 16 处无回执/吞错操作。本轮**序 3**。接线点多，重点防刷屏。
详见 `../BUG修复记录-v1.1.md` · BUG-02。决策落 `../docs/设计决策记录.md` D-V1.1-11（自建 vs 第三方）。

**阶段 A（基建）**
- [ ] `lib/stores/useToastStore.ts`（zustand）：`{ toasts, show({type,message}), dismiss(id) }`，自动消失计时 + 手动关闭
- [ ] `components/Toaster.tsx`（`"use client"`）：固定角落渲染、多条堆叠、卸载安全
- [ ] `app/layout.tsx` 挂 `<Toaster/>`（确认 layout 为 server component → Toaster 独立 client 组件）
- [ ] 阶段 A 自检：单测 store；真浏览器手动触发一条 toast 可见可关

**阶段 B（接线，按 BUG-02 表）**
- [ ] 接成功回执 + 关键失败：起会话 / 确认（全部 → **单条**）/ 回滚 / @转交 / 增删项目与 Agent / 派发
- [ ] **不双重提示**：已有 `formError/createError/setError` 的失败只留局部，toast 仅补「成功」+「无局部反馈的失败兜底」
- [ ] **防刷屏**：刷新类 `.catch(()=>{})` 默认不接；确需的（轮询持续失败）加 30s 去重/节流
- [ ] 写/补单测（store + 节流去重逻辑）
- [ ] 跑门禁：`vitest` + `tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：各操作有回执；连续刷新失败不刷屏；全部✓ 仅单条 toast（browser-e2e）
- [ ] 单独 commit（基建 / 接线可拆 2 commit）

**AC**：核心操作有回执、失败可见、不刷屏、不与局部态冗余。
