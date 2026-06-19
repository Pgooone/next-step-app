import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import type { Skill } from "@earendil-works/pi-coding-agent";

/**
 * pi 内核默认只扫两类技能目录：项目 `<cwd>/.pi/skills`、全局 `~/.pi/agent/skills`。
 * Next-Step 把下列**实际存在**的目录作为内核公开选项 `additionalSkillPaths` 补进扫描
 * （只传公开选项、不 fork 内核——红线）：
 *   - `<cwd>/.pi/agent/skills` —— 项目级 `.pi/agent/skills`（与全局 `~/.pi/agent/skills` 对称）。
 *     用户定义的「项目 skill」= `<cwd>/.pi/skills`（内核已扫）+ `<cwd>/.pi/agent/skills`（此处补），
 *     故经 {@link retagProjectSkills} 重标 scope=project，与原生项目 skill 同组。
 *   - `<cwd>/.claude/skills` + `~/.claude/skills` —— Claude Code 的 skill 目录，**非 pi 项目 skill**，
 *     仅作额外来源纳入（不重标 → 落前端「path」组），多一处技能来源而已。
 *
 * 消费方：显示层 `/api/skills`（SkillsConfig + AgentManager 列表）、注入层
 * `startProfileSession` / `runDispatch`（agent 按 `profile.skills` 过滤后真加载）。
 */
export function extraSkillDirs(cwd: string): string[] {
  const dirs = [
    join(cwd, ".pi", "agent", "skills"),
    join(cwd, ".claude", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  return Array.from(new Set(dirs)).filter((d) => existsSync(d));
}

function isUnder(filePath: string, dir: string): boolean {
  return filePath === dir || filePath.startsWith(dir + sep);
}

/**
 * `<cwd>/.pi/agent/skills` 经 `additionalSkillPaths` 进来时 scope 不会是 project（不在 `<cwd>/.pi/skills` 下）。
 * 按用户定义它属「项目 skill」，按路径前缀重标 scope=project，与原生 `<cwd>/.pi/skills` 同归「项目」组。
 *
 * `.claude/skills` **不重标**——它是额外来源、非项目 skill，保留其自然分组（落前端「path」组）。
 * 只改展示用 `sourceInfo.scope`、不动 `skill.name`，不影响档案技能过滤/注入；未命中者引用相等原样返回。
 */
export function retagProjectSkills(skills: Skill[], cwd: string): Skill[] {
  const projectAgentDir = join(cwd, ".pi", "agent", "skills");
  return skills.map((s) =>
    isUnder(s.filePath, projectAgentDir)
      ? { ...s, sourceInfo: { ...s.sourceInfo, scope: "project" } }
      : s,
  );
}
