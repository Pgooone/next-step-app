import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/rpc-manager";
import { startOrchestratorSession, type PromptImage } from "@/lib/pi/orchestrator-session-wiring";
import { markMastermind } from "@/lib/domain/session-agent-map";
import { resolveProjectIdByCwd } from "@/lib/domain/resolve-project-id";

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids.
    // `mastermind` 旗标必须从 command 解构掉，否则会落进 promptCommand 被下方 send 当作 prompt 参数带走。
    const { provider, modelId, toolNames, thinkingLevel, mastermind, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; mastermind?: boolean; [key: string]: unknown };

    // 第 8.6 轮（D-R8.6-10②）：主脑（总管）模式分支——装总管 prompt + 派活工具，走独立装配函数，
    // **不污染**普通主对话起会话链。`mastermind === true` 严格判（禁 `!== false`，undefined 会误入）。
    // 主脑分支自身在内部应用预选 model/thinking + 发首条 message（D-B4-3 落盘），故不再走下方
    // set_model / set_thinking_level / 发 prompt 的普通序列（避免首条 message 重发）。
    const isMastermind = mastermind === true;
    if (isMastermind) {
      // T3：按 cwd 反查 projectId 传下去，让 submit_plan 闭包能真落 MastermindRun（cwd 不在注册项目下则
      // 为 null → submit_plan 退回桩行为、不崩）。
      const projectId = resolveProjectIdByCwd(cwd);
      // session 不在本分支消费（model/thinking + 首条 message 已在 startOrchestratorSession 内处理）。
      // images 透传——普通分支 session.send(promptCommand) 带 images，主脑分支须对齐（零回归）。
      const { realSessionId } = await startOrchestratorSession({
        cwd,
        firstMessage: promptCommand.message as string,
        ...(projectId ? { projectId } : {}),
        ...(Array.isArray(promptCommand.images) && promptCommand.images.length
          ? { images: promptCommand.images as PromptImage[] }
          : {}),
        ...(provider && modelId ? { model: { provider, modelId } } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
      // 服务端同步标记该会话为主脑（D-R8.6-10③，零窗口），供 idle 重建识别。
      markMastermind(cwd, realSessionId);
      // 保持 files-route 允许根缓存同步（与普通分支同款，见下方注释）。
      globalThis.__piAllowedRootsCache?.roots.add(cwd);
      // 首条 message 已在 startOrchestratorSession 内 fire-and-forget 发出（事件经 SSE 流出）；
      // data 与普通分支的 prompt 结果同为 null（wrapper 对 prompt 命令 fire-and-forget 返 null）。
      return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
    }

    // 普通主对话分支（字节级零回归）。
    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    globalThis.__piAllowedRootsCache?.roots.add(cwd);

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
