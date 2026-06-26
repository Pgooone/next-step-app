# P0·spike · 接线命门验证（profile.tools + guard 共存）

P0 档位1 接线前的 **go/no-go 关口**。验证 profile options 的 `tools` 白名单与 guard 的
`noTools:"builtin"+customTools` 共存时，内核装配出的工具集是否正确——guard 的 write/edit
生效且仍拦受管写，profile.tools 不把它们挡掉。当年 D2 spike 是裸会话、没测过这个组合。
详见 `../docs/QA/开发/v2-P0接线范围与push决策.md` 决策 C「头号技术风险」。

- [x] 读 `lib/pi/artifact-guard.ts`(149) + 定位 `assembleProfileSessionOptions`（看它返回的 `tools` 白名单）+ 参考 D2 spike（记忆 `next-step-v2-diff-blocker` 记 `spike/d2-intercept/harness.ts`，若仓库内还在）
- [x] 写 spike harness（仿 D2，faux provider）：构造 `{...profileOptions(含 tools 白名单), ...guardOptions(noTools+customTools)}` → `createAgentSession` → 让 faux agent 发 write 打受管路径
- [x] 断言：①guard 自定义 write/edit **激活**（非被 tools 白名单剔除）②受管路径写被拦成 PendingChange、磁盘无文件 ③非受管路径正常写盘 ④profile 的 tools 语义（若限制别的工具）不被破坏
- [x] 跑 spike，记录结果（PASS/FAIL + 内核实际装配出的工具集）
- [x] ~~若 FAIL：定位内核 tools/noTools/customTools 合并逻辑、提合并策略、回写决策；FAIL 不进 wire~~ —— **未触发（结果 PASS）**
- [x] 结论写入 `../docs/设计决策记录.md`（**D-V1.1-12**）+ 台账（progress）+ QA（开发/v2-P0）

**AC**：✅ **达成（PASS）**——profile.tools 与 guard noTools/customTools 共存下，受管写被拦、非受管放行、profile 工具语义不破。go/no-go：**PASS → p0-wire 解锁**。

## 结果（2026-06-18 · ✅ PASS / GO）

`spike/p0-profile-guard/harness.ts`，`node --conditions=import --import tsx` → **11/11 PASS, exit 0**；三重确认（build agent 自跑 + 对抗复核员含负对照判 sound + lead 亲跑）。

- 内核装配实况：`tools` 在场时 `noTools` 被忽略、active = `[...tools]`（`sdk.js:132`）；guard 同名 custom write/edit 按名覆盖内置（`agent-session.js:1868-1871`）→ 只要 write/edit ∈ 白名单，guard 版即胜、受管写仍被拦成 PendingChange。
- 合并策略：按 `{...profileOptions, ...guardOptions}` 直接 spread 即可（键不冲突、顺序无关），**无需另想办法**。
- **带进 p0-wire 的两条约束**：①白名单必须含 write/edit（否则工具不激活，profile 配置约束非 guard 失效）；②`profile-session-wiring.ts:105` 当前尚未并入 guard，wire 须真合并且 customTools 用本会话 cwd 构造。详见 ADR D-V1.1-12。
