import type { SessionInfo } from "./types";
import type { SessionMap } from "./domain/session-agent-map";
import type { AgentProfile } from "./domain/agent-profile-store";

/**
 * 左栏会话分组（M7 · 功能#5.4）。把当前 cwd 过滤后的会话按归属切成三类：
 *  ① 主对话（mainSessionId 命中的那一条，0 或 1 条）
 *  ② 各 Agent 分组（按 SessionMap.bySession 聚合，每组带 agent 名/色点）
 *  ③ 其它会话（无归属、且非主对话）
 * 纯函数，不依赖 DOM，便于单测；渲染层据此分区，组内仍走现有 buildSessionTree。
 */

/** 一个 agent 分组：归属同一 agentId 的会话集合 + 展示用名称/色点。 */
export interface AgentSessionGroup {
  agentId: string;
  /** agent 档案名；档案已删/查不到时回退 agentId 短串。 */
  agentName: string;
  /** 色点（来自 useAgentStore.agentColor，按名稳定）。档案缺失时为 null。 */
  color: string | null;
  sessions: SessionInfo[];
}

export interface GroupedSessions {
  /** 主对话会话（mainSessionId 命中且在当前列表中）；无则 null。 */
  main: SessionInfo | null;
  /** 各 agent 分组（按 agent 名升序，稳定）。 */
  agentGroups: AgentSessionGroup[];
  /** 无归属、非主对话的其它会话。 */
  others: SessionInfo[];
}

/**
 * 把扁平会话列表按 SessionMap 分三区。
 * @param sessions 已按 cwd 过滤的会话（顺序原样保留到各分区内）
 * @param map      会话归属映射（建议传 selectMapForProject 的结果以防串显）
 * @param resolveAgent agentId → {name,color}；查不到返回 null（档案已删）
 */
export function groupSessionsByOwner(
  sessions: SessionInfo[],
  map: SessionMap,
  resolveAgent: (agentId: string) => { name: string; color: string } | null,
): GroupedSessions {
  let main: SessionInfo | null = null;
  const byAgent = new Map<string, SessionInfo[]>();
  const others: SessionInfo[] = [];

  for (const s of sessions) {
    if (map.mainSessionId && s.id === map.mainSessionId) {
      main = s;
      continue; // 主对话独占，即便它也有 owner 也只进主区
    }
    const owner = map.bySession[s.id];
    if (owner) {
      const list = byAgent.get(owner);
      if (list) list.push(s);
      else byAgent.set(owner, [s]);
    } else {
      others.push(s);
    }
  }

  const agentGroups: AgentSessionGroup[] = [...byAgent.entries()].map(([agentId, sList]) => {
    const resolved = resolveAgent(agentId);
    return {
      agentId,
      agentName: resolved?.name ?? agentId.slice(0, 8),
      color: resolved?.color ?? null,
      sessions: sList,
    };
  });
  // 按 agent 名升序稳定排序（名相同再按 agentId 兜底）
  agentGroups.sort(
    (a, b) => a.agentName.localeCompare(b.agentName) || a.agentId.localeCompare(b.agentId),
  );

  return { main, agentGroups, others };
}

/** 由 agent 列表构造 resolveAgent 闭包（名/色来自 useAgentStore.agentColor）。 */
export function makeAgentResolver(
  agents: AgentProfile[],
  colorOf: (name: string) => string,
): (agentId: string) => { name: string; color: string } | null {
  const byId = new Map(agents.map((a) => [a.id, a]));
  return (agentId: string) => {
    const a = byId.get(agentId);
    if (!a) return null;
    return { name: a.name, color: colorOf(a.name) };
  };
}
