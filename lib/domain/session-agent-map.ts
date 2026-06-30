import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 「会话 ↔ agent / 主对话」归属映射（M5，功能#5 承重墙）。
 * 会话数据结构无 `agentId`（`lib/types.ts:174-184`）且不可改 pi 内核会话文件，
 * 故 Next-Step 领域层另存一份附加元数据；M7/M8 依赖此映射。权威类型见 docs/03。
 */
export interface SessionMap {
  /** 该项目固定「主对话」会话 id（无则为 null，由 M7 懒创建/取首个）。 */
  mainSessionId: string | null;
  /** sessionId → agentId（某会话属于哪个 agent）。 */
  bySession: Record<string, string>;
  /**
   * 第 8.6 轮（D-R8.6-09）：被装为「主脑（总管）」的会话 id 集合。idle 重建时据此识别主脑会话、
   * 重装总管 resourceLoader + 派活工具（resolver 主脑分支）。**与 mainSessionId 语义独立**——主脑会话
   * 不一定是 mainSessionId（同项目第 2+ 个主脑会话根本不是首个会话；关掉总管的主对话也是 mainSessionId
   * 却非主脑），故不复用 getMain 识别。绝不与 bySession/owner-map 语义重叠。
   */
  mastermindSessions: string[];
}

/** 映射存盘位置：项目本地 `<cwd>/.pi/ns-session-map.json`（D-V1.1-01）。 */
function mapPath(cwd: string): string {
  return join(cwd, ".pi", "ns-session-map.json");
}

/** 空映射（文件不存在 / 解析失败时的兜底值）。 */
function emptyMap(): SessionMap {
  return { mainSessionId: null, bySession: {}, mastermindSessions: [] };
}

/** 读映射；文件不存在或内容损坏均回退空映射（领域层不抛 HTTP 错误）。 */
export function readMap(cwd: string): SessionMap {
  const file = mapPath(cwd);
  if (!existsSync(file)) return emptyMap();
  const raw = readFileSync(file, "utf-8").trim();
  if (!raw) return emptyMap();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyMap();
  }
  if (!parsed || typeof parsed !== "object") return emptyMap();
  const obj = parsed as Partial<SessionMap>;
  return {
    mainSessionId: typeof obj.mainSessionId === "string" ? obj.mainSessionId : null,
    bySession:
      obj.bySession && typeof obj.bySession === "object"
        ? (obj.bySession as Record<string, string>)
        : {},
    // D-R8.6-09 命门：必须重建保留 mastermindSessions，否则 marker 写了读不回、idle 主脑哑火无报错。
    mastermindSessions: Array.isArray(obj.mastermindSessions)
      ? obj.mastermindSessions.filter((s): s is string => typeof s === "string")
      : [],
  };
}

/** 「临时文件 + rename」原子落盘（仿 agent-profile-store.ts，防多会话并发写损坏）。 */
function writeMap(cwd: string, map: SessionMap): void {
  const file = mapPath(cwd);
  const dir = join(cwd, ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`, "utf-8");
  renameSync(tmp, file);
}

/**
 * 惰性清理（纯函数）：丢弃 `bySession` 中已不存在的会话项、并在 `mainSessionId`
 * 已不存在时清为 null（兜底外部直接删 `.jsonl` 的情形，映射不残留）。
 * 由 GET API 层注入存活会话 id 集合后调用——领域层据此保持内核无关、可单测。
 */
export function pruneMissing(map: SessionMap, liveSessionIds: Set<string>): SessionMap {
  const bySession: Record<string, string> = {};
  for (const [sid, agentId] of Object.entries(map.bySession)) {
    if (liveSessionIds.has(sid)) bySession[sid] = agentId;
  }
  const mainSessionId =
    map.mainSessionId && liveSessionIds.has(map.mainSessionId) ? map.mainSessionId : null;
  // D-R8.6-09：同 mainSessionId 处理——剔除已死的主脑会话 id（外部直接删 .jsonl 后映射不残留）。
  const mastermindSessions = (map.mastermindSessions ?? []).filter((sid) =>
    liveSessionIds.has(sid),
  );
  return { mainSessionId, bySession, mastermindSessions };
}

/** 读某会话的归属 agentId；无归属返回 null。 */
export function getOwner(cwd: string, sid: string): string | null {
  return readMap(cwd).bySession[sid] ?? null;
}

/**
 * 反查某 agent 名下**全部** profile 会话 id（bySession 是 sid→agentId 单向映射，setOwner 只增不删旧项，
 * 故一个 agent 可有多条会话——如先起会话再 @转交复用同档案）。
 * 只命中 bySession——主对话存 mainSessionId 不在此。**第五轮（T1）起 dispatch worker 会话也写
 * bySession**（供左栏按 agent 分组），故本函数现也会命中该 agent 名下的派发 worker 会话；用于「改
 * mode 后逐出该 agent 存活会话」（方案B，见 [[evictAgentSessions]]）时，进行中的 worker 会话也会被
 * 一并逐出（先 abort 再 destroy、无数据损坏，仅令该 assignment 走失败分支，可接受）。
 */
export function sessionsForAgent(cwd: string, agentId: string): string[] {
  return Object.entries(readMap(cwd).bySession)
    .filter(([, a]) => a === agentId)
    .map(([sid]) => sid);
}

/** 标记某会话归属某 agent（原子落盘）。 */
export function setOwner(cwd: string, sid: string, agentId: string): SessionMap {
  const map = readMap(cwd);
  map.bySession[sid] = agentId;
  writeMap(cwd, map);
  return map;
}

/** 移除某会话的归属（原子落盘）；无该项则无副作用。 */
export function removeOwner(cwd: string, sid: string): SessionMap {
  const map = readMap(cwd);
  if (sid in map.bySession) {
    delete map.bySession[sid];
    writeMap(cwd, map);
  }
  return map;
}

/** 读该项目的主对话会话 id；无则 null。 */
export function getMain(cwd: string): string | null {
  return readMap(cwd).mainSessionId;
}

/** 设该项目的主对话会话 id（传 null 清除，原子落盘）。 */
export function setMain(cwd: string, sid: string | null): SessionMap {
  const map = readMap(cwd);
  map.mainSessionId = sid;
  writeMap(cwd, map);
  return map;
}

/**
 * 第 8.6 轮（D-R8.6-09）：标记某会话为「主脑（总管）」（原子落盘，幂等——已含则无副作用）。
 * 由 /api/agent/new 主脑分支在拿到 realSessionId 后服务端同步调用（零窗口）。
 * **绝不**碰 bySession/owner-map 既有语义——只增 mastermindSessions 一个集合。
 */
export function markMastermind(cwd: string, sid: string): SessionMap {
  const map = readMap(cwd);
  if (!map.mastermindSessions.includes(sid)) {
    map.mastermindSessions.push(sid);
    writeMap(cwd, map);
  }
  return map;
}

/** 第 8.6 轮（D-R8.6-09）：某会话是否被标记为「主脑」。idle 重建时 resolver 据此分流到主脑 reattach。 */
export function isMastermind(cwd: string, sid: string): boolean {
  return readMap(cwd).mastermindSessions.includes(sid);
}
