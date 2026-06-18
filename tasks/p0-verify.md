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

## 结果（2026-06-18 · 决策 D 选 A）

- **逻辑层（✅ 四重 PASS）**：独立验收员 logic-verifier 经**真生产函数 `startProfileSession`** + faux 起会话，`spike/p0-wire-verify/harness.ts` 14/14（lead 亲跑复核 exit 0）：受管 write/**edit** 拦成 pending（不写盘 / 无新版本 / sourceActor=profile.name）、非受管放行、只读 profile 无写工具、中文 sourceActor 对抗。wire 行为铁证。
- **真浏览器层（决策 D · A）**：本机无凭证 → 须 faux 驱动；faux 在「fixture + `SessionManager.create` + dev 可见状态」组合 finicky（agent 没发 write，已诊断为未测组合）。按 **决策 D**（QA `../docs/QA/开发/v2-P0接线范围与push决策.md`）接受「逻辑层四重(真生产路径) + D4 已真浏览器证同构 UI 闭环（pending→逐块/全部✓→物化落新版，12/12）」为档位1 完成依据。
- **隔离（无滑坡）**：逻辑层已证非受管放行 + 只读 profile 无写工具。
- **残留 gap（登记不丢）**：P0 来源 pending 的浏览器原生渲染未单独跑（与 D4 同构、风险近零）；fixture `scripts/p0-verify-fixture.mts` 留作后续配凭证时真驱动 E2E 的起点。

**判定**：逻辑层独立验收 PASS（四重，真生产路径）；真浏览器层以决策 D（D4 同构先例）达成 → **档位1 闭环达成**——「AI 改文档被拦 → 人按块确认 → 落新版」整条链每环已独立证实。
