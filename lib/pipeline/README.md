# lib/pipeline（阶段看板视觉纯函数）

> 归属：Next-Step 新增（第七轮）。　规格：`../../docs/V1.2/第七轮-流水线与阶段看板/`

## 作用
第七轮阶段看板的**视觉纯函数工具**。中性叶子模块：**无 `"use client"`、无 server-only 依赖、不碰 node:fs**，
client / server 皆可直接 import（D-R7B-07：任何经 `"use client"` 链拖入 node:fs 都会全站 500，故这里只放纯函数）。

## 关键模块
- `dot-matrix.ts` — 阶段点阵的纯算法 + 阶段状态 → 离散进度映射（`clamp01` / `filledCols` 等）；3×12 = 36 块。
- `avatar.ts` — 由稳定 seed（agentId）生成确定性 dicebear `notionists` 头像，返回内联 `data:` URI（断网可渲染、零网络请求；依赖 `@dicebear/*@9`，勿升 core@10——要求 node>=22 与本项目 engines 冲突）。
- `status-meta.ts` — 派发 / 阶段状态的徽章配色（`STATUS_META` 纯对象，配色用基座 `var(--...)`）。

## 改这个区前
保持纯函数、零运行时 import；视觉规格见 `../../docs/V1.2/第七轮-流水线与阶段看板/`。
