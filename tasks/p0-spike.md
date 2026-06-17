# P0·spike · 接线命门验证（profile.tools + guard 共存）

P0 档位1 接线前的 **go/no-go 关口**。验证 profile options 的 `tools` 白名单与 guard 的
`noTools:"builtin"+customTools` 共存时，内核装配出的工具集是否正确——guard 的 write/edit
生效且仍拦受管写，profile.tools 不把它们挡掉。当年 D2 spike 是裸会话、没测过这个组合。
详见 `../docs/QA/v2-P0接线范围与push决策.md` 决策 C「头号技术风险」。

- [ ] 读 `lib/pi/artifact-guard.ts`(149) + 定位 `assembleProfileSessionOptions`（看它返回的 `tools` 白名单）+ 参考 D2 spike（记忆 `next-step-v2-diff-blocker` 记 `spike/d2-intercept/harness.ts`，若仓库内还在）
- [ ] 写 spike harness（仿 D2，faux provider）：构造 `{...profileOptions(含 tools 白名单), ...guardOptions(noTools+customTools)}` → `createAgentSession` → 让 faux agent 发 write 打受管路径
- [ ] 断言：①guard 自定义 write/edit **激活**（非被 tools 白名单剔除）②受管路径写被拦成 PendingChange、磁盘无文件 ③非受管路径正常写盘 ④profile 的 tools 语义（若限制别的工具）不被破坏
- [ ] 跑 spike，记录结果（PASS/FAIL + 内核实际装配出的工具集）
- [ ] 若 FAIL：定位内核 tools/noTools/customTools 合并逻辑（`sdk.js`），提合并策略（spread 顺序 / 显式 merge tools），回写决策；**FAIL 不进 wire**
- [ ] 结论写入 `../docs/设计决策记录.md`（D-V1.1-12 起）+ 台账/QA

**AC**：spike PASS——profile.tools 与 guard noTools/customTools 共存下，受管写被拦、非受管放行、profile 工具语义不破。go/no-go：PASS 才开 wire。
