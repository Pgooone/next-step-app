/**
 * C1 —— 单个 worker 会话的「起会话 + 等回合结束 + 取产物」内核封装。
 *
 * 与 {@link startProfileSession}（B4）的区别：B4 fire-and-forget 发首条 message 后即返回
 * sessionId，事件经 SSE 流给前端；而派发需要**等 worker 跑完一回合并取回其产物文本**，
 * 故本模块自己组合那 5 步，并在 `registerInnerSession` 之后、`send` 之前挂 `agent_end`
 * 监听（包成 Promise，resolve 于 `agent_end && !willRetry`，带超时/abort 兜底）。
 *
 * 复用 B2 的注入装配（{@link assembleProfileSessionOptions} / {@link applyProfileRuntime}），
 * 不重写注入逻辑（红线：lib/pi 只封装、不 fork 内核）。
 *
 * 并发闸门（AC⑤ ≤3）也在此：起每个 worker 前先 `await acquireSlot()` 等到活跃会话总数
 * <3 才放行（计数源 = rpc-manager 的进程级 registry，含前端聊天会话）。决策见 decisions.md（待 lead 记）。
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
import { assembleDispatchDocSessionOptions } from "./doc-session";
import { CODING_TOOL_NAMES } from "./coding-tools";

/** 运行时事件的最小读取形状（与 rpc-manager 的 AgentEvent 一致：松散 { type, ... }）。 */
type RuntimeEvent = { type: string; [key: string]: unknown };

/**
 * 一个会话包装的最小契约：能挂事件监听、能发命令。
 * 事件用松散 {@link RuntimeEvent}（与 rpc-manager 的 AgentSessionWrapper.onEvent 同构），
 * 避免与内核严格的 AgentSessionEvent 联合类型在结构上冲突（运行时我们只读 type/messages/willRetry）。
 */
export interface SessionHandle {
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  send(command: Record<string, unknown>): Promise<unknown>;
}

/** 登记函数：生产传 rpc-manager 的 registerInnerSession，测试传 faux。返回带 onEvent/send 的句柄 + 真实 sessionId。 */
export type RegisterInnerSession = (inner: AgentSession) => {
  session: SessionHandle;
  realSessionId: string;
};

/** worker 回合的结束原因：正常结束 / 执行超时 / 被取消（abort）。 */
export type TurnEndReason = "completed" | "timeout" | "aborted";

/** runWorker 的结果：worker 的真实 sessionId + 抽出的 assistant 产物文本 + 结束原因。 */
export interface WorkerResult {
  sessionId: string;
  output: string;
  /** 结束原因——orchestrator 据此写明确的失败信息（区分超时 / 取消 / 仅未产出）。 */
  reason: TurnEndReason;
}

/**
 * 起一个 worker 会话、发首条 message、等其回合结束、取回 assistant 产物文本。
 *
 * 顺序（关键）：装配注入 → createAgentSession → applyProfileRuntime → registerInnerSession
 * → **先挂 agent_end 监听** → send(prompt) → await 回合结束 → 抽产物文本。
 * 监听必须在 send 之前挂（B4 wiring 注释同款坑：否则首条 prompt 产生的事件无人订阅）。
 *
 * @param firstMessage 首条用户消息（子任务 + 可选上游产物，由 orchestrator 拼好）。
 * @param timeoutMs 单 worker 回合超时（兜底防止无 agent_end 永久挂起）。
 */
