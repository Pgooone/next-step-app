# 项目内 skill 识别 —— `.claude/skills` 纳入决策（2026-06-20）

## 背景
用户报 bug：Skills 按钮的二级菜单看不到「项目内的 skill」，且要能区分全局 / 项目。

ultracode 六 Agent 排查 + 对抗式证伪坐实根因：pi 内核 `DefaultResourceLoader`
默认只扫 `<cwd>/.pi/skills`（项目）与 `~/.pi/agent/skills`（全局），**从不扫
`.claude/skills`**；而用户的 skill 全在 `.claude/skills`（项目根 + 家目录），交集
为空 → 项目 skill 看不到。「之前修复过」实为误记——功能#3 当年只做真浏览器验证
判「零开发」，从未落地任何代码。（详见 memory `next-step-skill-discovery-rootcause`；
同轮顺带复核纠正「propose_edit 不存在」误判，见 `next-step-propose-edit-session-scope`。）

## 决策 1 · Skills 面板该扫哪些目录？
- **选项 A（推荐 / 最终选）**：额外扫 `.claude/skills`——项目级 `<cwd>/.claude/skills`
  标「项目」、全局级 `~/.claude/skills` 标「全局」。改 `/api/skills` 传内核公开选项
  `additionalSkillPaths`，不碰内核（红线）；用户现有 skill 立即可见。
- 选项 B：维持 pi 原生 `.pi/skills` 约定，只修正写错的安装路径文案。
- 选项 C：两者并集都扫。
- **最终选择：A**（用户拍板）。

## 决策 2 · 生效范围：只显示，还是 agent 也真加载？
- 选项 A：只改显示层（面板可见即可）。
- **选项 B（最终选）**：可见 + agent 真加载。
- **最终选择：B**（用户拍板）。注入层 plumbing 早已就绪（`assembleProfileSessionOptions`
  / `runWorker` 一直接受 `additionalSkillPaths`，只是从未被喂值），只需在 profile 会话
  路由（`.../agents/[agentId]/session`）与 dispatch 路由喂入 `claudeSkillDirs(projectRoot)`；
  agent 仍按 `profile.skills`（按名字）过滤，故「可选 → 真加载」由 AgentManager 勾选驱动
  （AgentManager 也走 `/api/skills`，故 `.claude` skill 自动出现在可选列表）。

## 谁拍
用户（DeliciousOnewba），2026-06-20，经 AskUserQuestion 两问拍板。

## lead 实现级取舍
见 [`../../设计决策记录.md`](../../设计决策记录.md) **D-SKILL-01~04**
（只传内核公开选项不碰内核 / 路由边界算目录+按前缀重标 scope / 两注入点 / 文案修正）。

## 验收
- 门禁：`eslint .` clean、`vitest run` 341 全绿（含 +5 新单测）、`tsc --noEmit` clean。
- 活 API：`GET /api/skills?cwd=<fixture>` 返回 5 skill，项目 `.claude/skills` 标 project、
  全局 `.claude/skills` + `~/.pi/agent/skills` 标 user。
- 真浏览器：新建项目放入 `proj-demo-skill` → Skills 面板 **PROJECT** 组显示该 skill、
  **GLOBAL** 组显示 `.claude/skills` 全局技能 + 原生 `seed-session-lock-cwd`，pageErrors=[]。
