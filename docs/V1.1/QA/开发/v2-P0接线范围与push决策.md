# V1.1 下一步决策 · push + P0 接线范围（本会话逐条留痕）

> 记录：2026-06-18。本会话承接 `v1.1-bug-fix` 收官，定下一步 = P0 承重墙接线 + 本期范围档位。
> 格式（按用户要求）：每条记 **背景 → 可选项（全列）→ 我的推荐 + 理由 → 谁拍 → ✅ 最终选择**。
> 配套：bug-fix 轮的用户 QA 见 `../../../../BUG修复记录-v1.1.md` §一；总索引见 `../00-索引.md`。

## 背景：本会话怎么来的

**用户原话（接手指令）：**
> 新窗口读那份 + BUG修复记录-v1.1.md（含「说人话」+ 决策 QA + 收官验收）即可无缝接手

新窗口读交接锚点记忆 `next-step-v1-1-bugfix-done` + 台账 `BUG修复记录-v1.1.md` + 交接文档 `交接-收官与后续.md` + **亲核 git 实况**后接手。随后产生三个决策点。

---

## 决策 A · 这 10 个 commit 现在 push 吗

**背景**：本地 `v1.1` 领先 `origin/v1.1` 共 **10 个 commit、全部未推送**（`045cf84`→`ce4cfbd`，含 bug-fix 5 缺陷的 6 个代码 commit + 台账/交接文档）。交接文档把「确认是否 push」列为新窗口**第一件事**（本窗口未拍板）。

| 选项 | 说明 |
|---|---|
| **现在 push** | 把 10 个已双层验收通过的 commit 推到 `origin/v1.1`，先保全成果 |
| 暂不 push | 留在本地，等 P0 或后续修复一起推，或用户自己推 |

**我的推荐**：中性两选、未单标推荐 —— 记忆多处标注「未 push」像有意留着，故把时机交用户定。

**谁拍**：用户。
✅ **最终：现在 push**。已执行 `git push origin v1.1` → `cf904fc..ce4cfbd  v1.1 -> v1.1`，本地与 `origin/v1.1` 齐平。

---

## 决策 B · 下一步主攻方向

**背景**：`v1.1-bug-fix` 5 个低垂果实缺陷收官，下一步攻哪。

| 选项 | 说明 |
|---|---|
| **P0 承重墙·先界定范围（我推荐）** | BUG-00 产物按块确认运行时断裂，v2 命门、绑北极星红线①。须先定范围（接哪几条起会话路径 / idle 是否补注入）再动手，防滑坡 |
| 补 P1 余项 | BUG-06 dispatch 刷新即丢 / BUG-07 首回合 token 丢，风险低、可独立补 |
| 仅接手待命 | 先就位，等用户给具体任务 |

**我的推荐**：P0 承重墙·先界定范围。**理由**：交接文档列为「最重要」、是 v2 命门、绑红线，是 roadmap 上真正的下一件大事；但因绑红线、是大活，第一步应是「定范围」而非「开干」，先和用户对齐接线范围防滑坡。

**谁拍**：用户。
✅ **最终：P0 承重墙·先界定范围**。

---

## 决策 C · P0 本期接线范围档位

**背景（lead 亲验代码后，非盲信交接文档）**：
- P0 = 把「按块确认」的拦截器 `assembleArtifactGuardOptions`（`lib/pi/artifact-guard.ts:149`，方案 C·operations 自分流，D2 已造好并 spike 11/11）接进起会话链路 —— 它**全仓库零运行时调用者**，门造好了没装电。
- 亲验 `resolveManagedTarget`（`artifact-intercept.ts:24`）：guard **只拦「对已存在受管 artifact（`.pi/artifacts/managed/<id>/`、`artifact.json` 已存在）的写盘」**，普通文件 / 派发产物目录一律放行真实写盘 → **语义无滑坡**（不是「拦一切写」，也不负责「把新产物变受管」）。
- 接线分层：① profile 会话（`profile-session-wiring.ts:105`）+ ③ dispatch worker（`dispatch-runner.ts:106`）走 **Next-Step 自有封装层**（接它们不碰 pi-web 原生）；② 主对话 + idle 重建走 `rpc-manager` 的 `startRpcSession`（**pi-web 原生底层**，红线张力）。
- **发现两个真实风险**（交接文档没点透）：**主对话 gap**（主对话改受管 artifact 不被拦，两条红线张力）、**idle 重建漏洞**（profile 会话 idle 销毁后被 SSE 重建走原生路径、丢 guard 保护）。
- **头号技术风险**：profile options 带 `tools` 白名单，guard 带 `noTools:"builtin"+customTools`，二者 `{...profile, ...guard}` **共存**时内核如何解析 —— 当年 spike 没测过（裸会话无 profile.tools 层）→ 实现第一步必须最小验证，绝不盲接。

| 档位 | 接哪几条 | 取舍 |
|---|---|---|
| **档位1·最小闭环（我推荐）** | 只接 ① profile 会话 | 改动最小（接线点一处 + 入口 route 传依赖），先端到端验证「AI 改文档→拦成 pending→按块确认→落盘新版」整条闭环在生产链路跑通；承重墙首接最稳；其余登记后续 |
| 档位2·双路径 | ① profile + ③ dispatch worker | 都是自有封装层（不碰原生），但首接就扩面、验收面更大 |
| 档位3·双路径+idle 补 | ①③ + idle 反查 `ns-session-map` 补 guard | 最完整、堵 idle 漏洞，但碰 pi-web 原生 SSE 路径 + 反查档案，复杂度 / 红线张力最高 |

