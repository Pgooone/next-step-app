import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ProjectRegistry } from "./project-registry";

/** Agent 的思考强度档位。权威类型见 docs/03。 */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"];

/**
 * 一个 Agent 档案 = 一份可派发的角色配置。权威类型见 docs/03:13-24。
 * agentMdPath / memoryPath 为相对 projectRoot 的路径（D-20），指向三件套中的两件。
 */
export type AgentProfile = {
  id: string; // uuid
  projectId: string;
  name: string;
  role: string;
  model: string;
  skills: string[];
  tools: string[];
  thinkingLevel: ThinkingLevel;
  agentMdPath: string; // 相对 projectRoot，如 .pi/agents/<id>/agent.md
  memoryPath: string; // 相对 projectRoot，如 .pi/agents/<id>/memory.md
};

/** 领域错误：code 由 API 层映射为 HTTP 状态（NOT_FOUND→404 / INVALID→422）。 */
export class AgentProfileError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "AgentProfileError";
  }
}

/** create / update 的可写字段（白名单；id / projectId / path 字段不可由调用方设置）。 */
type AgentProfileInput = {
  name: string;
  role?: string;
  model?: string;
  skills?: string[];
  tools?: string[];
  thinkingLevel?: ThinkingLevel;
};

/**
 * Agent 档案存储：档案随项目落盘到 `<projectRoot>/.pi/agents/<id>/`，
 * 每个 agent 三件套 = agent.json（结构化真相源，D-21）+ agent.md + memory.md。
 * projectRoot 经注入的 ProjectRegistry 反查（project 不存在时 registry 抛 NOT_FOUND）。
 */
export class AgentProfileStore {
  constructor(private readonly registry: ProjectRegistry = new ProjectRegistry()) {}

  /** `<projectRoot>/.pi/agents`；registry.get 在 project 不存在时抛 ProjectError NOT_FOUND。 */
  private agentsDir(projectId: string): string {
    return join(this.registry.get(projectId).root, ".pi", "agents");
  }

  list(projectId: string): AgentProfile[] {
    const dir = this.agentsDir(projectId);
    if (!existsSync(dir)) return [];
    const profiles: AgentProfile[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jsonPath = join(dir, entry.name, "agent.json");
      if (!existsSync(jsonPath)) continue;
      profiles.push(this.readProfile(jsonPath));
    }
    return profiles;
  }

  get(projectId: string, agentId: string): AgentProfile {
    const jsonPath = join(this.agentsDir(projectId), agentId, "agent.json");
    if (!existsSync(jsonPath)) {
      throw new AgentProfileError("NOT_FOUND", `Agent 档案不存在: ${agentId}`);
    }
    return this.readProfile(jsonPath);
  }

  create(projectId: string, input: AgentProfileInput): AgentProfile {
    const name = (input.name ?? "").trim();
    if (!name) throw new AgentProfileError("INVALID", "name 不能为空");

    const thinkingLevel = input.thinkingLevel ?? "off";
    if (!THINKING_LEVELS.includes(thinkingLevel)) {
      throw new AgentProfileError("INVALID", `非法 thinkingLevel: ${thinkingLevel}`);
    }

    if (this.list(projectId).some((a) => a.name === name)) {
      throw new AgentProfileError("INVALID", `Agent 重名: ${name}`);
    }

    const id = randomUUID();
    const profile: AgentProfile = {
      id,
      projectId,
      name,
      role: input.role ?? "",
      model: input.model ?? "",
      skills: input.skills ?? [],
      tools: input.tools ?? [],
      thinkingLevel,
      agentMdPath: join(".pi", "agents", id, "agent.md"),
      memoryPath: join(".pi", "agents", id, "memory.md"),
    };

    const projectRoot = this.registry.get(projectId).root;
    const agentDir = join(projectRoot, ".pi", "agents", id);
    mkdirSync(agentDir, { recursive: true });
    this.atomicWrite(join(agentDir, "agent.json"), `${JSON.stringify(profile, null, 2)}\n`);
    // agent.md 骨架 + 空 memory.md（内容不内联进 agent.json，D-21）
    writeFileSync(join(agentDir, "agent.md"), `# ${name}\n\n${profile.role}\n`, "utf-8");
    writeFileSync(join(agentDir, "memory.md"), "", "utf-8");
    return profile;
  }

  update(projectId: string, agentId: string, patch: Partial<AgentProfileInput>): AgentProfile {
    const current = this.get(projectId, agentId);
    const next: AgentProfile = { ...current };

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new AgentProfileError("INVALID", "name 不能为空");
      if (this.list(projectId).some((a) => a.id !== agentId && a.name === name)) {
        throw new AgentProfileError("INVALID", `Agent 重名: ${name}`);
      }
      next.name = name;
    }
    if (patch.role !== undefined) next.role = patch.role;
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.skills !== undefined) next.skills = patch.skills;
    if (patch.tools !== undefined) next.tools = patch.tools;
    if (patch.thinkingLevel !== undefined) {
      if (!THINKING_LEVELS.includes(patch.thinkingLevel)) {
        throw new AgentProfileError("INVALID", `非法 thinkingLevel: ${patch.thinkingLevel}`);
      }
      next.thinkingLevel = patch.thinkingLevel;
    }

    const jsonPath = join(this.agentsDir(projectId), agentId, "agent.json");
    this.atomicWrite(jsonPath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  /** 删 agent = 删整个 `<root>/.pi/agents/<id>/` 目录（D-19，agent 目录是工具生成的内部资产）。 */
  remove(projectId: string, agentId: string): void {
    const agentDir = join(this.agentsDir(projectId), agentId);
    if (!existsSync(agentDir)) {
      throw new AgentProfileError("NOT_FOUND", `Agent 档案不存在: ${agentId}`);
    }
    rmSync(agentDir, { recursive: true, force: true });
  }

  private readProfile(jsonPath: string): AgentProfile {
    const raw = readFileSync(jsonPath, "utf-8");
    try {
      return JSON.parse(raw) as AgentProfile;
    } catch {
      throw new AgentProfileError("INVALID", `agent.json 解析失败: ${jsonPath}`);
    }
  }

  /** 「临时文件 + rename」原子落盘（仿 project-registry.ts writeAll）。 */
  private atomicWrite(filePath: string, content: string): void {
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, filePath);
  }
}