export async function runWorker(args: {
  projectRoot: string;
  /** 当前项目 id（派发 doc 提议工具按 id 操作受管文档、物化定位项目；orchestrator 传 task.projectId）。 */
  projectId: string;
  profile: AgentProfile;
  cwd: string;
  firstMessage: string;
  registerInnerSession: RegisterInnerSession;
  timeoutMs: number;
  /** 测试可注入额外技能目录（不经 project trust 门，稳定可发现）。 */
  additionalSkillPaths?: string[];
  /** 测试可注入 in-memory SessionManager；生产省略 → 真实落盘到 ~/.pi。 */
  sessionManager?: SessionManager;
  /** 测试可注入 faux model/authStorage/modelRegistry；生产省略 → 内核默认模型解析。 */
  createOptionsOverride?: Partial<CreateAgentSessionOptions>;
  /** abort 信号：中途取消整个派发时，让正在跑的 worker 提前结束（resolve 当前已积累文本）。 */
  signal?: AbortSignal;
}): Promise<WorkerResult> {
  const {
    projectRoot,
    projectId,
    profile,
    cwd,
    firstMessage,
    registerInnerSession,
    timeoutMs,
    additionalSkillPaths,
    sessionManager,
    createOptionsOverride,
    signal,
  } = args;

  const agentDir = getAgentDir();
  const { options } = await assembleProfileSessionOptions({
    projectRoot,
    profile,
    cwd,
    sessionManager: sessionManager ?? SessionManager.create(cwd, undefined),
    agentDir,
    additionalSkillPaths,
  });

  // 让文档型（mode=doc，默认）派发 worker 也能产受管文档：按 mode 合并「派发专用受限工具集」
  // （create_artifact + list_artifacts，**无 propose_edit**——headless 无人按块确认，propose_edit 会落死悬 pending）。
  //   - mode='doc'：装受限集（read/grep/find/ls + 2 提议工具，无 write/edit/bash）。
  //   - mode='coding'：不套受限集 → profile.tools 直接生效（等价既有带 bash 编码 worker）；
  //     profile.tools 为空时退回全套内置编码工具（含 bash），与主对话/profile 会话「空 tools → 默认全集」对齐（D-MODE-05）。
  // sourceActor = profile.name（version.author / 物化定位，与 profile 会话同款）。提议工具后端默认文件后端
  //   （buildDispatchDocTools 内 new ProjectRegistry() 读默认 ~/.pi/projects.json），测试经 createOptionsOverride 不覆盖、
  //   hermetic 时由 docDepsOverride 注入——本卡 dispatch-runner 暂只暴露默认后端（orchestrator 生产路径不注入）。
  const docOptions =
    profile.mode === "coding"
      ? undefined
      : assembleDispatchDocSessionOptions({ projectId, sourceActor: profile.name, cwd }).options;
  const codingToolsFallback =
    profile.mode === "coding" && profile.tools.length === 0 ? { tools: [...CODING_TOOL_NAMES] } : {};

  // ⚠️ spread 顺序 options → docOptions → codingToolsFallback → createOptionsOverride 不可调（D-V2-04，
  // 与 profile-session-wiring.ts:165-170 同序）：options 含 `tools: profile.tools`；doc 模式 docOptions 也含
  // `tools`（6 项受限白名单）——docOptions 必须排在 options **之后**覆盖掉 profile.tools，否则含 write/edit/bash
  // 会泄漏、受限集失效。coding 模式 docOptions=undefined → profile.tools 即最终工具集（空时由 fallback 兜底）。
  const { session: inner } = await createAgentSession({
    ...options,
    ...(docOptions ?? {}),
    ...codingToolsFallback,
    ...createOptionsOverride,
  });
  await applyProfileRuntime(inner, profile);

  // 必须先登记接事件流、再挂 agent_end 监听、最后才 send——否则首条 prompt 的事件错过。
  const { session, realSessionId } = registerInnerSession(inner);

  const ended = waitForTurnEnd(session, { timeoutMs, signal });

  await session.send({ type: "prompt", message: firstMessage });

  const { messages, reason } = await ended;

  // 执行超时 / 被取消：主动 abort 该会话，停掉内核正在跑的回合（wrapper 支持 "abort" 命令），
  // 避免泄漏一个仍在后台跑的会话占着并发槽。abort 失败忽略（会话可能已结束）。
  if (reason !== "completed") {
    await session.send({ type: "abort" }).catch(() => {});
  }

  const output = extractAssistantText(messages);
  return { sessionId: realSessionId, output, reason };
}

/**
 * 等一个会话「回合结束」：内核 `agent_end` 且 `willRetry===false`（重试中的 agent_end 不算结束）。
 * resolve 于 `{ messages, reason }`——reason 区分 completed / timeout / aborted，供 orchestrator
 * 写明确的失败信息。带超时与 abort 兜底，**皆 resolve（不 reject）**：派发不应因单 worker 超时
 * 抛未捕获异常；超时/取消下返回已知最近一次 agent_end 的 messages（通常为空）+ 对应 reason。
 */
function waitForTurnEnd(
  session: SessionHandle,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ messages: AgentMessageLike[]; reason: TurnEndReason }> {
  const { timeoutMs, signal } = opts;
  return new Promise((resolve) => {
    let lastMessages: AgentMessageLike[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (messages: AgentMessageLike[], reason: TurnEndReason): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      off();
      signal?.removeEventListener("abort", onAbort);
      resolve({ messages, reason });
    };

    const off = session.onEvent((event) => {
      if (event.type === "agent_end") {
        const e = event as { type: "agent_end"; messages: AgentMessageLike[]; willRetry: boolean };
        lastMessages = e.messages ?? [];
        if (e.willRetry === false) finish(lastMessages, "completed");
      }
    });

    const onAbort = (): void => finish(lastMessages, "aborted");
    if (signal) {
      if (signal.aborted) {
        finish(lastMessages, "aborted");
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    timer = setTimeout(() => finish(lastMessages, "timeout"), timeoutMs);
  });
}

/** AgentMessage 的最小读取形状（只关心 role 与 content，避免泄漏内核泛型）。 */
interface AgentMessageLike {
  role?: string;
  content?: unknown;
}

/**
 * 从一回合的 messages 中抽「末条 assistant 的纯文本」作为产物。
 * assistant.content 是 (TextContent|ThinkingContent|ToolCall)[]——只取 `type:"text"` 的 text 拼接；
 * content 退化为 string 时直接用（pi-ai 类型允许 user content 为 string，assistant 通常为数组）。
 */
export function extractAssistantText(messages: AgentMessageLike[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return "";
  const content = lastAssistant.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text)
    .join("");
}
