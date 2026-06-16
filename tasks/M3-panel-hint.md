# M3 · file-panel-hint（功能#2）

加「右看改动 / 左逐块确认」分工视觉提示，**不搬按钮**。批次 1，无依赖。
详见 详细设计.md · M3。

- [ ] 读 `components/ArtifactPanel.tsx` 与 `components/PendingChangeCard.tsx`，定位「N 处待确认」与按块确认按钮位置
- [ ] `ArtifactPanel` 顶部「N 处待确认」旁加指引：`→ 在左侧对话框逐块确认`（带指向左侧小箭头）
- [ ] `PendingChangeCard` 顶部加文案：`改动全貌见右侧产物面板（按 D 看并排 Diff）`
- [ ] 实现说明（非验收）：两处宜用同一强调色呼应，建立「右看 / 左确认」心智
- [ ] 保留 D 键弹 Diff 联动，确认不被破坏
- [ ] 写/补单测（只断言可观测项：有待确认改动时左侧文案 + 右侧指引箭头均渲染、D 键联动不破）
- [ ] 跑质量门禁：`vitest` + `node_modules/.bin/tsc --noEmit` + `eslint` 全绿
- [ ] 真浏览器验收：造一处待确认改动，确认两侧提示同时出现、D 键联动正常（browser-e2e）
