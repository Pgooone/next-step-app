"use client";

import { useEffect, useRef } from "react";
import type { MastermindRun } from "@/lib/domain/mastermind-run-store";
import { useMastermindStore } from "@/lib/stores/useMastermindStore";
import { computeNudges, type NudgeSnapshot } from "@/lib/mastermind/nudge-detector";

/**
 * 第 8.6 轮第二期 T1（M1 中间路 nudge）—— **薄封装 hook**（口子/gate/订阅在此、核心逻辑在 nudge-detector.ts）。
 *
 * 主脑（总管）派活后主会话 LLM 退场、run 由 headless worker 跑（T6 解耦）；本 hook 订阅 useMastermindStore
 * 的 run 进度，每当某队员干完 → 隐式往主脑主会话发一条 user 消息让它吐阶段小结；全干完 → 让它产总汇总受管文档。
 * 纯前端，绝不碰服务端（approve/route / runMastermind / 内核一字不改，守红线）。
 *
 * **口子=handleSend（禁 handleFollowUp/followUp）**：内核 followUp 在 idle 态纯入队黑洞、AgentSession 无人 drain，
 * 且潜伏队列会在用户下一次真回合尾被连环 drain（过期小结延迟轰炸）——T6 解耦下 run 期主脑恒 idle → 用 followUp
 * 则 nudge 全丢/延迟乱炸。handleSend 自带 `if(agentRunning)return` guard、idle 起真回合=正确口子（D-R8.6-15）。
 *
 * **状态机（一 nudge 一 agentRunning 周期，无双发）**：
 *  - prevRef（NudgeSnapshot|null，随 remount 归空=有意 → 触发 baseline-first：首挂只建基线零发，防 F5/切回重放）。
 *  - firedFinalRef（Set，跨 tick 累积；防 resume paused→running→done 重发汇总，双保险之一）。
 *  - effect 依赖钉 status 翻转摘要 + agentRunning：轮询产新翻转 → 重跑；nudge 发出令 agentRunning true→重跑但 canFire=
 *    false 故 hold 下一条；回合结束 agentRunning false→重跑补发下一条 held nudge（run 已终态、轮询停、store 冻结、
 *    status 摘要不再变 → **必须靠 agentRunning 落回触发补发**，否则终态汇总永久漏发）。
 *  - 每 tick 至多发一条（detector 保证）→ 单会话串行、不撞内核「回合进行中」。
 *  - StrictMode 双挂载安全：dev 下 effect mount→(无 cleanup)→重跑，但 useRef 值随同一 fiber 存活不归空 → 第二次
 *    effect 时 prevRef 已是首次建的基线快照（非 null）、与自身比对无翻转 → 零发。真 remount（换 sessionKey）才
 *    归空 refs → 重建基线、同样零发（baseline-first 双路皆安全）。
 *
 * @param runIds  当前会话 transcript 派生的**所有** runId（ChatWindow 用 filter 派生、禁 find；覆盖多 run）。
 * @param handleSend  useAgentSession 的 handleSend（往当前主脑会话发 user 消息、起真回合）。
 * @param agentRunning  主脑主会话是否忙（=gate：忙则本轮跳过、下轮补发）。
 */
export function useMastermindNudge(
  runIds: string[],
  handleSend: (message: string) => void | Promise<void>,
  agentRunning: boolean,
): void {
  // 上轮快照（null=首挂 → baseline）；remount（切会话）归空是有意的：重建基线 = 天然不重放历史 done。
  const prevRef = useRef<NudgeSnapshot | null>(null);
  // 已发过终态汇总的 key 集合（防 resume 重发；与 prevRef 一样随 remount 归空）。
  const firedFinalRef = useRef<Set<string>>(new Set());

  // handleSend 是 useCallback、身份可能随会话变；塞 ref 供 effect 读最新、不进依赖（避免因它变身份重跑 effect）。
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // runIds 也塞 ref（effect 内读最新去 store 取 run），不进依赖：其身份每渲染变，靠下方 statusSummary 精确触发。
  const runIdsRef = useRef(runIds);
  runIdsRef.current = runIds;

  // 订阅一个**基元字符串**（非新对象）：本会话所有 run 的 stage 状态 + run 状态翻转摘要。
  // zustand 默认 Object.is 比较 → 摘要不变则不重渲/不触发；轮询每 2s 产新对象但摘要稳定则静默（非 messages 长度、
  // 非整个 runs 对象引用）。真状态翻转（含新 run 出现/某 run 拉回）才变字符串 → 触发 effect。runIds 序稳定（派生保序）。
  const statusSummary = useMastermindStore((s) =>
    runIds
      .map((id) => {
        const run = s.runs[id];
        if (!run) return `${id}:∅`;
        const stages = run.stages.map((st) => `${st.order}=${st.status}`).join(",");
        return `${id}:${run.status}[${stages}]`;
      })
      .join("|"),
  );

  useEffect(() => {
    // 从 store 现取本会话 runs 切片（statusSummary 已保证与此刻状态一致；用 getState 免把新对象塞进依赖）。
    const store = useMastermindStore.getState();
    const runsSlice: Record<string, MastermindRun | undefined> = {};
    for (const id of runIdsRef.current) runsSlice[id] = store.runs[id];

    const { nudges, snapshot, firedFinalKeys } = computeNudges({
      prev: prevRef.current,
      runs: runsSlice,
      canFire: !agentRunning,
      firedFinal: firedFinalRef.current,
    });
    // 无论是否发：写回快照（baseline 首轮=全量、发了一条=推进那一 key、忙/无翻转=原样返回 prev）。
    prevRef.current = snapshot;
    for (const k of firedFinalKeys) firedFinalRef.current.add(k);
    // detector 已保证至多一条；for 只为语义清晰。发出即令 agentRunning true→effect 重跑 canFire=false→hold 余下。
    for (const n of nudges) {
      void handleSendRef.current(n.message);
    }
    // statusSummary（翻转摘要）+ agentRunning 是唯二触发；runsSlice/prev/fired 经 ref/getState 读最新、不入依赖
    // （故 exhaustive-deps 不报——effect 体内无未声明的闭包变量）。
  }, [statusSummary, agentRunning]);
}
