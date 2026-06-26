# P0 承重墙·档位1 实现监工起始指令（p0-prompt.md）

> vibe-coding 第 4 步起始指令，给「实现窗口」用。本窗口只到「任务拆分完成」为止，**实现未开始**。
> 真相源：`../docs/QA/开发/v2-P0接线范围与push决策.md`（范围/档位/命门/风险）+ 记忆 `next-step-v2-diff-blocker`。
> （路径相对 `tasks/`；代码路径相对 `next-step-V1.1/` 根。）

## 角色与目标
你是 P0 承重墙·档位1 的**监工**。目标：把「产物按块确认」拦截器接进 profile 会话链路，
让自定义 agent 改受管 artifact 时被拦成 PendingChange，端到端闭环真浏览器验收通过。
**仅接 profile 会话一处**（不碰主对话 `/api/agent/new`、dispatch、idle 重建——登记后续）。

## ⚠️ 实现纪律：用 agent team，非 fire-and-forget subagent
（用户明确要求，覆盖 vibe-coding 默认的「监工 + 子 Agent」模式）
- **用 `TeamCreate` 建实现团队**（如 `ns-p0`），队员是可寻址、可看中途进度的 team member，
  **不是** fire-and-forget 的 Agent 子进程。
- **串行实现**：P0 共享 `lib/pi/*`（artifact-guard / profile-session-wiring）+ 是承重墙，
  队员**禁止并行**；任务 `addBlockedBy` 锁序：spike → wire → verify。
- **监工只协调 + 亲验关键 diff**，不亲自写业务码、保持上下文精简（记忆 `next-step-delegate-detailed-work`）。
- **team 可能中途整体消失**（记忆 `next-step-agent-team-recovery`）：判断进度靠 `git status` 不靠 idle 通知，
  消失靠 `TeamCreate` 重建 + 精确交接续做。

## OOM 铁律（本机 3.4G 无 swap，已硬崩过 · 记忆 `next-step-local-oom-constraint`）
- 重活串行；**E2E 真浏览器 lead 自跑、不 spawn agent**；冷编译断言**轮询期望态**非定长 sleep；
  跑完 `fuser -k 30141/tcp`；E2E 期间不留 agent 存活。

## 质量门禁（每个任务都过）
- `npm run test`（vitest）+ `node_modules/.bin/tsc --noEmit` + `npm run lint` 全绿。
- **接线/闭环必真浏览器双层验收**（browser-e2e skill 的 **repo-vendored** 那份，全局那份 APP_ROOT 算错）。
- 红线：不改 pi 内核（`lib/pi/*` 只封装）；产物改动必经按块确认；纯文件；并发会话 ≤3。

## 开发批次（串行，被依赖先做）
- 批次 1：**p0-spike**（命门验证 profile.tools+guard 共存；**go/no-go**，FAIL 不进下一批）
- 批次 2：**p0-wire**（接线 profile-session-wiring + 单测 + 门禁）
- 批次 3：**p0-verify**（真浏览器端到端闭环 + 逻辑层独立复核）

## 监工循环
1. 取当前批次任务 → team 队员实现（附该 `tasks/第一轮-基础迭代/p0-*.md` + QA v2-P0 对应节 + 相关代码位置）。
2. 队员回来：监工**亲验 diff** + 跑门禁；不过→写回任务卡改；过→勾 `progress.md` + 单独 commit。
3. **spike PASS 才开 wire；wire 门禁绿才开 verify**。
4. verify 双层 PASS = 档位1 完成 → 回写台账/QA/记忆 → 登记后续档位（dispatch/idle/主对话 gap）。

## 第一步
先与用户确认是否就此开工。开工先做 **p0-spike**——它是 go/no-go：验证不通过，接线方案要先调整，别盲接。
