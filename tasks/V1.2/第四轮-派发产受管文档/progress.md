# V1.2 第四轮 · 让文档型派发也能产受管文档 —— 任务进度

> 设计见 `docs/V1.2/第四轮-派发产受管文档/`；用户拍板 `docs/V1.2/QA/第四轮-派发产受管文档决策.md`（D-V1.2-19/20）；lead ADR `docs/V1.2/设计决策记录.md`（D-R4-01~08）。
> 实现 = ns-impl 串行；lead 每卡亲读 diff + 复跑门禁再 commit（不认队员自报告，进度以 git 实盘为准）。

| 卡 | 内容 | 状态 | commit |
|---|---|---|---|
| T1 | 承重墙 spike：dispatch doc worker 工具集在场性 + create_artifact id 从 agent_end.messages 抽取（含 fallback 决策门） | ✅ lead 复跑通过 | 探针，验完即删（无 commit） |
| T2 | 接入点：runWorker 按 mode 合并 dispatch doc 子集 + projectId 透传 + dispatch 专用受限集禁 propose_edit（合并原 T3） | ✅ | `3d1077b` |
| T4 | 产物对账：WorkerResult+artifactIds/createdContent、extractCreatedArtifactIds、orchestrator 回填/判空放宽/喂下游、Assignment.artifactId | ✅ | `dc0b4a6` |
| T5 | 展示层：进度弹窗产物 by-id 开 ArtifactPanel + 派发完成刷新 file panel 受管分组 | ✅ | `3c3d4c8` |
| T6 | 双层验收（逻辑层 lint/tsc/417 全绿 + 真浏览器端到端 lead 亲验）+ 收尾 chore + 文档回写 | ✅ | chore `209d1d3` + 本回写 |

## T6 验收摘要

- **逻辑层**：`npm run lint` 净 / `npx tsc --noEmit` **0 错误** / `npm test` **417/417 全绿（无 flake）**。
- **端到端（lead 真浏览器 chrome-devtools-mcp）**：CS2 项目派发产品经理 + 架构师两 doc worker →
  - 项目根 2 份真实受管 .md + `.pi/artifacts/managed/<id>/{artifact.json,versions/1.json}` ×2；
  - 两 assignment 回填 artifactId（`83304918` / `59cb7922`）；顺序流水线（架构师基于上游需求正文）；
  - 进度弹窗产物「受管文档」按钮 → by-id 开 ArtifactPanel（带 TOC/版本）；file panel 受管分组**自动**出现 2 份；
  - console **pageErrors=0**（客户端 bundle 未被 node:fs 污染）。
  - 证据截图：仓库根 `第四轮验收-dispatch产受管文档.png` / `第四轮验收-受管文档ArtifactPanel.png`（未入 git）。

## 收官前待办

1. **测试残留清理**：T6 真浏览器在 `~/cs2-skin-monitor` 造的 2 份受管文档 + 派发产物 + task/会话——收官前清理（删受管 .md + `.pi/artifacts/managed/*` + `.pi/dispatch/*` 或 registry 复位）。
2. **push**：4 个 commit（`3d1077b`/`dc0b4a6`/`3c3d4c8`/`209d1d3`）+ 本文档回写 commit，**待用户授权后** push origin/v1.2（+按惯例 ff master）。
3. **第二轮（未来）**：下游修订上游受管文档（propose_edit + HITL 后移：派发完成提示 N 处待确认、用户事后 UI 逐块确认）。
