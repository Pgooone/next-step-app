# 第三轮实现监工起始指令（受管文档入口并入 file panel）

> 新窗口开工：你当**监工**。先读详细设计（`../../docs/第三轮-受管文档入口合并/详细设计.md`）+ QA 决策（`../../docs/QA/开发/受管文档入口并入filepanel决策.md`）+ 本文，再按 T1~T4 用 **agent team** 串行实现。
>
> **详细设计已过 ultracode 8-agent 设计 + 对抗加固**（2026-06-19）：1 blocker + 2 major 已修订并入，新增 ADR **D-V3-02~08**。**直接按修订后任务卡做、无须再 review**；对抗发现见详细设计 §三/§四。

## 角色与目标
1. 落地方案二：左栏文件树切「顶部受管文档分组（点开进 ArtifactPanel）+ 下方普通树」，删 Artifacts 按钮 + ArtifactPicker。
2. 按 T1~T4 **串行**，每卡过门禁再下一卡、单独 commit。
3. 端到端验收：左栏受管分组点开 → ArtifactPanel；crd.md 不双现；.pi 隐藏；双入口已堵。

## 开工方式：agent team（不是 fire-and-forget subagent）
- `TeamCreate` 建实现团队（如 `ns-v3`），队员**可寻址**（SendMessage 点对点派任务 + 收成果 + 追问纠偏）。
- 监工只协调 + 亲验关键 diff + 复跑门禁 + 亲跑真浏览器；队员一次一卡、**串行**（本机 3.4G 无 swap、并行重活硬崩，见 `next-step-local-oom-constraint`）。
- `addBlockedBy` 锁顺序：T1 → T2 → T3 → T4。
- Claude 实现 team 用**默认 opus、别指定 sonnet**（sonnet 本环境 401）。

## 承重墙与命门（实现必看）
- **T2 是承重墙**：去重 key 必须**绝对路径** `join(projectRoot,filePath)` vs `node.fullPath`（**非裸名**）——cwd≠projectRoot 真实可能（`handleCwdChange` AppShell.tsx:175 切 cwd 不切项目），裸名会误剔 / 张冠李戴 / 子目录漏剔（对抗 blocker D-V3-04）。
- **命门**：受管 .md 不得再能从普通树用 FileViewer 打开（否则 SSE 冲突复活 + 绕过受管能力）→ 靠 T2 去重堵死（D-V3-06）。
- `projectId`/`projectRoot` 由 SessionSidebar 自取透传，AppShell 只传 `onOpenArtifact`（D-V3-08）。

## 质量门禁（每卡全绿再下一卡）
`npm run test` + `node_modules/.bin/tsc --noEmit` + `npm run lint`；UI 卡走真浏览器（repo-vendored browser-e2e，非全局 run-e2e）。

## 红线（北极星不变量）
- 不改 pi 内核；受管机制层（侧车 / artifact-service 三写方法 / 提议工具）一行不动。
- artifact 改动必经 propose → 按块确认 → 才落版 + 物化（本轮不碰这条链）。
- 纯文件无 DB；单用户。
- 新机制决策记 `../../docs/设计决策记录.md`（`D-V3-NN`，现到 D-V3-08）；用户拍板记 `../../docs/QA/开发/`。
- 每完成一卡即细粒度提交（`next-step-commit-per-task`）。
