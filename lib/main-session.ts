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
