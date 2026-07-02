// 第 8.6 轮第二期 T1（M1 中间路 nudge）—— 阶段翻转检测**纯函数**（客户端安全：零 node:fs / 零 React）。
//
// 背景（D-R8.6-15）：主脑（总管）派活后 run 由 headless 队员 worker 跑、主脑主会话 LLM 退场（T6 刻意解耦）。
// 前端观察 run 进度，每个队员干完 → 隐式 nudge 主脑吐一句阶段小结；全干完 → nudge 主脑产总汇总受管文档。
// 本模块只负责「给定 prev 快照 + 当前 runs 切片 → 算出本轮该发的 nudge + 新快照」，不碰 handleSend / store /
// React（口子/gate/订阅全在薄封装 hook useMastermindNudge）。抽纯函数是为了 vitest 直测（只跑 lib/**/*.test.ts）。
//
// **承重命门（评审 REFUTED 后的两条铁律，全落在本文件）**：
//  1. baseline-first 去重：prev===null（首挂首轮）一律**只建基线、零发**——防 F5/切回把 module store 满载的
//     历史 done 整串重放成真回合（remount 时调用方的 useRef 归空、但 useMastermindStore module store 跨 remount
//     满载历史 done，两者生命周期不对称）。见 D-R8.6-15 M1-P3。
//  2. 一 tick 至多发一条：主脑主会话单会话、handleSend 设 agentRunning 是异步 React state；同帧连发两条会因
//     stale agentRunning 都放行、撞内核「回合进行中」。故本函数**每次至多输出一条 nudge**、快照只推进这一条对应
//     的 key，其余翻转留在 prev 里下一 tick（agentRunning 落回 false 后）补发。顺序：先阶段小结、后终态汇总。
//
// 依赖 @/lib/domain/mastermind-run-store 的**类型**（import type 编译期擦除、不引值符号，故客户端安全，守 D-R7B-07）。
import type {
  MastermindRun,
  MastermindStageStatus,
  MastermindRunStatus,
} from "@/lib/domain/mastermind-run-store";

/**
 * 一次该发的 nudge：key 用于去重/快照推进（全含 runId、跨 run 天然不串），message 是发给主脑的隐式 user 文本。
 * kind 供 hook 区分终态汇总（需并入 firedFinal 双保险）与阶段小结。
 */
export interface NudgeEvent {
  /** 快照推进主键：stage 用 `${runId}:stage:${order}`、run 终态/paused 用 `${runId}:run`（含 runId 跨 run 隔离）。 */
  key: string;
  /** 该 nudge 所属 runId（终态汇总记 firedFinal 用，免去从 key 反解析）。 */
  runId: string;
  /** 发给主脑主会话的隐式 user 消息（措辞反诱导，不让主脑再 submit_plan / 调工具）。 */
  message: string;
  /** final=run 终态汇总（hook 据此并入 firedFinal Set 防 resume 重发）；stage=阶段小结/paused 提醒。 */
  kind: "stage" | "final";
}

/**
 * 上一轮已「确立（基线）或已发过」的状态快照。key→status：
 *  - stage：`${runId}:stage:${order}` → MastermindStageStatus
 *  - run 　：`${runId}:run` → MastermindRunStatus
 * 用普通对象（可结构化比对 + 便于 `{...prev, [key]: v}` 单键推进）；由 hook 存进 useRef（remount 归空=有意，触发 baseline）。
 */
export type NudgeSnapshot = Record<string, string>;

/** computeNudges 的入参。 */
export interface ComputeNudgesInput {
  /** 上轮快照；**null=首挂首轮**（触发 baseline-first：只建基线、零发）。 */
  prev: NudgeSnapshot | null;
  /** 当前会话 transcript 派生的**所有** run（runId → run；ChatWindow 用 filter 派生、禁 find）。缺失/未拉回的 runId 略过。 */
  runs: Record<string, MastermindRun | undefined>;
  /** 主脑主会话此刻是否空闲可发（=!agentRunning）。false=忙 → 本轮零发、快照原样保留、下轮补发。 */
  canFire: boolean;
  /** 已发过终态汇总的 key 集合（`${runId}:__final__`）；防 resume paused→running→done 重发汇总（双保险之一）。 */
  firedFinal: ReadonlySet<string>;
}

