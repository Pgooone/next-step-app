# M4 · agent-manager-glass（外观#1）

AgentManager 视图重写：正方形玻璃卡片 + 卡片即菜单（二级菜单现场改配置）+ 去编辑按钮。
底层 `useAgentStore`（create/update/remove/startSession）**不动**。批次 2（独立 UI 重活）。
详见 详细设计.md · M4。**含 M1**（卡片直接显真名）。

- [ ] 读 `components/AgentManager.tsx`（现 list/form/confirm 多区）与 `app/globals.css`，摸清 `useAgentStore` 接口与现编辑表单字段

**阶段 A（卡片网格 + 玻璃感 + 一级展示 + testid，可验收骨架）**
- [ ] 列表改正方形卡片网格（`display:grid` + 卡片 `aspect-ratio:1`）
- [ ] 卡片（一级菜单）：只显真名 + 极简标识（首字母/色块）；玻璃感 `rgba(...)` + `backdrop-filter: blur(...)`，深 `rgba(20,20,24,0.6)` / 浅 `rgba(255,255,255,0.6)` 两套
- [ ] **必做**：同步 E2E 依赖的 `data-testid`（`agent-manager` / `agent-new-btn` / `agent-item`）
- [ ] 阶段 A 自检：卡片网格 + 玻璃感渲染、深浅色可读、testid 命中（骨架可单独真浏览器验收）

**阶段 B（二级菜单现场改配置 + 起会话/删除/新建）**
- [ ] 点击卡片就地展开二级菜单（翻面/浮层）：模型 / 技能 / 工具 / 思考强度可现场改并保存（复用现表单字段，走 `useAgentStore.update`）
- [ ] 二级菜单含「起会话」（行内输入开场白 → `startSession`）、「删除」（二次确认显真名，覆盖 M1）
- [ ] 去掉独立「编辑」按钮（配置改在二级菜单）
- [ ] 新建入口：网格里「+」空卡片 → 新建表单（名称/角色必填 + 配置）

- [ ] 写/补单测（视图层；store 不动无需改其测）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：卡片网格 + 玻璃感；二级菜单现场改并保存生效；无独立编辑按钮；起会话/删除/新建可用；深浅色可读；testid 仍命中（browser-e2e）
