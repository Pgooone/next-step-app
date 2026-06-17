# BF·BUG-04 · 高危操作二次确认（P2.4）

「全部 ✓/✗」「回滚」加内联二次确认，复用既有 `confirmId`/`confirmDelete` 范式。本轮**序 4**。
建议在 BUG-02 之后（失败可走 toast）。详见 `../BUG修复记录-v1.1.md` · BUG-04。

- [ ] 读 `PendingChangeCard.tsx:178-197`（全部✓/✗）+ `useArtifactStore.ts` 回滚 + 范式 `AgentManager.tsx:644-687` / `ProjectSwitcher.tsx:46-64`
- [ ] 全部 ✓/✗：点击 → 替换按钮区为「确认全部 N 处待处理块？[确认][取消]」（明确数字）
- [ ] 回滚：点击 → 内联「确认回滚到 vN？[确认][取消]」
- [ ] **仅全部/回滚加**，逐块 ✓/✗ 等高频操作不加
- [ ] 边界：外点 / Esc 关确认态（参考 `ProjectSwitcher:54-64`）；确认态与 `hint`/`error` 不抢空间；`busy` 时禁用；后端在确认态打开时已 resolve → 监听 pendingChanges 变化自动清确认态；行高不裂
- [ ] 写/补单测（确认态开关 + 仅全部触发）
- [ ] 跑门禁全绿
- [ ] 真浏览器验收：全部✓/回滚需二次确认、取消/外点可关、逐块不受影响（browser-e2e）
- [ ] 单独 commit

**AC**：高危操作有确认、可取消、不误伤高频逐块操作。