/** computeNudges 的返回。 */
export interface ComputeNudgesResult {
  /** 本轮该发的 nudge：**至多一条**（一 tick 一发，见文件头铁律 2）。空=不发。 */
  nudges: NudgeEvent[];
  /** 写回 hook useRef 的新快照（baseline 首轮=当前全量；发了一条=prev 推进那一个 key；忙/无翻转=prev 原样）。 */
  snapshot: NudgeSnapshot;
  /** 本轮发出的终态汇总 key（供 hook 并入 firedFinal Set）；未发终态则空。 */
  firedFinalKeys: string[];
}

const STAGE_DONE: MastermindStageStatus = "done";
/** run 终态汇总触发集：running→done/partial 都发汇总收尾 nudge。 */
const RUN_SUMMARY_STATUSES: ReadonlySet<MastermindRunStatus> = new Set<MastermindRunStatus>(["done", "partial"]);

function stageKey(runId: string, order: number): string {
  return `${runId}:stage:${order}`;
}
function runKey(runId: string): string {
  return `${runId}:run`;
}
function finalKey(runId: string): string {
  return `${runId}:__final__`;
}

/** 队员显示名：优先计划里的 role（如「日本市场研究员」），退回阶段 agentName 剥 uuid8 后缀（friendly-name 同规则）。 */
function teammateLabel(run: MastermindRun, order: number): string {
  const role = run.plan?.teammates?.[order - 1]?.role;
  if (role && role.trim()) return role.trim();
  const name = run.stages.find((s) => s.order === order)?.agentName ?? "";
  const stripped = name.replace(/-[0-9a-f]{8}$/i, "").trim();
  return stripped || name || `队员 ${order}`;
}

/** 阶段小结 nudge 文案（反诱导：只文字汇报、不调工具、不提交新计划）。 */
function stageMessage(order: number, label: string): string {
  return `（第 ${order} 个队员「${label}」已完成，请只用文字简要汇报这一步的进展，不要调用任何工具、不要提交新计划）`;
}

/** 终态汇总 nudge 文案（反诱导：汇总收尾、不再 submit_plan、带 runId）。 */
function summaryMessage(runId: string): string {
  return `（runId=${runId} 的所有队员已完成，这是汇总收尾：请产出一份汇总受管文档并给我文字摘要，不要再 submit_plan）`;
}

/** run 转 paused（某队员两次失败等抉择）→ 提醒主脑到卡片处理（非汇总、不并入 firedFinal）。 */
function pausedMessage(runId: string): string {
  return `（runId=${runId} 有队员失败、运行已暂停，请到派活卡片上处理，暂时不要调用工具）`;
}

/**
 * 从当前 runs 全量派生快照（纯、确定：只反映「现在世界长啥样」）。
 * 只收本函数关心的 key（各 stage 状态 + 各 run 状态）；缺失/未拉回的 run 略过（下轮拉回再计）。
 */
function snapshotOf(runs: Record<string, MastermindRun | undefined>): NudgeSnapshot {
  const snap: NudgeSnapshot = {};
  for (const runId of Object.keys(runs)) {
    const run = runs[runId];
    if (!run) continue;
    snap[runKey(runId)] = run.status;
    for (const stage of run.stages) {
      snap[stageKey(runId, stage.order)] = stage.status;
    }
  }
  return snap;
}

