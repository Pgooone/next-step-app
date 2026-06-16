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
}

/** 映射存盘位置：项目本地 `<cwd>/.pi/ns-session-map.json`（D-V1.1-01）。 */
function mapPath(cwd: string): string {
  return join(cwd, ".pi", "ns-session-map.json");
}

/** 空映射（文件不存在 / 解析失败时的兜底值）。 */
function emptyMap(): SessionMap {
  return { mainSessionId: null, bySession: {} };
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
  return { mainSessionId, bySession };
}

/** 读某会话的归属 agentId；无归属返回 null。 */
export function getOwner(cwd: string, sid: string): string | null {
  return readMap(cwd).bySession[sid] ?? null;
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
