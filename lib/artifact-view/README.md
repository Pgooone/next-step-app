# lib/artifact-view（产物面板渲染纯函数 · D3）

> 归属：Next-Step 新增（Iter D·D3）。　规格：`../../next-step/docs/05-features-功能清单.md` §5.4

## 作用
ArtifactPanel（`components/ArtifactPanel.tsx`）渲染所依赖的**纯函数**：TOC 解析、
pending 块就近锚定、降级判定。与 React / DOM 解耦，单独抽出以便 vitest 单测（`lib/**`），
组件层只做 JSX 与样式。**纯渲染辅助**，不做 resolve / 写盘 / 版本（那些是 D4 / §5.5 / §5.6）。

## 关键模块
- `toc.ts` — `parseToc(content)` 扫 ATX 标题产出 `{level,text,slug}[]`（跳过围栏代码块、slug 去重）；
  `slugify` 保中文/字母数字。供 TOC 渲染与标题锚点跳转（AC①）。
- `anchor.ts` — `buildSegments(content, pendingBlocks)` 把 pending 块用**子序列匹配**就近锚定到
  裸文本行，切成有序的 plain / hl 渲染段（add 用 lines 锚定、mod 透出 oldLines、del 就近插入）；
  `findSubsequence` 为底层查找；锚不到的块收进 `unaligned` 供提示切并排 Diff（AC②③）。
- `degrade.ts` — `INLINE_HL_LIMIT=25` + `shouldDegradeToDiff(count)`（`>` 阈值才降级）+
  `countPendingBlocks(blocks)`（只数 state==="pending"）。块数超限时面板自动切并排 Diff（AC④）。

## 约定 / 红线
- 纯函数、无副作用、不 import React / DOM；输入 / 输出可完全单测。
- 数据类型复用 `lib/domain/pending-change-service` 的 `DiffBlock`（不另定义）。
- 锚定语义移植自 sf-mini `InlineHighlightView`（只读参考、不跨项目 import）；
  **适配点**：本项目 artifact 与 DiffBlock.lines 都是裸行（无 `"+ "/"- "` 前缀）。

## 改这个区前
先读 §5.4 AC（渲染判定）与 `pending-change-service.ts` 的 `DiffBlock` 类型。
