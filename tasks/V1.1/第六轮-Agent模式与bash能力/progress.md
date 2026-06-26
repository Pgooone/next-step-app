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
- [x] **提交** · `99f8917`（实现）+ `089471d`（归类第六轮）。已 push origin v1.1/master（四引用同步）。
- [x] **文档归类第六轮** · 本目录 + `docs/第六轮-Agent模式与bash能力/详细设计.md` + README/CLAUDE 索引同步。
- [x] **补丁 D-MODE-05 · 编码型空 tools 退回全套编码工具** —— 用户复测发现「选编码型但没勾工具 → agent 说检查不到任何工具(`(none)`)」。ultracode 7-agent + node 实证根因=空数组 `tools:[]` 被内核当零工具(≠undefined 默认全套)、与主对话不一致。双层修复：wiring(coding+空 tools→退回全套 CODING_TOOL_NAMES 含 bash，救现有 agent) + UI(切编码型自动全选)；CODING_TOOL_NAMES 提中性 `lib/pi/coding-tools.ts` 单一真相源(lib 内相对导入)。+1 单测、lint+test(374) 全绿、真浏览器双层 PASS(API 造空 tools agent bash 真跑 + UI 自动勾选 7 工具)。详见详细设计 §八 + ADR D-MODE-05。
- [x] **补丁 D-MODE-04 · 改 mode 即时生效到存活会话（方案B）** —— 用户复测发现「改 mode 只对新会话生效、同一存活会话仍用旧工具集（coding 改 doc 后 bash 仍可用）」。ultracode 8-agent 调查 + 3 条对抗校验确证 go（逐出后 re-attach 现读磁盘 agent.json、按新 mode 重建）。落点：`session-agent-map` 加 `sessionsForAgent` 反查 + 新 `lib/pi/evict-agent-sessions.ts`（含流式 abort 守卫、DI 可单测）+ PATCH 路由接线（仅 mode 变化逐出、只删 registry 不碰 map）。+8 单测、lint+test(373) 全绿、**真浏览器往返双层 PASS**（同会话 coding→doc bash 即失效→改回 coding 即恢复、jsonl 铁证、pageErrors=0）。详见详细设计 §七 + ADR D-MODE-04。

> 注：本轮缺陷驱动、直做（investigate→implement→verify），非先出三件套。QA 索引 #12 条目与用户的「通用多Agent配置」WIP 同留在 `00-索引.md` 未提交。
