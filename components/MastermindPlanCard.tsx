"use client";

import { useState } from "react";
import { useMastermindStore, type MastermindResumeAction } from "@/lib/stores/useMastermindStore";
import { useAgentStore, selectAgentsForProject } from "@/lib/stores/useAgentStore";
import { friendlyAgentName } from "@/lib/mastermind/friendly-name";
// D-R7B-07：领域层含 node:fs，UI 只 import type + fetch JSON。
import type { MastermindRun, MastermindTeammate } from "@/lib/domain/mastermind-run-store";

/**
 * 主脑「派活计划卡」（乙·对标 Kimi，内联进对话流）——按 run.status 分支渲染：
 *   - awaiting_plan_approval：plan.teammates（friendly 名/role/子任务/验收）+ 成本信号「派 N 个队员」
 *     （N=plan.teammates.length·非 stages.length，Trap 6）+ notes + 确认/否决/打回 三按钮（六路由入口）。
 *   - paused：failedTeammate + failureOptions 四抉择（retry/skip/abort 只带 action；reassign 先从档案池选 newAgentId）。
 *   - done/partial/failed：终态只读文案（无按钮）。running 态**不由本卡渲**（走 MastermindTeammateCards 的 stages 卡片）。
 *
 * 错误处置统一在 store 层（postWithRefetch：任意非 2xx → re-fetch GET 覆盖 + toast，吸收 approve 409 / reject 等 422）。
 * running 态的 stages 卡片渲染在容器 MastermindTeammateCards（本卡只管非 running 分支）。
 */
