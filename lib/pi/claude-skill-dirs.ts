import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import type { Skill } from "@earendil-works/pi-coding-agent";

/**
 * Next-Step 把 Claude Code 约定目录 `.claude/skills` 纳入 pi 的技能发现。
 *
 * pi 内核 `DefaultResourceLoader` 默认只扫 `<cwd>/.pi/skills`（项目）和
 * `~/.pi/agent/skills`（全局），**不认 `.claude/skills`**；而用户的 skill 多放在
 * 后者。把下列**实际存在**的目录作为内核公开选项 `additionalSkillPaths` 喂给
 * loader / 会话，即可被发现——只用内核公开 API、不 fork 内核（红线）：
 *   - 项目级 `<cwd>/.claude/skills`
 *   - 全局级 `~/.claude/skills`
 *
 * 消费方：显示层 `/api/skills`（SkillsConfig / AgentManager 列表）、注入层
 * `startProfileSession` / `runDispatch`（agent 按 `profile.skills` 过滤后真加载）。
 */
export function claudeSkillDirs(cwd: string): string[] {
  const dirs = [
    join(cwd, ".claude", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  return Array.from(new Set(dirs)).filter((d) => existsSync(d));
}

function isUnder(filePath: string, dir: string): boolean {
  return filePath === dir || filePath.startsWith(dir + sep);
}

/**
 * `.claude/skills` 经 `additionalSkillPaths` 被内核加载时，其 `sourceInfo.scope`
 * 不会是 project/user（既不在 `.pi/skills` 也不在 `~/.pi/agent/skills` 下）。这里按
 * 路径前缀把它们重标为 project / user，使前端 `sourceLabel` 把项目级 `.claude/skills`
 * 归「项目」组、全局级归「全局」组，与原生 `.pi/skills` / `~/.pi/agent/skills` 一致。
 *
 * 只改展示用的 `sourceInfo.scope`，不动 `skill.name`，因此不影响档案技能过滤 / 注入。
 * 未命中 `.claude/skills` 的 skill 原样返回（含引用相等，不做无谓克隆）。
 */
export function retagClaudeSkillScope(skills: Skill[], cwd: string): Skill[] {
  const projectDir = join(cwd, ".claude", "skills");
  const userDir = join(homedir(), ".claude", "skills");
  return skills.map((s) => {
    if (isUnder(s.filePath, projectDir))
      return { ...s, sourceInfo: { ...s.sourceInfo, scope: "project" } };
    if (isUnder(s.filePath, userDir))
      return { ...s, sourceInfo: { ...s.sourceInfo, scope: "user" } };
    return s;
  });
}
