/**
 * B2 —— 按 Agent 档案注入起会话的内核封装。
 *
 * 职责：把一份 {@link AgentProfile}（B1 落盘的角色配置）翻译成 `createAgentSession`
 * 可消费的「资源装配 + 运行时调整」，让派发出去的会话带上：
 *   1. 档案正文（agent.md）与只读记忆（memory.md）注入进 system prompt 头部；
 *   2. 按档案白名单过滤后的技能集；
 *   3. 档案指定的模型（解析失败则降级用内核默认，不阻断）；
 *   4. 档案的 thinkingLevel。
 *
 * 本模块只「封装」内核、不 fork 内核（红线）。所有持久注入都走内核原生的
 * `DefaultResourceLoader` 覆盖钩子，不去事后改 `session.state.systemPrompt`
 * ——后者会被内核 `_rebuildSystemPrompt` 在每次工具/模型变更时从 loader 重读覆盖。
 *
 * ── 与 B3（集成层）的边界（决策 D-27 / D-28）──────────────────────────
 * - 本模块不加任何 API 端点、不碰 `/api/agent/new`、不碰 `lib/rpc-manager.ts`。
 * - 本模块拥有两个真实可测函数：
 *     · {@link assembleProfileSessionOptions} —— 装配 loader + 选项，返回可展开进
 *       `createAgentSession(...)` 的 options（**调用方负责真正 new 会话**）；
 *     · {@link applyProfileRuntime} —— 会话建好后做模型查找/降级 + 设模型 + 设思考档。
 *   `createAgentSession` 调用本身绑定会话生命周期与 registry，留给调用方
 *   （B3 集成 + 本模块单测用 faux 驱动）。
 * - **空 tools 语义（D-28）**：profile.tools 为空数组时，仅表示「无编码工具」，
 *   **不**清空 system prompt（档案注入是 prompt 的核心价值，必须保留）。本模块
 *   通过 `tools` 选项收窄工具集，绝不触碰 rpc-manager.ts 里那条「空工具→清空
 *   systemPrompt」的旧分支（那条归 B3 在集成时回避）。
 *
 * ── 记忆只读语义 ─────────────────────────────────────────────────────
 * memory.md 仅作为只读上下文注入（`<agent_memory readonly>` 标签强化语义），
 * 本模块从不写回 memory.md；其缺失按空串处理（§5.2 边界）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DefaultResourceLoader,
  getAgentDir,
  type ResourceDiagnostic,
  type ResourceLoader,
  type SessionManager,
  type SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";

import type { AgentProfile } from "../domain/agent-profile-store";
import type { ModelLike } from "../pi-types";

/**
 * 读取档案三件套中的两份正文。
 * agentMdPath / memoryPath 是相对 projectRoot 的路径（D-20），此处 join 还原绝对路径。
 * 文件缺失一律按空串（§5.2「记忆文件缺失按空」），不抛错。
 */
export function readProfileDocs(
  projectRoot: string,
  profile: AgentProfile,
): { agentMd: string; memoryMd: string } {
  const read = (relPath: string): string => {
    const abs = join(projectRoot, relPath);
    return existsSync(abs) ? readFileSync(abs, "utf-8") : "";
  };
  return {
    agentMd: read(profile.agentMdPath),
    memoryMd: read(profile.memoryPath),
  };
}

/**
 * 把档案正文 + 记忆拼成注入块（用标签包裹，强化「档案 / 只读记忆」的语义）。
 * 两者皆空时返回空串——避免向 prompt 注入一对空标签。
 */
export function buildInjectionBlock(agentMd: string, memoryMd: string): string {
  const profileTrimmed = agentMd.trim();
  const memoryTrimmed = memoryMd.trim();
  if (!profileTrimmed && !memoryTrimmed) return "";

  const parts: string[] = [];
  if (profileTrimmed) {
    parts.push(`<agent_profile>\n${profileTrimmed}\n</agent_profile>`);
  }
  if (memoryTrimmed) {
    parts.push(`<agent_memory readonly>\n${memoryTrimmed}\n</agent_memory>`);
  }
  return parts.join("\n");
}

/**
 * 把档案的单字符串 model 解析为 `{ provider, modelId }`（D-25）。
 * - 按**首个** `/` 切分（modelId 自身可能含 `/`，如 openrouter 的 `vendor/model`）。
 * - 空串 / 无 `/` / 任一段为空 → 返回 null（交由调用方走默认模型降级，不抛错）。
 */
