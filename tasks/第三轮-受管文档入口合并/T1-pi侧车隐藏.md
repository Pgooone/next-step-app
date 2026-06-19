# T1 · .pi 侧车隐藏（约束④）

> 批次 1，无依赖（先做）。详见 `../../docs/第三轮-受管文档入口合并/详细设计.md` · §五 T1 + ADR D-V3-07。

## 目标
让左栏文件树不再露出 `.pi` 侧车目录（versions/pending 裸 JSON）。

## AC
- [ ] `app/api/files/[...path]/route.ts` 的 `IGNORED_NAMES`（:6-10）新增精确字面量 `".pi"`（非 `"pi"`/不带斜杠）+ 一行注释说明 .pi = Next-Step 侧车内部目录（agents/dispatch/artifacts/managed/session-map）。
- [ ] 唯一接线点 = type=list 过滤（:485）；确认 read/meta/watch 分支**不查** IGNORED_NAMES → 派发产物经 type=read 读 `.pi` 仍正常（不回归）。
- [ ] 门禁绿（lint + test + tsc）。
- [ ] **不搭 route 级单测**（D-V3-07：全仓无 files route 既有测试、搭脚手架不划算）；靠 T4 真浏览器验「树里无 .pi + 派发产物仍可开」。

## 注意
既有 `IGNORED_NAMES` 里 `".git"` 重复两次属无关冗余，**不动**（surgical changes）。改动面仅 1 文件 1 行。
