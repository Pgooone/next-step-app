/**
 * V1.2 第七轮（流水线与阶段看板）—— 进程级「runId → AbortController」注册表。
 *
 * POST 起 run 时为每个 run 建一个 {@link AbortController} 并 {@link setRunController} 注册，
 * 把 `controller.signal` 透给 {@link runPipeline}；T6 的 cancel 路由据 runId 取回 controller
 * 调 `abort()` 中断在跑的 run（顶 cancel 检测 + 透传 worker signal）。
 *
 * 挂 `globalThis`（仿 rpc-manager.ts:243-257 的 `__piSessions` 单例范式）而非模块级 `const Map`：
 * dev（Turbopack）热重载会重新求值模块顶层 `const`，模块级 `new Map()` 会让 POST set 的
 * controller 在热重载后丢失 → T6 cancel `getRunController` 取不到 → abort 失效。挂 globalThis
 * 跨模块实例共享、热重载不丢（ADR D-R7-03）。
 *
 * T3 仅用 {@link setRunController}（POST 起 run）；get/delete 留 T6 cancel。
 */

declare global {
  var __piRunControllers: Map<string, AbortController> | undefined;
}

function getRunControllers(): Map<string, AbortController> {
  if (!globalThis.__piRunControllers) globalThis.__piRunControllers = new Map();
  return globalThis.__piRunControllers;
}

/** 注册某 run 的 AbortController（POST 起 run 调用）。 */
export function setRunController(runId: string, controller: AbortController): void {
  getRunControllers().set(runId, controller);
}

/** 取回某 run 的 AbortController（T6 cancel 用）；无则 undefined。 */
export function getRunController(runId: string): AbortController | undefined {
  return getRunControllers().get(runId);
}

/** 摘除某 run 的 AbortController（T6 终态清理用）。 */
export function deleteRunController(runId: string): void {
  getRunControllers().delete(runId);
}
