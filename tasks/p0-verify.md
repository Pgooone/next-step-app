# P0·verify · 双层验收（真浏览器端到端闭环）

档位1 的**灵魂验收**：证明「AI 改文档→拦成 pending→UI 按块确认→落盘新版」整条闭环在
生产链路（profile 会话）真的跑通——不是手动造 pending，是 agent 真发 write。
依赖 `p0-wire`。OOM 防护：**lead 自跑、不 spawn agent 跑 E2E**。

- [ ] 造前置：一个项目 + 一个已存在受管 artifact（`.pi/artifacts/managed/<id>/` + `artifact.json`）+ 一个 profile（agent 档案）
- [ ] 真浏览器：起该 profile 会话 → 发消息让 agent 改那个受管 artifact（faux 或真 model）→ 断言对话/右面板出现 PendingChange（被拦、未直接写盘）
- [ ] 真浏览器：UI 按块确认（逐块 ✓ + 全部✓）→ 断言落盘、artifact 生成新版本（`versions/<n+1>`）
- [ ] 断言隔离（无滑坡）：agent 写普通文件（非受管）→ 正常写盘、不进 pending
- [ ] pageErrors 空；冷编译**轮询期望态**非定长 sleep；跑完 `fuser -k 30141/tcp`
- [ ] 逻辑层 verifier **独立**自写 fixture/驱动复核（双层验收，lead 不认 impl 自跑）
- [ ] 回写台账/QA/progress + 单独 commit

**AC**：profile 会话里 agent 真发 write → 受管 artifact 被拦成 pending → 按块确认 → 落盘新版本，端到端真浏览器 PASS；非受管写放行（无滑坡）；双层（逻辑层 + 真浏览器）独立验收均 PASS = 档位1 完成。
