"use client";

import { useMastermindNudge } from "@/hooks/useMastermindNudge";

/**
 * 第 8.6 轮第二期 T1（M1 中间路 nudge）—— **不渲 UI 的 nudge 驱动**（同 MastermindPollDriver 范式：挂 ChatWindow
 * 会话作用域、随会话切换卸载）。观察本会话所有 run 进度，每队员干完/全干完 → 隐式往主脑主会话发 user 消息让它吐
 * 阶段小结/产总汇总（逻辑全在薄封装 hook useMastermindNudge + 纯函数 nudge-detector，本组件仅挂载宿主）。
 *
 * runIds 由 ChatWindow 从 transcript 派生（禁 find、覆盖多 run）传入；handleSend/agentRunning 取 useAgentSession。
 * 切走会话即 ChatWindow 卸载 → 本组件随之卸载 → 不跨会话 nudge（run 仍后台跑、切回轮询补齐终态）。
 */
export default function MastermindNudgeDriver({
  runIds,
  handleSend,
  agentRunning,
}: {
  runIds: string[];
  handleSend: (message: string) => void | Promise<void>;
  agentRunning: boolean;
}) {
  useMastermindNudge(runIds, handleSend, agentRunning);
  return null;
}