/**
 * 核心检测：给定 prev 快照 + 当前 runs，算「本轮该发的 nudge（至多一条）+ 新快照」。
 *
 * 判据（只对**本地观察到的**翻转发，靠 prev 里有旧值 + 现值不同；均要求 prev 里有该 key，无 key=首见略过）：
 *  - stage：prev 非 done → 现 done ⇒ 阶段小结。
 *  - run　：现 done/partial 且 prev 非 done/partial（**首次进入终态**）⇒ 终态汇总，另受 firedFinal 双保险约束。
 *           用「首次进入」而非「prev===running」：resume 后 prev[run] 可能停在 paused（paused→running 非我们
 *           关心的翻转、不推进快照），若卡 prev===running 则 paused→…→done 的汇总会永久漏发（真 bug）。
 *  - run　：现 paused 且 prev 非 paused（首次进入 paused）⇒ 提醒（发一句、不并入 firedFinal）。
 *  - run→failed（用户主动 cancel/reject/revise）⇒ 不发。
 *
 * 顺序：先所有阶段小结（按 runId 再按 order 稳定）、后终态/paused（同序）；一 tick 只取列表首条发。
 * baseline-first：prev===null ⇒ 只建基线、nudges 空（文件头铁律 1）。
 */
export function computeNudges(input: ComputeNudgesInput): ComputeNudgesResult {
  const { prev, runs, canFire, firedFinal } = input;
  const full = snapshotOf(runs);

  // 铁律 1：首挂首轮只建基线、零发（防历史 done 重放）。
  if (prev === null) {
    return { nudges: [], snapshot: full, firedFinalKeys: [] };
  }

  // 收集所有本地观察到的翻转（stage 小结在前、run 终态/paused 在后；均按 runId+order 稳定排序）。
  const runIds = Object.keys(runs)
    .filter((id) => runs[id])
    .sort();

  const stageFlips: NudgeEvent[] = [];
  const terminalFlips: NudgeEvent[] = [];

  for (const runId of runIds) {
    const run = runs[runId]!;
    // 阶段小结：某 stage prev 非 done、现 done（prev 里必须有该 key 才算「本地观察到的翻转」，无 key=首见略过）。
    const orderedStages = [...run.stages].sort((a, b) => a.order - b.order);
    for (const stage of orderedStages) {
      const k = stageKey(runId, stage.order);
      const before = prev[k];
      if (before !== undefined && before !== STAGE_DONE && stage.status === STAGE_DONE) {
        stageFlips.push({ key: k, runId, message: stageMessage(stage.order, teammateLabel(run, stage.order)), kind: "stage" });
      }
    }
    // run 终态/paused：按「首次进入目标态」判（prev 里有旧值才算本地观察到、且旧值不同）。
    const rk = runKey(runId);
    const beforeRun = prev[rk];
    if (beforeRun !== undefined && beforeRun !== run.status) {
      if (RUN_SUMMARY_STATUSES.has(run.status as MastermindRunStatus) && !RUN_SUMMARY_STATUSES.has(beforeRun as MastermindRunStatus)) {
        // 首次进入 done/partial。双保险：已发过该 run 的终态汇总（firedFinal 命中）→ 跳过（防 resume 后重发）。
        if (!firedFinal.has(finalKey(runId))) {
          terminalFlips.push({ key: rk, runId, message: summaryMessage(runId), kind: "final" });
        }
      } else if (run.status === "paused") {
        // 首次进入 paused（beforeRun≠paused 已由外层保证）。
        terminalFlips.push({ key: rk, runId, message: pausedMessage(runId), kind: "stage" });
      }
      // run→failed（用户主动）不发。
    }
  }

  const ordered = [...stageFlips, ...terminalFlips];

  // 忙（canFire=false）或本轮无翻转：零发、快照**原样保留**（未推进 = 下轮空闲时重新检出并补发）。
  if (!canFire || ordered.length === 0) {
    return { nudges: [], snapshot: prev, firedFinalKeys: [] };
  }

  // 铁律 2：一 tick 只发首条；快照只推进这一个 key（其余翻转留在 prev 下轮补发）。
  const fire = ordered[0];
  const currentStatusForKey = full[fire.key] ?? prev[fire.key];
  const nextSnapshot: NudgeSnapshot = { ...prev, [fire.key]: currentStatusForKey };
  return {
    nudges: [fire],
    snapshot: nextSnapshot,
    firedFinalKeys: fire.kind === "final" ? [finalKey(fire.runId)] : [],
  };
}
