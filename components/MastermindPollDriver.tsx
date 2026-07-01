"use client";

import { useEffect, useRef } from "react";
import { useMastermindStore, selectMastermindNeedsPolling } from "@/lib/stores/useMastermindStore";

/** 轮询间隔（ms），对齐 PipelineBoard.tsx:10 / DispatchPanel。 */
const POLL_INTERVAL = 2000;

/**
 * 主脑运行的**单宿主批量轮询驱动**（不渲任何 UI，仅挂一个 setInterval）。
 *
 * 为何单宿主而非每张卡各自定时器（待设计点·多 run 并存）：一条对话可有多条 submit_plan（打回后旧 failed 卡 +
 * 新卡并存）→ 多 runId 同时存在；每卡各自 setInterval = N 定时器 + N 份卸载清理，React 并发渲染下卸载时机
 * 错位漏清 = 内存泄漏。此处一个 interval 遍历 running 子集逐个 GET、一处 clearInterval。
 *
 * 依赖只钉「是否存在任一 running run」的布尔——running 集合每 2s 产新对象但布尔稳定，不会每次 store 更新
 * 重建定时器。轮询函数塞 ref（不进依赖），tick 时读最新 store。挂在 ChatWindow 消息流宿主内、随会话切换卸载。
 */
export default function MastermindPollDriver() {
  const pollRunning = useMastermindStore((s) => s.pollRunning);
  // 是否存在任一 running run（仅此布尔进依赖，避免 running 集合每 tick 变对象导致定时器重建）。
  const hasRunning = useMastermindStore((s) =>
    Object.values(s.runs).some(selectMastermindNeedsPolling),
  );

  const pollRef = useRef(pollRunning);
  pollRef.current = pollRunning;

  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => {
      pollRef.current().catch(() => {});
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [hasRunning]);

  return null;
}
