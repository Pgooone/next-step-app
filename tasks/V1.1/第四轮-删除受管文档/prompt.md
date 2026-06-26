# 第四轮实现监工起始指令（删除受管文档）

> 新窗口开工：你当**监工**。先读详细设计（`../../docs/第四轮-删除受管文档/详细设计.md`）+ QA 决策（`../../docs/QA/开发/删除受管文档决策.md`）+ 本文，再按 T1~T3 用 **agent team** 串行实现。

## 角色与目标
1. 给受管文档补「删除」：`deleteArtifact`（彻底删=侧车+磁盘 .md）+ DELETE 路由 + store.delete + 两处入口（ArtifactPanel 头部 / 受管分组行垃圾桶）+ 两步二次确认 + 删后清理刷新。
2. 按 T1~T3 **串行**，每卡过门禁再下一卡、单独 commit。
3. 端到端验收：两处删除入口 → 二次确认 → 侧车 + .md 双删、分组更新、彻底删后 .md 不重现普通树。

## 开工方式：agent team（不是 fire-and-forget subagent）
- 队员**可寻址**（SendMessage 点对点派任务 + 收成果 + 追问纠偏）；监工只协调 + 亲验关键 diff + 复跑门禁 + 亲跑真浏览器。
- 队员一次一卡、**串行**（本机 3.4G 无 swap、并行重活硬崩，见 `next-step-local-oom-constraint`）。
- `addBlockedBy` 锁顺序：T1 → T2 → T3。Claude 实现 team 用**默认 opus、别指定 sonnet**（401）。

## 承重墙与命门（实现必看）
- **删除是结构操作、豁免「propose→按块确认」红线**（D-V4-02）——别误以为删除要走 propose。只新增 deleteArtifact，既有三写方法/侧车/提议工具一行不动。
- 彻底删（决策 A1）：`rmSync` 侧车目录 + 容错删物化 .md（缺/无 filePath/被外删 → 静默跳过，D-V4-03）。
- 删的若正打开 → `close()` 清 selectedArtifactId；删后须刷新受管分组（丢已删项）。
- 仅用户可删（C1）——不给 AI delete 工具。

## 质量门禁（每卡全绿再下一卡）
`npm run test` + `node_modules/.bin/tsc --noEmit` + `npm run lint`；UI 卡走真浏览器（repo-vendored browser-e2e）。
**真浏览器 fixture 项目根须放允许根 `~/pi-cwd-<YYYYMMDD>/` 下**（否则文件 API 403、普通树空），断言前轮询等树就绪（冷编译慢）——见 `next-step-browser-e2e` 记忆。

## 红线（北极星不变量）
- 不改 pi 内核；受管机制层只新增 deleteArtifact、不改既有三写方法/侧车格式/提议工具。
- 纯文件无 DB；单用户。
- 新机制决策记 `../../docs/设计决策记录.md`（D-V4-NN，现到 D-V4-04）；用户拍板记 `../../docs/QA/开发/`。
- 每完成一卡即细粒度提交（`next-step-commit-per-task`）。
