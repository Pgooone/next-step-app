import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Skill } from "@earendil-works/pi-coding-agent";
import { extraSkillDirs, retagProjectSkills } from "./extra-skill-dirs";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "ns-extra-skills-"));
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

describe("extraSkillDirs", () => {
  it("收录存在的项目级 .pi/agent/skills", () => {
    const cwd = tmpProject();
    try {
      mkdirSync(join(cwd, ".pi", "agent", "skills"), { recursive: true });
      expect(extraSkillDirs(cwd)).toContain(join(cwd, ".pi", "agent", "skills"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("收录存在的项目级 .claude/skills（额外来源）", () => {
    const cwd = tmpProject();
    try {
      mkdirSync(join(cwd, ".claude", "skills"), { recursive: true });
      expect(extraSkillDirs(cwd)).toContain(join(cwd, ".claude", "skills"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("缺失目录不收录", () => {
    const cwd = tmpProject();
    try {
      expect(extraSkillDirs(cwd)).not.toContain(join(cwd, ".pi", "agent", "skills"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("retagProjectSkills", () => {
  const cwd = "/proj";

  it("项目级 .pi/agent/skills 重标为 project", () => {
    const s = fakeSkill(join(cwd, ".pi", "agent", "skills", "foo", "SKILL.md"));
    expect(retagProjectSkills([s], cwd)[0].sourceInfo.scope).toBe("project");
  });

  it(".claude/skills 不重标（额外来源、引用相等原样返回）", () => {
    const s = fakeSkill(join(cwd, ".claude", "skills", "bar", "SKILL.md"));
    const out = retagProjectSkills([s], cwd)[0];
    expect(out).toBe(s);
    expect(out.sourceInfo.scope).toBe("temporary");
  });

  it("原生 .pi/skills 等其它路径原样返回（引用相等）", () => {
    const s = fakeSkill(join(cwd, ".pi", "skills", "baz", "SKILL.md"));
    s.sourceInfo.scope = "project";
    expect(retagProjectSkills([s], cwd)[0]).toBe(s);
  });
});
