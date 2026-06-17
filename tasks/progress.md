# Next-Step V1.1 进度看板

> vibe-coding 第 3 步·任务跟踪。规格真相源：`../docs/概要设计.md` + `../docs/详细设计.md`。
> 每完成一个模块：勾选 → 按详细设计验收要点自检 → 过质量门禁 → 更新所在区 README → 回写本页。

## 质量门禁（全绿才算完）

- `vitest`（单测）
- `node_modules/.bin/tsc --noEmit`（类型）
- `eslint`（风格）
- **UI 模块额外**：真浏览器验收（browser-e2e skill；SSR/hydration 与集成 bug 单测抓不到）

## 模块（共 8，按依赖批次）

### 批次 1（无依赖，可并行）

- [x] **M1 · agent-naming-fix** — [M1-naming.md](M1-naming.md)：删界面 UUID 路径泄漏，显真名。trivial；若先做 M4 则被覆盖
- [x] **M2 · chat-file-upload** — [M2-file-upload.md](M2-file-upload.md)：对话框选文本类文件 → 读字 → `<file>` 内联。纯前端
- [x] **M3 · file-panel-hint** — [M3-panel-hint.md](M3-panel-hint.md)：「右看改动 / 左逐块确认」视觉提示，不搬按钮
- [x] **M5 · session-agent-mapping** — [M5-session-map.md](M5-session-map.md)：⭐承重墙——领域层「会话 ↔ agent / 主对话」映射 + store + API
- [x] **M6 · project-homepage** — [M6-project-home.md](M6-project-home.md)：项目卡片墙首页，点进才入工作台

### 批次 2（依赖 M5）

- [x] **M7 · main-chat-and-sidebar** — [M7-main-chat-sidebar.md](M7-main-chat-sidebar.md)：主对话 + 按需起 agent 会话 + 左侧分组标签。依赖 M5（真浏览器 5.2/5.3/5.4/防串显 5 项 PASS）
- [x] **M4 · agent-manager-glass** — [M4-agent-glass.md](M4-agent-glass.md)：AgentManager 玻璃卡片重写 + 二级菜单现场改配置。独立 UI 重活，含 M1

### 批次 3（依赖 M5 + M7）

- [ ] **M8 · at-agent-transfer** — [M8-at-agent.md](M8-at-agent.md)：主对话 `@agent` 转交全历史+附件到该 agent 单独会话。依赖 M5 + M7

## 不开发的需求（已剔除）

- 功能#1（前端解析报告）：✅ 已交付 `前端界面深度解析报告.md`，非代码
- 功能#3（项目 + 全局 skills）：✅ 已双层验证具备，零开发
- 功能#5.6（Dispatch 去留）：保留不动，无模块

## lead 机制决策（已拍板 → `../docs/设计决策记录.md`）

1. M5 映射存盘 = `<cwd>/.pi/ns-session-map.json`（D-V1.1-01）
2. M6 项目首页 = 单页内按 `currentProjectId` 二选一渲染（D-V1.1-02）
3. M8 转交载荷 = `<context>` + `<file>` 内联、作目标会话首条消息（D-V1.1-03）

## 历史

V1 历史任务在 `tasks/v1-history/`（含 `decisions.md` 决策表）。
V1.1 决策可沿其编号风格续记（如 `D-V1.1-01`），便于回溯找 bug。
