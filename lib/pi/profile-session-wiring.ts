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
 * ── D-B4-4：idle 重建会丢 live 注入（本卡不处理）─────────────────────
 * 会话 idle 销毁后，SSE 路由会重走 startRpcSession 重建——那条路径无档案注入，
 * model/thinking 回默认，但**已落盘的 systemPrompt 仍在**（注入块已写进会话文件）。
 * 本卡仅留此注释，Iter D 再议。
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
}): Promise<ProfileSessionResult> {
  const {
    projectRoot,
    profile,
    cwd,
    firstMessage,
    registerInnerSession,
    additionalSkillPaths,
    sessionManager,
    createOptionsOverride,
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

  const { session: inner } = await createAgentSession({ ...options, ...createOptionsOverride });

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
