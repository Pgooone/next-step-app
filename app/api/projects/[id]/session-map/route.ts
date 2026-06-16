import { NextResponse } from "next/server";
import { ProjectRegistry } from "@/lib/domain/project-registry";
import { domainErrorResponse } from "@/lib/api/errors";
import { listAllSessions } from "@/lib/session-reader";
import {
  pruneMissing,
  readMap,
  removeOwner,
  setMain,
  setOwner,
} from "@/lib/domain/session-agent-map";

/** 该项目 cwd 下当前存活的会话 id 集合（供惰性清理注入）。 */
async function liveSessionIds(cwd: string): Promise<Set<string>> {
  const sessions = await listAllSessions();
  return new Set(sessions.filter((s) => s.cwd === cwd).map((s) => s.id));
}

// GET /api/projects/[id]/session-map — 返回 SessionMap（含惰性清理：丢弃已不存在的会话项）
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const cwd = new ProjectRegistry().get(id).root;
    const pruned = pruneMissing(readMap(cwd), await liveSessionIds(cwd));
    return NextResponse.json(pruned);
  } catch (error) {
    return domainErrorResponse(error);
  }
}

/**
 * PATCH /api/projects/[id]/session-map — 增量改映射，返回最新 SessionMap。
 * body 三种互斥意图（按字段判定）：
 *  - { mainSessionId: string | null }            → 设/清主对话
 *  - { sessionId: string, agentId: string }      → 增/改某会话归属
 *  - { sessionId: string, agentId: null }        → 删某会话归属
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const cwd = new ProjectRegistry().get(id).root;
    const body = (await req.json().catch(() => ({}))) as {
      mainSessionId?: unknown;
      sessionId?: unknown;
      agentId?: unknown;
    };

    if ("mainSessionId" in body) {
      const main = body.mainSessionId;
      if (main !== null && typeof main !== "string") {
        return NextResponse.json(
          { error: "mainSessionId 须为 string 或 null", code: "INVALID" },
          { status: 422 },
        );
      }
      return NextResponse.json(setMain(cwd, main));
    }

    if (typeof body.sessionId === "string") {
      if (body.agentId === null) {
        return NextResponse.json(removeOwner(cwd, body.sessionId));
      }
      if (typeof body.agentId === "string") {
        return NextResponse.json(setOwner(cwd, body.sessionId, body.agentId));
      }
      return NextResponse.json(
        { error: "agentId 须为 string（设归属）或 null（删归属）", code: "INVALID" },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { error: "请求体须含 mainSessionId 或 sessionId", code: "INVALID" },
      { status: 422 },
    );
  } catch (error) {
    return domainErrorResponse(error);
  }
}