**我的推荐**：档位1·最小闭环。**理由**：①承重墙第一次接，先把最常用的路①打通、亲眼验证整条闭环在真实使用里转起来最稳；②路①（自定义 agent 起会话）就是 Next-Step 核心场景；③越往后档位越碰 pi-web 原生路径、风险越高，不该在首接时一起干；④两个风险先登记不丢，等核心闭环稳了再逐个收。

**交互细节**：用户初次答「我不知道怎么选，请讲人话，并且解析你的推荐」；我用大白话（「P0 是一道安检门、装在哪几条进门的路上」的比喻）重讲三档区别 + 推荐理由后，用户拍板。

**谁拍**：用户。
✅ **最终：档位1·最小闭环**（只接 ① profile 会话）。

---

## 决策 D · P0 verify 验收深度（2026-06-18）

**背景**：P0·wire（D-V1.1-13，commit 49635f1）完成后跑 verify 双层。逻辑层独立验收员经**真生产函数 `startProfileSession`** + faux 起会话**四重验证**（受管 write/**edit** 拦成 pending、非受管放行、只读边界、sourceActor=profile.name；harness `spike/p0-wire-verify/` 14/14，lead 亲跑复核）——wire 铁证成立。真浏览器层撞两坎：①本机**无模型凭证**（`~/.pi/auth.json` 不存在）→ 浏览器里没法让真 agent 写；②用 faux 在「fixture 进程内 `startProfileSession` + `SessionManager.create` + dev 可见状态」这个**从未测过的组合**下没绑上 responses（agent 只回空、没发 write）。同时确认 **D4 那轮已真浏览器验过「pending→逐块/全部✓→物化落新版」UI 闭环（12/12）**，而 P0 的 PendingChange 与 D4 **同构**（UI 不关心来源）。

| 选项 | 说明 | 代价 |
|---|---|---|
| **A 接受逻辑层四重 + D4 浏览器先例（我推荐）** | 以「逻辑层(真生产路径)证 wire + D4 浏览器证 UI 闭环」为档位1 完成依据 | 最省、零 OOM 风险；残留极小 gap（P0 来源 pending 的浏览器原生渲染未单独跑，但与 D4 同构、风险近零） |
| B 继续调通 faux 跑 P0 专项真浏览器 E2E | 换 in-process 造 profile + seed 可挂载会话，跑通真 wire pending→浏览器按块确认→落新版 | 多花时间 + OOM 风险；基本重证 D4 已证之事 |
| C 用户配模型凭证 → 真驱动 | 浏览器里真起 agent 调模型写受管 artifact | 非确定性 + 需配凭证 + 撞已知 OOM 高危场景（agent 流式长窗口，[[next-step-m8-verified]] 崩因） |

**我的推荐**：A。**理由**：①承重墙逻辑（会出错、最该反复验的）已用**真生产函数** `startProfileSession` 四重证；②UI 闭环 D4 已真浏览器证、同构数据；③B 拿时间 + 崩机风险重证已证之事，性价比极低；④C 要本机刻意不配的凭证 + 撞已知 OOM 崩溃场景；⑤残留仅一条极小已登记 gap，不触档位1 灵魂——「AI 改文档被拦→人按块确认→落新版」整条链每一环都已被独立证实。

**交互细节**：用户初答「说人话解释选项 + 我推荐哪个为什么」，我用「安检门 / 模型钥匙」比喻讲清三档区别 + 推荐理由后记此。

**谁拍**：用户授权 lead 选推荐并记录（首条指令「选择你推荐的决策并记录」）；已声明「你若更想要 B/C 随时叫停回退」，决策可逆。
✅ **最终：A —— 接受逻辑层四重 + D4 浏览器先例为档位1 完成依据**；残留 gap 登记于下方。

---

## 由本会话决策派生的后续待办（登记不丢）

- **P0 实现第一步**：✅ **spike 已验证 = GO**（2026-06-18，`spike/p0-profile-guard/`，11/11 PASS，三重确认）—— `profile.tools` 白名单与 guard `noTools/customTools` 共存下受管写仍被拦成 PendingChange。结论 + wire 约束见 ADR `../../设计决策记录.md` D-V1.1-12。**p0-wire 已解锁**（关键约束：白名单须含 write/edit；guard 须真并入 `profile-session-wiring.ts:105`）。
- **登记后续档位**：③ dispatch worker 接线、idle 重建补 guard（反查 `ns-session-map`）。
- **登记 gap**：主对话（pi-web 原生）改受管 artifact 不被拦 —— 红线张力，待用户决定是否处理。
- **P0 档位1 收官（决策 D）**：spike(D-V1.1-12) + wire(D-V1.1-13，49635f1) + verify(逻辑层四重 + D4 浏览器先例) 全完成。**verify gap**：P0 来源 pending 的浏览器原生渲染未单独跑（无凭证 + faux 该组合 finicky；与 D4 同构、风险近零）——后续若配凭证可补真驱动 E2E（起点 `scripts/p0-verify-fixture.mts`）。
