/**
 * V2-3 · 文档会话装配（替 artifact-guard 的装配位）。
 *
 * 产出「受限工具集」的会话 options：让 profile 会话只能用只读内置工具（read/grep/find/ls）+ 三个
 * 提议工具（create_artifact/propose_edit/list_artifacts），**不给 write/edit/bash**——AI 结构性
 * 无直接写盘/执行路径，改文档只能走「提议 → PendingChange → 按块确认 → 才写盘」的受管通道。
 *
 * 与 guard 的根本区别（更简）：
 *   - guard 要「拦 write/edit」→ 保留这俩工具名 + 重建它们的 operations（自分流受管/非受管）。
 *   - doc-session **不要** write/edit/bash → 白名单直接排除它们、customTools 只加 3 个全新提议工具，
 *     **无需重建任何内核工具的 operations**。
 *
 * 安全论证（依赖 V2-0 spike 双向实证）：白名单无 write/edit/bash → 内置写盘工具不激活；customTools
 * 只加只读的提议工具 → 无任何直接写盘/执行路径 → 结构性无绕过。
 *
 * D-V2-04 命门（spike 已证）：内核 `_refreshToolRegistry`（agent-session.js:1818-1831）对 customTools
 * **也按 `tools` 白名单按名过滤**——白名单必须**显式含全部 3 个提议工具名**，否则它们连注册都不到、
 * agent 调不到、闭环断。故下方 DOC_SESSION_TOOLS 含 4 只读内置 + 3 提议工具名（共 7）。
 *
 * 沿用 guard / B2 的「只产 options、调用方 new 会话」边界（V2-4 wiring 负责真正 createAgentSession）。
 */
import { buildDocTools, type DocToolDeps, type DocToolDef } from "./doc-tools";

/**
 * 受限工具集白名单（7 项）：4 只读内置（read/grep/find/ls，便于 agent 读材料/定位）+ 3 提议工具名。
 * **必须含 3 提议工具名**（D-V2-04），且**不含 write/edit/bash**（无写盘/执行能力）。
 */
export const DOC_SESSION_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "create_artifact",
  "propose_edit",
  "list_artifacts",
] as const;

/**
 * 产出可展开进 `createAgentSession(...)` 的受限工具集 options。
 *
 * `cwd` 纳入入参以对齐 V2-4 wiring 调用点（那里有 cwd，且沿用 P0 装配模块「入参带 cwd」的边界），
 * 本模块自身不消费它（doc-session 不重建任何 cwd 级内核工具 operations；
 * cwd 由 wiring 直接传给 createAgentSession）。
 *
 * 用法（「只产 options、调用方负责 new 会话」边界）：
 *   const { options: docOptions } = assembleDocSessionOptions({ projectId, sourceActor, cwd });
 *   await createAgentSession({ ...profileOptions, ...docOptions, ...createOptionsOverride });
 * ⚠️ spread 顺序：docOptions 必须在 profileOptions **之后**——两者都含 `tools` 键，docOptions 的
 * 受限白名单须覆盖 profile.tools（否则 profile.tools 若含 write/edit/bash 会泄漏）。此约束由 V2-4 落实。
 */
export function assembleDocSessionOptions(deps: DocToolDeps & { cwd: string }): {
  options: { tools: string[]; customTools: DocToolDef[] };
} {
  // buildDocTools 只读 DocToolDeps 字段（projectId/sourceActor/可注入后端），忽略多带的 cwd。
  const customTools = buildDocTools(deps);
  return {
    options: {
      tools: [...DOC_SESSION_TOOLS],
      customTools,
    },
  };
}
