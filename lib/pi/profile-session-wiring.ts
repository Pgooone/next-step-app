/**
 * B4 —— 按 Agent 档案起会话的「服务端组合」逻辑。
 *
 * 把 B2 的注入封装（{@link assembleProfileSessionOptions} / {@link applyProfileRuntime}）
 * 接进真实起会话链路，端到端完成「按档案注入起会话 + 发首条 message + 登记进 registry」。
 * HTTP 端点（app/api/projects/[id]/agents/[agentId]/session/route.ts）只做参数校验与
 * 调用本函数——组合逻辑放这里，使其能在 vitest（include: lib/**）下用 faux 驱动测试。
 *
 * ── 关键深坑 D-B4-3：必须带首条 message 一步建会话 ─────────────────────
 * 内核 `createAgentSession` 在**未发首条 prompt** 时对会话文件懒落盘
 * （sessionFile 有值但磁盘尚无文件）。若只建会话不发 message，后续 loadSession 会
 * 读到 id 错位的「幻影空会话」。故本函数建会话后立即发首条 prompt（fire-and-forget，
 * 事件经 registry 的 SSE 流出去），与 /api/agent/new 已验证路径同款，触发真落盘。
 *
 * ── D-B4-4 / 同源 gap：idle 重建会丢 live 注入与受限工具集（本卡不处理）─────
 * 会话 idle 销毁后，SSE 路由会重走 startRpcSession 重建——那条路径无档案注入、
 * 亦无 doc-session 受限工具集，model/thinking 回默认，但**已落盘的 systemPrompt 仍在**
 * （注入块已写进会话文件）。重建会话不受受限工具集约束，属已登记的 gap，本卡不修。
 *
 * ── V2（文档实体 + 提议工具）：profile 会话装受限工具集 ─────────────
 * 本函数建会话时一律合并 {@link assembleDocSessionOptions} 的 options（替代 P0 的 artifact-guard）：
 * 白名单只给只读内置（read/grep/find/ls）+ 3 个提议工具（create_artifact/propose_edit/list_artifacts），
 * **无 write/edit/bash**——AI 结构性无直接写盘路径，改文档只能走「提议 → PendingChange → 按块确认 →
 * 才写盘」的受管通道。**仅 profile 会话这一处**——不碰主对话 /api/agent/new、dispatch、idle 重建/rpc-manager。
 *
 * 红线：本模块只「封装/组合」内核与既有封装，不 fork 内核、不碰 /api/agent/new。
 */

