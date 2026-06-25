# V1.2 第五轮 · 会话分组与主会话 —— 任务进度

> 设计见 `docs/V1.2/第五轮-会话分组与主会话/`；用户拍板 `docs/V1.2/QA/第五轮-会话分组与主会话决策.md`（D-V1.2-21~23）；lead ADR `docs/V1.2/设计决策记录.md`（D-R5-01~07）。
> 实现 = agent team（ns-impl 实现 + ns-verify 真浏览器验收）串行；lead 每卡亲读 diff + 复跑门禁 + 亲看截图再 commit（不认队员自报告，进度以 git 实盘为准）。

| 卡 | 内容 | 状态 | commit |
|---|---|---|---|
| T1 | 承重墙·orchestrator 补 setOwner（Bug1 数据层）：OrchestratorDeps 可注入钩子 + `:152` 无条件写归属（completed/timeout/aborted 都写）+ 6 spy 用例 | ✅ | `bae6a95` |
| T2 | 承重墙·派发完成刷新分组（Bug1 接线）：DispatchPanel 独立 `onSessionsChanged`（**不被 producedArtifact 门控**）+ AppShell 有界重试 | ✅ | `c44e282` |
| T3 | 进项目恢复主会话（Bug2）：`main-session.pickSessionToRestoreOnEnter` + SessionSidebar 两阶段恢复 effect + **wait-gate** | ✅ | `b06e447` |
| T4 | 首次进新项目 = 主对话新建态（Bug2）：`effectiveNewSessionCwd` 链天然成立、无代码 | ✅ | 无代码（真浏览器验证） |
| 收尾 | 分组 `data-testid="agent-session-group"`（验收辅助）+ 订正 `sessionsForAgent` 注释 | ✅ | `5bb4641` |
| T5 | 红线核对（机制零改）+ 文档回写（三件套 + QA + ADR + 索引 + README + 本 progress） | ✅ | 本回写 |

## 真浏览器统一验收摘要（ns-verify 跑、lead 亲看截图 PASS）

- **逻辑层**：`npm run lint` 净 / `npx tsc --noEmit` **0 错误** / `npm test` **426/426 全绿**。
- **Bug1（coding 派发分组）**：建 2 个 coding agent（编码甲/乙）派发 → `dispatchStatus=done` → 关面板**不手动刷新**等 ~7s（T2 重试窗口）→ 左栏自动出 2 个 agent 分组（各 `count=1`）、`ns-session-map.json` `bySession` 2 条、不堆「其它会话」。
- **Bug2 T4 新建态**：空项目进入 = 中间区可输入、发消息前 `/api/sessions` 无该 cwd 会话。
- **Bug2 T3 恢复**：发首条成主会话（`mainSessionId` 落盘）→ 再进**自动恢复**（主对话区高亮 + 中间区显示完整对话）、url 无 `?session=`。
- **Bug2 T3 降级**：删主会话（`mainSessionId` 陈旧）→ 再进新建态、不崩。
- **pageErrors**：无 JS 崩溃（仅 console 层 403 = 临时项目 `/api/files` + 会话切换竞态 fetch 失败，已知无关）。
- 验收驱动脚本：`scripts/verify-r5-drive.mjs`（未入 git，惯例同 `verify-r7b-*`）；截图 `/tmp/pw/r5-*.png`（未入 git）。

## 收官前待办

1. **测试残留清理**：验收脚本 finally 已 DELETE 临时项目（projB/projA）+ rm 临时根；`~/.pi/projects.json` 已复位（仅剩 CS2）✅。
2. **push**：4 个 commit（`bae6a95`/`c44e282`/`b06e447`/`5bb4641`）+ 本文档回写 commit，**待用户授权后** push origin/v1.2（+ 按惯例 ff master）。
