// 流水线/阶段看板的 Agent 头像：dicebear notionists，纯本地生成 data: URI（断网可渲染、零网络请求）。
// 依赖 @dicebear/core@9 + @dicebear/collection@9（core@10 要求 node>=22 与本项目 engines>=20 冲突，勿升）。
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";

/**
 * 由稳定 seed（建议传 agentId）生成确定性 notionists 头像，返回内联 data:image/svg+xml URI。
 * v9 的 Result.toDataUri() 同步返回 string（实测无 toDataUriSync、无 async/fetch；不要 await）。
 */
export function agentAvatarDataUri(seed: string): string {
  return createAvatar(notionists, { seed }).toDataUri();
}