import {
  createAgentSession,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

import type { AgentProfile } from "../domain/agent-profile-store";
import { applyProfileRuntime, assembleProfileSessionOptions } from "./agent-profile-session";
import { assembleDocSessionOptions } from "./doc-session";
import { CODING_TOOL_NAMES } from "./coding-tools";
import type { DocToolDeps } from "./doc-tools";
import { extraSkillDirs } from "./extra-skill-dirs";

/** 起会话后回报给前端的诊断（D-B4-5：前端仅 console.warn，toast 后置）。 */
export interface ProfileSessionDiagnostics {
  /** 档案 model 解析失败或在 registry 查不到 → 用了内核默认模型。 */
  modelFallback: boolean;
  /** 档案声明但内核未发现的技能名（静默忽略，仅记录）。 */
  missingSkills: string[];
}

/** startProfileSession 的返回：真实 sessionId（pi 生成）+ 诊断。 */
export interface ProfileSessionResult {
  sessionId: string;
  diagnostics: ProfileSessionDiagnostics;
}

/**
 * 登记函数依赖口：生产传 rpc-manager 的 registerInnerSession，测试传 faux
 * （避免触碰进程级 globalThis registry）。只要求返回物带 `send`（发首条 message）。
 * 入参用内核 `AgentSession`——它结构上即 rpc-manager 期望的 AgentSessionLike。
 */
export type RegisterInnerSession = (inner: AgentSession) => {
  session: { send(command: Record<string, unknown>): Promise<unknown> };
  realSessionId: string;
};

/**
 * re-attach 专用登记口（D-B4-4）。与 {@link RegisterInnerSession} 的区别：返回 `session` 用泛型
 * `S` 透传上层（生产是 rpc-manager 的 `AgentSessionWrapper`，T2 resolver 要在其上调 `isAlive()` 等），
 * 而非窄到只剩 `send`。生产默认走 rpc-manager 的 `registerInnerSession`（经惰性 import，避免与
 * rpc-manager 形成静态导入环——见 {@link reattachProfileSession} 的 registerInnerSession 默认值）；
 * 测试注入 faux（不碰进程级 globalThis registry）。
 */
export type ReattachInnerSession<S = unknown> = (
  inner: AgentSession,
) => { session: S; realSessionId: string } | Promise<{ session: S; realSessionId: string }>;

/**
 * 按档案起一个真实会话：装配注入选项 → createAgentSession → 应用运行时（model/thinking）
 * → 登记进 registry → 发首条 message（触发落盘，D-B4-3）→ 返回真实 sessionId + 诊断。
 *
 * 注意顺序：先 registerInnerSession 接上事件流，再发首条 message——否则首条 prompt
 * 产生的流事件无人订阅。
 *
 * @param cwd 必须由调用方从 `registry.get(projectId).root` 取（D-B4-2，不从请求体取）。
 * @param firstMessage 首条用户消息（不可为空——空则触发 D-B4-3 的幻影会话坑）。
 */
export async function startProfileSession(args: {
  projectId: string;
  projectRoot: string;
  profile: AgentProfile;
  cwd: string;
  firstMessage: string;
  registerInnerSession: RegisterInnerSession;
  /** 测试可注入额外技能目录（不经 project trust 门，稳定可发现）。 */
  additionalSkillPaths?: string[];
  /** 测试可注入 in-memory SessionManager 保持 hermetic；生产省略 → 真实落盘到 ~/.pi。 */
  sessionManager?: SessionManager;
  /**
   * 测试可注入额外的 createAgentSession 选项（faux model/authStorage/modelRegistry），
   * 让无凭证环境下也能起会话。生产不传——走内核默认模型解析。
   */
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  /**
   * 测试可注入提议工具的后端依赖（指向 hermetic 临时 registry/.pi 文件），让 hermetic 单测能断言
   * create_artifact/propose_edit 真的落盘到本测项目。**生产省略**——提议工具默认其文件后端服务
   * （buildDocTools 内 new ProjectRegistry() 读默认 ~/.pi/projects.json），与 resolve/pending 路由指向
   * 同一批文件（doc-tools.ts）。projectId/sourceActor 由本函数恒定填充，故此处只暴露两个后端实例。
   */
  docDepsOverride?: Pick<DocToolDeps, "artifactService" | "pendingStore">;
}): Promise<ProfileSessionResult> {
  const {
    projectId,
    projectRoot,
    profile,
    cwd,
    firstMessage,
    registerInnerSession,
    additionalSkillPaths,
    sessionManager,
    createOptionsOverride,
    docDepsOverride,
  } = args;

  const agentDir = getAgentDir();
  const { options, diagnostics } = await assembleProfileSessionOptions({
    projectRoot,
    profile,
    cwd,
    sessionManager: sessionManager ?? SessionManager.create(cwd, undefined),
    agentDir,
    additionalSkillPaths,
  });

  // V2：profile 会话一律装「受限工具集」——只读内置 + 3 提议工具，无 write/edit/bash。
  // 提议工具不传后端 → 默认其文件后端（buildDocTools 内 new ProjectRegistry() 读默认 ~/.pi/projects.json），
  // 与 resolve/pending 路由指向同一批 .pi 文件，UI 读得到（doc-tools.ts）。
  // sourceActor = profile.name（PendingChangeCard 渲染「变更来自 <name>」，人类可读，非 UUID agentId）。
  // 方案A（agent mode）：按 profile.mode 决定是否套「文档受限工具集」。
  //   - mode='doc'（默认/旧档案）：装受限集（read/grep/find/ls + 3 提议工具，无 write/edit/bash），
  //     改受管文档只能经 propose_edit → PendingChange → 按块确认（V2 红线不变）。
  //   - mode='coding'：不套受限集 → options.tools(=profile.tools，可含 bash/write/edit) 直接生效，
  //     等价 dispatch worker / 主对话既有的「带 bash 编码会话」，可直接写盘、不经提议（不属文档会话、不破红线）。
  //   见 docs/设计决策记录.md（agent mode 方案A）。
  const docOptions =
    profile.mode === "coding"
      ? undefined
      : assembleDocSessionOptions({
          projectId,
          sourceActor: profile.name,
          cwd,
          ...docDepsOverride, // 生产为 undefined → 提议工具用默认文件后端；测试注入 hermetic service/store
        }).options;
  // 编码型 + profile.tools 为空 → 退回全套内置编码工具（含 bash）。否则内核把 `tools: []` 当
  // 「白名单=零工具」（空数组非 undefined、不回退默认）→ agent 一个工具都没有（D-MODE-05 修复）。
  // 与主对话「空 toolNames → 默认全集」对齐；doc 模式不受影响（其 tools 由 docOptions 覆盖）。
  const codingToolsFallback =
    profile.mode === "coding" && profile.tools.length === 0 ? { tools: [...CODING_TOOL_NAMES] } : {};
  // ⚠️ spread 顺序是受限集生效的唯一支点（D-V2-04 / major4）：options(=assembleProfileSessionOptions)
  // 含 `tools: profile.tools`；doc 模式 docOptions 也含 `tools`(7 项受限白名单)——两键相撞，docOptions
  // 必须排在 options **之后**覆盖掉 profile.tools，否则含 write/edit/bash 会泄漏、受限集失效。
  // coding 模式 docOptions=undefined → profile.tools 即最终工具集（空时由 codingToolsFallback 兜底全集）。
  // createOptionsOverride 仍排末位（测试覆盖 model/auth；不含 tools 键、不影响白名单）。
  const { session: inner } = await createAgentSession({
    ...options,
    ...(docOptions ?? {}),
    ...codingToolsFallback,
    ...createOptionsOverride,
  });

  // model 降级 / thinking：会话建好后应用（绑定已建会话，见 B2 applyProfileRuntime）。
  const { modelFallback } = await applyProfileRuntime(inner, profile);

  // 登记进 registry 接事件流——必须在发首条 message 之前，否则首条产生的事件无人订阅。
  const { session, realSessionId } = registerInnerSession(inner);

  // D-B4-3：带首条 message 触发真落盘（fire-and-forget，事件经 SSE 流出去）。
  await session.send({ type: "prompt", message: firstMessage });

  return {
    sessionId: realSessionId,
    diagnostics: { modelFallback, missingSkills: diagnostics.missingSkills },
  };
}

/**
 * D-B4-4 修复 —— re-attach 一个已存在的文档型 profile 会话（idle 销毁 / dev 重启 / SSE 重连后重建）。
 *
 * 与 {@link startProfileSession} **同源装配**（同一 loader 带注入块 + 同一受限工具集），**唯三差异**：
 *   ① 用 `SessionManager.open(filePath)` 重开既有会话（非 `create` 新建）——会话文件已在磁盘；
 *   ② **不发首条 message**（D-B4-3 的「必发首条」是为**新建**会话触发真落盘防幻影空会话；
 *      re-attach 的 jsonl 已存在、无此问题，重发会污染历史）；
 *   ③ `applyProfileRuntime` 重应用 model/thinking（否则重建后回内核默认）。
 *
 * systemPrompt 走「现算覆盖」（spike 结论 + §〇）：内核**不持久化** systemPrompt，每次构造期由
 * resourceLoader 现算。故 re-attach **必须**照常走完整 `assembleProfileSessionOptions`（带注入块 loader），
 * 得到与初次完全一致的 systemPrompt——只装工具集会让角色/记忆静默丢失（jsonl 无可回放的 systemPrompt）。
 *
 * 红线②：spread 顺序 `options → docOptions` 不可调——docOptions 的 7 名受限白名单必须**覆盖**
 * profile.tools，否则 profile.tools 若含 write/edit/bash 会泄漏、受限集当场失效。
 *
 * @returns `registerInnerSession` 的 `{ session, realSessionId }`（**非** {@link ProfileSessionResult}）——
 *   T2 的 resolver 三分支统一 `const { session } = await ...` 解构，需拿到带 `isAlive()` 的真实包装器。
 */
export async function reattachProfileSession<S = unknown>(args: {
  sessionId: string;
  filePath: string;
  projectId: string;
  projectRoot: string;
  profile: AgentProfile;
  /** 测试可注入额外技能目录；省略 → `extraSkillDirs(projectRoot)`（与生产 startProfileSession 调用点一致）。 */
  additionalSkillPaths?: string[];
  /** 测试注入 in-memory/持久化 SessionManager 保持 hermetic；生产省略 → `SessionManager.open(filePath)`。 */
  sessionManager?: SessionManager;
  /** 测试注入 faux model/auth/modelRegistry，让无凭证环境也能起会话；生产省略。 */
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  /**
   * 测试注入提议工具后端（指向 hermetic 临时 registry/.pi），让 `getActiveToolNames()` 断言 hermetic。
   * **最硬约束**：不注入则 `buildDocTools` 默认 `new ProjectRegistry()` 读真实 `~/.pi`（doc-tools.ts），单测非 hermetic。
   * 生产省略 → 提议工具用默认文件后端，与 resolve/pending 路由指向同一批文件。
   */
  docDepsOverride?: Pick<DocToolDeps, "artifactService" | "pendingStore">;
  /**
   * 登记口：测试注入 faux（不碰进程级 registry）；生产省略 → 惰性 import rpc-manager 的真实
   * `registerInnerSession`（动态 import 避免静态导入环：rpc-manager 不 import 本文件，本文件亦不
   * 静态 import rpc-manager）。
   */
  registerInnerSession?: ReattachInnerSession<S>;
}): Promise<{ session: S; realSessionId: string }> {
  // sessionId 不在本体消费（inner.sessionId 为准）——仅作 T2 resolver 调用契约的语义参数，故不解构。
  const {
    filePath,
    projectId,
    projectRoot,
    profile,
    additionalSkillPaths,
    sessionManager,
    createOptionsOverride,
    docDepsOverride,
    registerInnerSession,
  } = args;

  // 差异①：open 既有会话文件（非 create）。
  const sm = sessionManager ?? SessionManager.open(filePath, undefined);
  const agentDir = getAgentDir();

  // 与初次同源：带注入块的 loader（systemPrompt 现算覆盖，§〇 spike 结论）+ 技能过滤。
  const { options } = await assembleProfileSessionOptions({
    projectRoot,
    profile,
    cwd: projectRoot,
    sessionManager: sm,
    agentDir,
    additionalSkillPaths: additionalSkillPaths ?? extraSkillDirs(projectRoot),
  });

  // 受限工具集（与 startProfileSession 同款）：按 profile.mode 分流（方案A）。
  // mode='coding' → 不套受限集，re-attach 后仍是「带 bash 编码会话」；mode='doc'（默认）→ 受限集。
  // cwd 必填（major #1，照初版错层会泄漏写盘工具）。
  const docOptions =
    profile.mode === "coding"
      ? undefined
      : assembleDocSessionOptions({
          projectId,
          sourceActor: profile.name,
          cwd: projectRoot,
          ...docDepsOverride,
        }).options;

  // 编码型 + profile.tools 为空 → 退回全套内置编码工具（含 bash），与 startProfileSession 同款（D-MODE-05）。
  const codingToolsFallback =
    profile.mode === "coding" && profile.tools.length === 0 ? { tools: [...CODING_TOOL_NAMES] } : {};
  // spread 顺序 options → docOptions → createOptionsOverride 不可调（D-V2-04/红线②）：
  // doc 模式 docOptions.tools(7 受限白名单)须覆盖 options.tools(profile.tools)；coding 模式 docOptions=undefined（空 tools 由 fallback 兜底）。
  const { session: inner } = await createAgentSession({
    ...options,
    ...(docOptions ?? {}),
    ...codingToolsFallback,
    ...createOptionsOverride,
  });

  // 差异③：重应用 model/thinking（re-attach 否则回内核默认）。
  await applyProfileRuntime(inner, profile);

  // 差异②：登记进 registry 接事件流，但**不发首条 message**。生产经惰性 `await import` 拿真实
  // registerInnerSession（动态 import 避免与 rpc-manager 形成静态导入环——rpc-manager 不 import 本
  // 文件，本文件亦不静态 import rpc-manager；同 rpc-manager.ts:317 的惰性 import 范式）；测试注入 faux。
  const register: ReattachInnerSession<S> =
    registerInnerSession ??
    (async (s: AgentSession) => {
      const { registerInnerSession: real } = await import("../rpc-manager");
      return real(s) as { session: S; realSessionId: string };
    });
  return register(inner);
}
