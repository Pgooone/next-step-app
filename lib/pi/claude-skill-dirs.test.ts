import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Skill } from "@earendil-works/pi-coding-agent";
import { claudeSkillDirs, retagClaudeSkillScope } from "./claude-skill-dirs";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "ns-claude-skills-"));
}

function fakeSkill(filePath: string): Skill {
  return {
    name: "x",
    description: "",
    filePath,
    baseDir: "",
    disableModelInvocation: false,
    sourceInfo: {
      path: filePath,
      source: "path",
      scope: "temporary",
      origin: "top-level",
    },
  };
}

describe("claudeSkillDirs", () => {
  it("收录存在的项目级 .claude/skills 目录", () => {
    const cwd = tmpProject();
    try {
      mkdirSync(join(cwd, ".claude", "skills"), { recursive: true });
      expect(claudeSkillDirs(cwd)).toContain(join(cwd, ".claude", "skills"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("项目无 .claude/skills 时不收录该项目目录", () => {
    const cwd = tmpProject();
    try {
      expect(claudeSkillDirs(cwd)).not.toContain(join(cwd, ".claude", "skills"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("retagClaudeSkillScope", () => {
  const cwd = "/proj";

  it("项目级 .claude/skills 重标为 project", () => {
    const s = fakeSkill(join(cwd, ".claude", "skills", "foo", "SKILL.md"));
    expect(retagClaudeSkillScope([s], cwd)[0].sourceInfo.scope).toBe("project");
  });

  it("全局 ~/.claude/skills 重标为 user（前端归「全局」组）", () => {
    const s = fakeSkill(join(homedir(), ".claude", "skills", "bar", "SKILL.md"));
    expect(retagClaudeSkillScope([s], cwd)[0].sourceInfo.scope).toBe("user");
  });

  it("原生 .pi/skills 等非 .claude 路径原样返回（引用相等）", () => {
    const s = fakeSkill(join(cwd, ".pi", "skills", "baz", "SKILL.md"));
    s.sourceInfo.scope = "project";
    const out = retagClaudeSkillScope([s], cwd)[0];
    expect(out).toBe(s);
    expect(out.sourceInfo.scope).toBe("project");
  });
});