export function resolveModelSelector(
  model: string,
): { provider: string; modelId: string } | null {
  const trimmed = (model ?? "").trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null; // 无斜杠，或斜杠在首位（provider 为空）
  const provider = trimmed.slice(0, slash);
  const modelId = trimmed.slice(slash + 1);
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

/**
 * 构造一个携带「档案注入 + 技能过滤」的 {@link DefaultResourceLoader} 并完成首次加载。
 *
 * - 注入块经 `appendSystemPromptOverride` 排到 append 段**最前**（base 之后、
 *   project_context / skills 之前，由内核 system-prompt 拼接顺序决定，D-24）。
 *   injectionBlock 为空串时不挂该钩子，保持内核默认 append 行为。
 * - 技能经 `skillsOverride` 按 name 过滤：只保留 `skillNames` 列出的；列出但未被
 *   内核发现的 name 记入返回的 `missingSkills`（静默忽略，不抛错，D-26）。
 *   skillNames 为空时表示「不启用任何技能」→ 过滤为空集。
 *
 * 必须 `await loader.reload()` 后才能交给 `createAgentSession`（内核 sdk 范式）。
 */
export async function buildProfileResourceLoader(args: {
  cwd: string;
  agentDir: string;
  injectionBlock: string;
  skillNames: string[];
  settingsManager?: SettingsManager;
  /** 测试可注入额外技能目录（不受 project trust 影响地发现技能）。 */
  additionalSkillPaths?: string[];
}): Promise<{ loader: ResourceLoader; missingSkills: string[] }> {
  const { cwd, agentDir, injectionBlock, skillNames, settingsManager, additionalSkillPaths } = args;

  // 收窄到一个 Set 便于 O(1) 命中判断；同时用于计算 missing。
  const wanted = new Set(skillNames);
  const missingSkills: string[] = [];

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    additionalSkillPaths,
    // 注入块为空则不挂钩子（避免无谓改写内核默认 append）。
    ...(injectionBlock
      ? { appendSystemPromptOverride: (base: string[]) => [injectionBlock, ...base] }
      : {}),
    skillsOverride: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
      const discovered = new Set(base.skills.map((s) => s.name));
      // 档案要而内核没发现的 → 记 missing（一次性收集，后续 rebuild 不重复累加）。
      missingSkills.length = 0;
      for (const name of wanted) {
        if (!discovered.has(name)) missingSkills.push(name);
      }
      return {
        skills: base.skills.filter((s) => wanted.has(s.name)),
        diagnostics: base.diagnostics,
      };
    },
  });

  await loader.reload();
  return { loader, missingSkills };
}

/**
 * 装配可展开进 `createAgentSession(...)` 的会话选项（不真正建会话）。
 *
 * 返回的 `options` 含 cwd / agentDir / sessionManager / resourceLoader，以及按
 * profile.tools 收窄的 `tools`：
 * - profile.tools 非空 → `tools: profile.tools`（白名单，仅启用这些）；
 * - profile.tools 为空数组 → `tools: []`（无编码工具，但**不**清空 prompt，D-28）。
 *
 * 模型 / thinkingLevel 不在此处设置——它们绑定已建好的会话与 registry，见
 * {@link applyProfileRuntime}。
 */
export async function assembleProfileSessionOptions(args: {
  projectRoot: string;
  profile: AgentProfile;
  cwd: string;
  sessionManager: SessionManager;
  agentDir?: string;
  /** 测试可注入额外技能目录。 */
  additionalSkillPaths?: string[];
}): Promise<{
  options: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    resourceLoader: ResourceLoader;
    tools: string[];
  };
  diagnostics: { missingSkills: string[] };
}> {
  const { projectRoot, profile, cwd, sessionManager, additionalSkillPaths } = args;
  const agentDir = args.agentDir ?? getAgentDir();

  // 每次都重读档案正文 → 档案编辑后无缓存，下次起会话即反映新内容（§5.2 AC④）。
  const { agentMd, memoryMd } = readProfileDocs(projectRoot, profile);
  const injectionBlock = buildInjectionBlock(agentMd, memoryMd);

  const { loader, missingSkills } = await buildProfileResourceLoader({
    cwd,
    agentDir,
    injectionBlock,
    skillNames: profile.skills,
    additionalSkillPaths,
  });

  return {
    options: {
      cwd,
      agentDir,
      sessionManager,
      resourceLoader: loader,
      tools: profile.tools, // 空数组语义见 D-28：无工具但保留档案 prompt。
    },
    diagnostics: { missingSkills },
  };
}

/**
 * 会话建好后，按档案应用运行时调整：解析模型 → registry 查找 → 命中则设模型、
 * 落空则降级用内核默认（`modelFallback: true`，不抛错，D-25）→ 设 thinkingLevel。
 *
 * `session` 即 `createAgentSession` 返回的 `inner`（AgentSession）。`modelRegistry`
 * 可显式注入（单测用 faux registry）；不给则用 `session.modelRegistry`。
 *
 * 异步：命中分支 `await session.setModel(model)`，确保返回后模型已切换、
 * setModel 的异步错误能向上抛（不被吞成 unhandled rejection）。
 */
export async function applyProfileRuntime(
  session: ProfileRuntimeSession,
  profile: AgentProfile,
  deps?: { modelRegistry?: ModelLookup },
): Promise<{ modelFallback: boolean }> {
  let modelFallback = false;

  const selector = resolveModelSelector(profile.model);
  if (selector) {
    const registry = deps?.modelRegistry ?? session.modelRegistry;
    const model = registry.find(selector.provider, selector.modelId);
    if (model) {
      // await 以保证返回后模型已切换、setModel 的异步错误能向上抛（不被吞成 unhandled rejection）。
      await session.setModel(model);
    } else {
      modelFallback = true; // 档案模型在 registry 中不存在 → 用内核默认。
    }
  } else {
    modelFallback = true; // 档案 model 空/格式非法 → 用内核默认。
  }

  // thinkingLevel：profile 的 off|low|medium|high 是内核 ThinkingLevel 的子集，直传无需映射。
  session.setThinkingLevel(profile.thinkingLevel);

  return { modelFallback };
}

/**
 * 模型查找的最小接口（内核 `ModelRegistry.find` 的子集）。沿用 lib/pi-types.ts 的
 * {@link ModelLike} 作模型实例，避免向上层泄漏内核 `Model<any>` 泛型。
 */
export interface ModelLookup {
  find(provider: string, modelId: string): ModelLike | undefined;
}

/** applyProfileRuntime 只依赖会话的这几个能力，用窄接口而非整 AgentSession 类型（同 AgentSessionLike 风格）。 */
export interface ProfileRuntimeSession {
  readonly modelRegistry: ModelLookup;
  setModel(model: ModelLike): Promise<void>;
  setThinkingLevel(level: AgentProfile["thinkingLevel"]): void;
}