export default function MastermindPlanCard({ run }: { run: MastermindRun }) {
  const { approve, reject, revise, resume } = useMastermindStore();
  const [busy, setBusy] = useState(false);

  const projectId = run.projectId;
  // 三按钮点一次即置 busy 防抖（防双 fire；store 层再兜幂等 409）。await 后复位。
  const runAction = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (run.status === "awaiting_plan_approval") {
    const teammates = run.plan.teammates;
    return (
      <div data-testid="mastermind-plan-card" style={cardBox}>
        <div data-testid="mastermind-plan-waiting" style={waitingBar}>
          <span aria-hidden style={{ fontSize: "0.95rem", lineHeight: 1 }}>
            ⏳
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 650, color: "var(--run-accent)" }}>等你确认放行</span>
            <span style={{ fontSize: "0.68rem", color: "var(--sub)" }}>
              主脑已暂停，确认或打回后才会继续
            </span>
          </div>
        </div>

        <div style={cardHead}>
          <span style={{ fontWeight: 700 }}>派活计划</span>
          <span data-testid="mastermind-plan-cost" style={costPill}>
            派 {teammates.length} 个队员
          </span>
        </div>

        <ExecutionModeBadge execution={run.plan.execution} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {teammates.map((t, i) => (
            <TeammateRow key={i} teammate={t} />
          ))}
        </div>

        {run.plan.notes.trim() && (
          <div style={notesBox}>
            <span style={{ color: "var(--sub)", fontWeight: 600, marginRight: 6 }}>说明</span>
            {run.plan.notes}
          </div>
        )}

        <div style={btnRow}>
          <button
            data-testid="mastermind-approve"
            disabled={busy}
            onClick={() => runAction(() => approve(projectId, run.id))}
            style={primaryBtn(busy)}
          >
            确认放行
          </button>
          <button
            data-testid="mastermind-revise"
            disabled={busy}
            onClick={() => runAction(() => revise(projectId, run.id))}
            style={ghostBtn(busy)}
          >
            打回改计划
          </button>
          <button
            data-testid="mastermind-reject"
            disabled={busy}
            onClick={() => runAction(() => reject(projectId, run.id))}
            style={ghostBtn(busy)}
          >
            否决
          </button>
        </div>
      </div>
    );
  }

  if (run.status === "paused" && run.failedTeammate) {
    return (
      <PausedDecision
        run={run}
        busy={busy}
        onResume={(action, newAgentId) =>
          runAction(() => resume(projectId, run.id, action, newAgentId))
        }
      />
    );
  }

  // 终态只读（done / partial / failed）。partial 提示含被跳过阶段。
  if (run.status === "done" || run.status === "partial" || run.status === "failed") {
    const skippedCount = run.stages.filter((s) => s.status === "skipped").length;
    const label =
      run.status === "done"
        ? "计划已完成"
        : run.status === "partial"
          ? `计划已完成（含 ${skippedCount} 个跳过的阶段）`
          : `计划已终止${run.failedReason ? ` · ${run.failedReason}` : ""}`;
    return (
      <div data-testid="mastermind-plan-card" style={cardBox}>
        <div style={{ ...cardHead, marginBottom: 0 }}>
          <span style={{ fontWeight: 700, color: run.status === "failed" ? "var(--error)" : "var(--sub)" }}>
            {label}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * 执行模式小徽章（M6/D-V1.2-87）：parallel=「并行扇出」（注明物理并发受全局会话上限约束）/
 * serial=「串行接力」（上游产物喂下游）。缺省（旧计划无字段）= serial。克制一行、走 t-kimi token。
 */
function ExecutionModeBadge({ execution }: { execution?: "serial" | "parallel" }) {
  const parallel = execution === "parallel";
  return (
    <div data-testid="mastermind-plan-execution" style={execRow}>
      <span style={{ ...execBadge, color: parallel ? "var(--run-accent)" : "var(--sub)" }}>
        {parallel ? "⑂ 并行扇出" : "→ 串行接力"}
      </span>
      <span style={{ fontSize: "0.66rem", color: "var(--sub)", lineHeight: 1.35 }}>
        {parallel
          ? "队员同时开跑（物理并发受全局会话上限约束，含主脑）"
          : "按顺序接力，上游产物喂给下游"}
      </span>
    </div>
  );
}

/** 单个待派队员行：friendly 名 + role + 子任务 + 验收。 */
function TeammateRow({ teammate }: { teammate: MastermindTeammate }) {
  return (
    <div style={teammateRowBox}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 650, color: "var(--text)", fontSize: "0.82rem" }}>
          {friendlyAgentName(teammate.name)}
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--sub)" }}>· {teammate.role}</span>
      </div>
      <div style={{ fontSize: "0.74rem", color: "var(--task)", marginTop: 3, lineHeight: 1.4 }}>
        {teammate.subTask}
      </div>
      {teammate.acceptanceCriteria.trim() && (
        <div style={{ fontSize: "0.68rem", color: "var(--sub)", marginTop: 3, lineHeight: 1.35 }}>
          <span style={{ opacity: 0.8 }}>验收 · </span>
          {teammate.acceptanceCriteria}
        </div>
      )}
    </div>
  );
}

