# 第六轮 · Agent 模式（doc/coding）—— 进度

详细设计 `docs/第六轮-Agent模式与bash能力/详细设计.md` ｜ 决策 QA `docs/QA/开发/agent模式-bash能力决策.md` ｜ ADR `docs/设计决策记录.md` D-MODE-01~03
范围：profile 会话工具集按 mode 分流 + 档案 mode 字段 + AgentManager UI。不碰内核 / doc-session 白名单 / 主对话 / dispatch（后两者本就带 bash）。

- [x] **调查 + 复现**（ultracode 8 agent 对抗校验 + 真浏览器 + DeepSeek 真实对话）—— 根因=profile-session-wiring spread 受限集覆盖 profile.tools；定性 by-design 红线 + UX 沉默陷阱；纠正：dispatch/主对话本就带 bash、缺口仅 profile 会话。详见 memory `next-step-bash-toolset-gap`。
- [x] **用户拍板**（AskUserQuestion 四选一）→ **方案A + UX 防呆**。记 `docs/QA/开发/agent模式-bash能力决策.md`。
- [x] **数据层** · `agent-profile-store` 加 `mode`（create 默认 doc / update 透传 / readProfile 归一化旧档案 / 非法抛 INVALID）+ 5 单测。
- [x] **接线层** · `profile-session-wiring` start + reattach 两处按 mode 分流（coding 跳过受限集→profile.tools 含 bash）+ 2 单测（coding 起会话/re-attach 含 bash、无提议工具）。
- [x] **API** · agents POST/PATCH 透传 mode。
- [x] **前端** · useAgentStore 加 mode；AgentManager 模式选择器 + 工具区防呆（doc 置灰禁用 + 提示、coding 红字警告）。
- [x] **门禁** · lint 干净 + test 365（+7、零回归；doctor-checks 环境性 flaky 单独跑过）。
- [x] **真浏览器双层验收 PASS** · 模式切换/bash 勾选/doc 置灰/持久化 mode=coding/**DeepSeek 真跑 bash 输出 NEXTSTEP_BASH_OK**（对比修复前 Tool bash not found）；截图归 `验收截图-agent模式bash能力/`。
- [x] **提交** · `99f8917`（v1.1，10 文件 +273/-24）。**未 push**（待用户）。
- [x] **文档归类第六轮** · 本目录 + `docs/第六轮-Agent模式与bash能力/详细设计.md` + README/CLAUDE 索引同步。

> 注：本轮缺陷驱动、直做（investigate→implement→verify），非先出三件套。QA 索引 #12 条目与用户的「通用多Agent配置」WIP 同留在 `00-索引.md` 未提交。
