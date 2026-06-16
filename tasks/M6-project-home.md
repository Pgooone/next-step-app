# M6 · project-homepage（功能#5.1）

独立项目首页：项目卡片墙（增删项目），点进才入工作台。批次 1，无依赖（复用现成项目 API）。
详见 详细设计.md · M6。

- [ ] 读 `app/page.tsx`（入口）+ `components/AppShell.tsx` + `lib/stores/useProjectStore` + `/api/projects`（已就绪）
- [ ] 入口分流：`app/page.tsx` 按 `currentProjectId` 二选一渲染——未选 → `ProjectHome`，选中 → 现有 `AppShell`（单页内切换，不引入多路由）
- [ ] 新建 `components/ProjectHome.tsx`：参考 pi-web 风格项目卡片墙，每卡显示项目名 + 路径 + 最近活动
- [ ] 操作：新建（名称+路径）、删除（二次确认，提示仅移除注册不删磁盘）、点击进工作台
- [ ] 删项目只移除注册、不删 `.pi/` 数据；重加同 `cwd` 即恢复（本地单用户下是特性非泄漏，删除二次确认文案点明）
- [ ] 工作台内保留「回到项目墙」入口（清 `currentProjectId`）
- [ ] 写/补单测（入口分流逻辑、ProjectHome 增删走 useProjectStore）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：打开应用先见项目墙；可增删项目；点项目进工作台；可切回项目墙（browser-e2e）
- [ ] 决策点：单页内按 `currentProjectId` 二选一渲染、不加新路由（已定 D-V1.1-02，见 `docs/设计决策记录.md`）→ 记入 `docs/设计决策记录.md`
