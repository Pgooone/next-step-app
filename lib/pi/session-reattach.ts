/**
 * 第五轮 / D-B4-4 —— profile 感知的会话解析器 `resolveOrReattachSession`。
 *
 * 两条 re-attach 路由（`POST /api/agent/[id]` 跟进轮、`GET /api/agent/[id]/events` 流式重连）
 * 在内存 registry `__piSessions` 未命中活会话时，原本都走通用 `startRpcSession` 重开 **generic** 会话
 * ——那条路径无档案注入、无受限 doc 工具集，于是文档型 profile 会话 re-attach 后**丢**
 * create_artifact/propose_edit/list_artifacts、**多出** write/edit/bash（违红线②）。
 *
 * 本解析器在重开前先判：该 sessionId 是否「按档案起的会话」（M5 映射 `bySession` 有 agentId）——
 *   - 是且能反查到 project+档案 → 走 {@link reattachProfileSession}（带注入块 loader + 7 名受限白名单）；
 *   - 否（主对话/孤儿）或档案/项目已删 → 走 generic（{@link startRpcSessionInner}）。
 * 三分支统一返回 `{ session, realSessionId }`（两路由 `const { session } = await ...` 解构，
 * 且 session 同型 AgentSessionWrapper、都能 `isAlive()`）。
 *
 * 并发去重（方案 A，用户拍板）：复用 rpc-manager 的 {@link withStartLock}（同一把 `__piStartLocks`），
 * 与 startRpcSession 共用——同一 sessionId 并发只建一个会话，generic 分支调**不带锁**的
 * startRpcSessionInner（已在外层锁内、避免双锁）。
 *
 * 红线：本模块只做「判定 + 分流 + 复用既有封装」，不改 pi 内核、不碰受限工具集/提议工具/
 * reattachProfileSession 本体（机制层一行不动）。
 */
import {
  AgentProfileStore,
  type AgentProfile,
} from "../domain/agent-profile-store";
import { ProjectRegistry, normalizeRoot } from "../domain/project-registry";
import { getOwner } from "../domain/session-agent-map";
import {
  registerInnerSession,
  startRpcSessionInner,
  withStartLock,
  type AgentSessionWrapper,
  type StartLockDeps,
} from "../rpc-manager";
import { reattachProfileSession } from "./profile-session-wiring";

type ResolveResult = { session: AgentSessionWrapper; realSessionId: string };

/**
 * 反查 cwd 对应的 projectId + 该 agent 的档案。
 * - cwd 两侧 normalizeRoot 后比较：归一化 ~ 展开 / 相对→绝对路径，避免这两类差异静默漏命中
 *   （漏命中 = profile 会话误落 generic = 悄悄丢 doc 工具，正是本轮要修的故障）。
 *   ⚠️ normalizeRoot **不**消除尾斜杠（isAbsolute 短路、不走 resolve，见 project-registry.ts:38-43）；
 *   实践中 header.cwd 经内核 resolvePath 已去尾斜杠、project.root 经 normalizeRoot 亦无尾斜杠，两侧相等，
 *   故不构成漏命中（单测「边界记录」条钉死此语义；若未来出现带尾斜杠 cwd 需更强归一化再显式改此处）。
 * - 档案/项目缺失（`get` throw NOT_FOUND）→ 返回 null（落 generic、不抛错）；
 *   其余领域错误（projects.json 损坏 INVALID / IO）**续抛**，与 domainErrorResponse 分级一致。
 *
 * `backends` 仅供单测注入指向 tmpdir 的 registry/store（hermetic 验 normalizeRoot 匹配与容错）；
 * 生产省略 → `new ProjectRegistry()` / `new AgentProfileStore()`（默认 ~/.pi 文件后端）。export 供 AC④ 直测。
 */
export function lookupProfile(
  cwd: string,
  agentId: string,
  backends?: { registry?: ProjectRegistry; store?: AgentProfileStore },
): { projectId: string; profile: AgentProfile } | null {
  const registry = backends?.registry ?? new ProjectRegistry();
  const store = backends?.store ?? new AgentProfileStore();
  try {
    const target = normalizeRoot(cwd);
    const projectId = registry.list().find((p) => normalizeRoot(p.root) === target)?.id;
    if (!projectId) return null; // cwd 不在任何注册项目下 → 当孤儿走 generic
    const profile = store.get(projectId, agentId);
    return { projectId, profile };
  } catch (e) {
    // 只吞 NOT_FOUND（档案删/项目删 → 落 generic）；INVALID/IO 等续抛（让上层 500/422 而非静默退化）。
    if (e instanceof Error && (e as { code?: string }).code === "NOT_FOUND") return null;
    throw e;
  }
}

/** resolver 的可选依赖口（生产默认走真实 import；测试注入 hermetic 实现）。 */
export interface ResolveReattachDeps extends StartLockDeps {
  /** 读会话归属 agentId（main 不在 bySession、返 null）。 */
  getOwner?: (cwd: string, sessionId: string) => string | null;
  /** 反查 projectId + 档案；返回 null → 走 generic（孤儿/已删）。 */
  lookupProfile?: (cwd: string, agentId: string) => { projectId: string; profile: AgentProfile } | null;
  /** reattach 分支（默认 {@link reattachProfileSession}，传真实 registerInnerSession 使 session 为 wrapper）。 */
  reattach?: (args: {
    sessionId: string;
    filePath: string;
    projectId: string;
    projectRoot: string;
    profile: AgentProfile;
  }) => Promise<ResolveResult>;
  /** generic 分支（默认不带锁的 {@link startRpcSessionInner}）。 */
  startGeneric?: (filePath: string, cwd: string) => Promise<ResolveResult>;
}

/**
 * 活会话快路径 / 并发去重 / profile 感知分流（reattach vs generic），三分支统一返回 `{ session, realSessionId }`。
 *
 * @param sessionId 前端持有的会话 id（= jsonl header id；活会话快路径与锁去重均按它）。
 * @param filePath  会话文件路径（两路由由 `SessionManager.open(filePath).getHeader()` 取得）。
 * @param cwd       会话 cwd（同上来自 header，未归一化——内部反查时两侧 normalizeRoot）。
 */
export function resolveOrReattachSession(
  sessionId: string,
  filePath: string,
  cwd: string,
  deps?: ResolveReattachDeps,
): Promise<ResolveResult> {
  const ownerOf = deps?.getOwner ?? getOwner;
  const lookup = deps?.lookupProfile ?? lookupProfile;
  const reattach =
    deps?.reattach ??
    ((args) =>
      reattachProfileSession<AgentSessionWrapper>({ ...args, registerInnerSession }));
  const startGeneric = deps?.startGeneric ?? startRpcSessionInner;

  // 复用 startRpcSession 的同一把锁（方案 A）：快路径 + inflight 去重 + locks.set(build().finally) 全在此。
  return withStartLock(
    sessionId,
    async () => {
      const agentId = ownerOf(cwd, sessionId);
      if (agentId) {
        const found = lookup(cwd, agentId);
        if (found) {
          return reattach({
            sessionId,
            filePath,
            projectId: found.projectId,
            projectRoot: cwd,
            profile: found.profile,
          });
        }
      }
      // 主对话（getOwner 返 null）/ 孤儿 / 档案被删 → generic（不带锁内层，外层 withStartLock 已加锁）。
      return startGeneric(filePath, cwd);
    },
    { registry: deps?.registry, locks: deps?.locks },
  );
}
