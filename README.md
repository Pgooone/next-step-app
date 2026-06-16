# next-step-app

> 🔗 **本仓库是 Next-Step —— 基于开源项目 pi-web 打造的「多 Agent 软件工厂」本地工具。** 在 pi-web 的「真 Agent 内核 + Web UI」之上叠加「项目 / 多 Agent / 派发 / 产物 Diff·版本·HITL」领域层；**pi 内核不 fork**，只做封装与 surgical 改造。便于溯源。

Next-Step 的**实现仓库**：在 pi-web 基座之上叠加「项目 / 多 Agent / 派发 / 产物 Diff·版本·HITL」领域层。

- 规格 / 文档（真相源）：`../docs/`（V1 规格 00–09；先读 `00-overview-总览.md`）
- 仓库**以 pi-web 基座为起点**（已整体复制进来），在其上做 surgical 改造；pi 内核不 fork。

## 版本

- **V1 = `v1.0.0`**（本 release）：Iter A / B / C / D 全部里程碑完成（项目工作区 / 多 Agent 档案 / 派发协作 / 产物 Diff·版本·HITL）。全部 40 个提交见 `COMMIT-HISTORY.md`。
- **V1.1（迭代中）**：在 `v1.1` 分支上继续，将出 `v1.1.0` release。

## 怎么跑

```bash
npm install
npm run dev     # 端口 30141
npm run build
npm run test    # vitest
npm run lint
```

## 代码地图：pi-web 基座 vs Next-Step 新增

> 改代码前先判断它属于哪边。**基座** = 复用 pi-web，非必要不改（改了要在下方「被改动过的基座文件」登记）；**新增** = Next-Step 自己的领域代码。

**pi-web 基座（复用，改前先确认）**
- `lib/` 根：`rpc-manager` / `session-reader` / `pi-types` / `types` / `agent-client` / `normalize` / `file-paths` / `npx`
- `app/api/`：`agent` · `sessions` · `skills` · `models` · `models-config` · `auth` · `files` · `cwd` · `default-cwd` · `home`
- `components/`：`AppShell` · `ChatWindow` · `ChatInput` · `MessageView` · `ToolPanel` · `SessionSidebar` · `TabBar` · `FileExplorer` · `FileViewer` · `MarkdownBody` · `SkillsConfig` · `ModelsConfig` · `BranchNavigator` · `ChatMinimap` · `FileIcons`
- `hooks/`：`useAgentSession` · `useTheme` · `useDragDrop` · `useAudio`
- `bin/` · `AGENTS.md` · 各配置文件

**Next-Step 新增**（每区有自己的 README）
- `lib/domain/`：领域逻辑（project-registry；后续 agent-profile / orchestrator / artifact）
- `lib/stores/`：Zustand 状态（useProjectStore；后续 agent / dispatch / artifact）
- `lib/api/`：HTTP 辅助（errors）
- `lib/env/`：环境自检（doctor-checks，被 doctor CLI 与 /api/health 复用）
- `lib/pi/`：（后续 D2）内核封装 / 工具拦截层
- `app/api/`：`projects` · `health` · `projects/[id]/agents`（后续 `dispatch` / `artifacts`）
- `scripts/`：`doctor` CLI（`npm run doctor` / predev）
- `components/`：`ProjectSwitcher`（后续 `ArtifactPanel` / `PendingChangeCard` / `AgentManager` / `DispatchPanel`）

**被改动过的基座文件**（带 Next-Step 触点）
- `app/layout.tsx`：metadata title/description 改为 Next-Step 品牌
- `components/AppShell.tsx`：注入 `ProjectSwitcher`（headerSlot）+ `currentRoot` 进 selectedCwd（A2）；首屏凭证 banner + `/api/health` fetch（A3）
- `components/SessionSidebar.tsx`：新增可选 `headerSlot` prop

## 开发约定：区 README

每个 Next-Step 新增「逻辑区」配一份**薄** README（定位 / 归属 / 关键模块 / 红线 / 去哪看 spec），
让开发者与 coding agent 进区即懂、少做探查。规则：

- **每区一份，不是每文件一份**；纯 pi-web 基座目录不必逐个写。
- 只放**稳定信息**（定位 / 归属 / 红线 / spec 指针）；**不写**数据模型、AC、行号——这些在 `../next-step/docs/`，README 只链接，避免腐烂。
- 20–40 行封顶。
- **`app/api/**` 各路由目录不单独加 README**（API 路由是领域层的薄 HTTP 包装，契约在 `docs/04` + 对应领域区 README）。见决策 D-23。
- **DoD**：每张任务卡改 / 建某区代码，顺手更新该区 README。

## 进度（V1 收官）

V1 全部里程碑完成，详见 `tasks/`（看板 + 决策表 D-01~D-23）、`COMMIT-HISTORY.md`（全部提交）。D2 拦截可行性见 `spike/d2-intercept/`。

| 里程碑 | 状态 |
|---|---|
| 前置 · D2 拦截验证 | ✅ 可行（`noTools:builtin` 替换 write/edit，spike 11/11） |
| Iter A · 项目即工作区 | ✅ 完成 |
| Iter B · 多 Agent 可定义 | ✅ 完成 |
| Iter C · 多 Agent 协作派发 | ✅ 完成 |
| Iter D · 产物 Diff/版本/HITL（D1–D5） | ✅ 完成（收官 commit `52313d2`） |

> V1.1 迭代在 `v1.1` 分支进行（见 `../next-step-V1.1/`）。
