# M1 · agent-naming-fix（bug#1）

修界面暴露 UUID 路径，改为显示 agent 真名。批次 1，无依赖，trivial 小修。
详见 详细设计.md · M1。

> 注：若决定先做 M4（玻璃感重做），M4 会自然覆盖本模块，可不单列。独立做时走下面清单。

- [ ] 读 `components/AgentManager.tsx`：删除确认 `:503` 已显真名 `{p.name}`（保留不动）；唯一可见 UUID 泄漏在 `:506` 文案里的 `.pi/agents/{p.id}/` 路径片段
- [ ] 移除 `:506` 文案中的 `.pi/agents/{p.id}/` 路径片段（保留「将删除其档案目录、不可恢复」语义），保留已有 `{p.name}`
- [ ] 全文件扫一遍，确认其它用户可见处无 UUID 路径泄漏
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：打开 AgentManager，触发删除确认，确认显示真名而非 UUID（browser-e2e）
- [ ] 不做：不改 `.pi/agents/<id>` 的 UUID 落盘命名（D-19/20/21 既定）