/** paused 态失败抉择：retry / reassign(选 newAgentId) / skip / abort。 */
function PausedDecision({
  run,
  busy,
  onResume,
}: {
  run: MastermindRun;
  busy: boolean;
  onResume: (action: MastermindResumeAction, newAgentId?: string) => void;
}) {
  const ft = run.failedTeammate!;
  const options = run.failureOptions ?? ["retry", "reassign", "skip", "abort"];
  const [reassigning, setReassigning] = useState(false);
  const [pickedAgentId, setPickedAgentId] = useState("");

  // reassign 池：读当前项目档案（含运行期临时造的 role-uuid8 档案，D-R8.6-11 Q2「存档进池」）。
  const agents = useAgentStore((s) => selectAgentsForProject(s, run.projectId));

  return (
    <div data-testid="mastermind-plan-card" style={cardBox}>
      <div style={{ ...cardHead, marginBottom: 8 }}>
        <span style={{ fontWeight: 700, color: "var(--error)" }}>阶段失败 · 待抉择</span>
      </div>
      <div style={{ fontSize: "0.76rem", color: "var(--task)", lineHeight: 1.45, marginBottom: 8 }}>
        第 {ft.order} 阶段（{friendlyAgentName(ft.agentId)}）失败：{ft.reason}
      </div>

      {reassigning ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <select
            data-testid="mastermind-reassign-select"
            value={pickedAgentId}
            onChange={(e) => setPickedAgentId(e.target.value)}
            style={reassignSelect}
          >
            <option value="">选择接手的 Agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {friendlyAgentName(a.name)} · {a.role || "无角色"}
              </option>
            ))}
          </select>
          <div style={btnRow}>
            <button
              data-testid="mastermind-reassign-confirm"
              disabled={busy || !pickedAgentId}
              onClick={() => onResume("reassign", pickedAgentId)}
              style={primaryBtn(busy || !pickedAgentId)}
            >
              交给 TA 重跑
            </button>
            <button disabled={busy} onClick={() => setReassigning(false)} style={ghostBtn(busy)}>
              返回
            </button>
          </div>
        </div>
      ) : (
        <div style={btnRow}>
          {options.includes("retry") && (
            <button
              data-testid="mastermind-resume-retry"
              disabled={busy}
              onClick={() => onResume("retry")}
              style={primaryBtn(busy)}
            >
              重试
            </button>
          )}
          {options.includes("reassign") && (
            <button
              data-testid="mastermind-resume-reassign"
              disabled={busy}
              onClick={() => setReassigning(true)}
              style={ghostBtn(busy)}
            >
              换人
            </button>
          )}
          {options.includes("skip") && (
            <button
              data-testid="mastermind-resume-skip"
              disabled={busy}
              onClick={() => onResume("skip")}
              style={ghostBtn(busy)}
            >
              跳过
            </button>
          )}
          {options.includes("abort") && (
            <button
              data-testid="mastermind-resume-abort"
              disabled={busy}
              onClick={() => onResume("abort")}
              style={ghostBtn(busy)}
            >
              放弃
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 样式（全用 t-kimi token，须在 .pipeline-board t-kimi 壳内渲染才生效） ----
// awaiting 态顶部等待条：细底色条 + ⏳，让用户一眼看出「主脑在等我」非「对话结束」（静态、无动画）。
const waitingBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
  padding: "0.4rem 0.6rem",
  borderRadius: 8,
  background: "var(--run-bg)",
  border: "1px solid var(--run-accent)",
  fontSize: "0.78rem",
};
const cardBox: React.CSSProperties = {
  background: "var(--container)",
  border: "1px solid var(--line)",
  borderRadius: 11,
  padding: "0.7rem 0.8rem",
  color: "var(--text)",
};
const cardHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
  fontSize: "0.85rem",
};
const costPill: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: "0.68rem",
  padding: "0.1rem 0.5rem",
  borderRadius: 999,
  background: "var(--run-bg)",
  color: "var(--run-accent)",
  fontWeight: 600,
};
// 执行模式徽章行：小徽章 + 一句说明，位于计划头与队员列之间。
const execRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 8,
  flexWrap: "wrap",
};
const execBadge: React.CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 650,
  padding: "0.1rem 0.5rem",
  borderRadius: 999,
  background: "var(--run-bg)",
  whiteSpace: "nowrap",
};
const teammateRowBox: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--card-bd)",
  borderLeft: "3px solid var(--accent)",
  borderRadius: 8,
  padding: "0.45rem 0.6rem",
};
const notesBox: React.CSSProperties = {
  marginTop: 8,
  fontSize: "0.72rem",
  color: "var(--task)",
  lineHeight: 1.45,
};
const btnRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 10,
  flexWrap: "wrap",
};
const reassignSelect: React.CSSProperties = {
  width: "100%",
  padding: "0.35rem 0.5rem",
  fontSize: "0.76rem",
  background: "var(--bg-hover)",
  color: "var(--text)",
  border: "1px solid var(--line)",
  borderRadius: 8,
};
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: "0.76rem",
    padding: "0.32rem 0.8rem",
    borderRadius: 8,
    border: "1px solid var(--run-accent)",
    background: "var(--run-accent)",
    color: "#fff",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontWeight: 600,
  };
}
function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: "0.76rem",
    padding: "0.32rem 0.8rem",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "none",
    color: "var(--sub)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}
