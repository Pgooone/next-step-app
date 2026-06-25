import type { SessionMap } from "./domain/session-agent-map";

/**
 * 主对话「懒认定」判定（M7 · 功能#5.2，D-V1.1-09）。
 *
 * 取舍：不预建空 main 会话（普通会话本就是首条消息才落盘的懒创建，强建空会话会撞
 * B4「幻影空会话」坑、且违 pi-web「首条消息才落盘」哲学）。改为——当项目尚无主对话
 * （mainSessionId 为空）时，把首个落地的普通会话认作主对话。
 *
 * 纯函数：给定当前映射与一条新落地会话 id，返回「应被设为 main 的 sessionId」或 null
 * （已有主对话、或入参为空 → 不动）。调用方据非 null 结果调 setMain 落盘。
 */
export function pickMainOnSessionCreated(
  map: SessionMap,
  newSessionId: string | null | undefined,
): string | null {
  if (!newSessionId) return null;
  if (map.mainSessionId) return null; // 已有主对话，不抢占
  return newSessionId;
}

/**
 * 进项目时「应恢复哪条会话」判定（T3 · 第五轮）。
 *
 * 进项目（或刷新/深链）时左栏需自动选回一条会话，无需用户手动点：
 *  - URL 上的 `?session=`（urlSessionId）最优先——深链/刷新当前会话须精确恢复；
 *  - 否则回到该项目的主对话（map.mainSessionId）——「进项目默认恢复主会话」核心诉求；
 *  - 两者皆空 → 返回 null，由调用方走默认 cwd 选择 / 新建态（T4）。
 *
 * 纯函数：不查会话是否真实存在（调用方据返回 id 在 allSessions 里 find，找不到再降级）。
 */
export function pickSessionToRestoreOnEnter(
  map: SessionMap,
  urlSessionId: string | null | undefined,
): string | null {
  if (urlSessionId) return urlSessionId; // URL 优先
  return map.mainSessionId;
}
