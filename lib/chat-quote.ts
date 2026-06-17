/**
 * BUG-05 · §C 引用注入 —— 把 ArtifactPanel 划选的引用文本拼到用户消息最前面的纯逻辑。
 *
 * 划选「引用到对话框」写入 useArtifactStore 的 editTarget.quoteText；发送时（普通 / steer /
 * follow-up 三路径）由 useAgentSession 在「即将发给 agent」处读出并经本函数拼进消息头。
 * 抽成纯函数便于单测（仓库测试环境为 node + 仅收集 lib/**，hook 本身测不了）。
 */

/**
 * 把引用文本拼到正文前面：`【引用：{quoteText}】\n\n{message}`。
 * 引用为空（undefined / 纯空白）时原样返回正文，跳过注入。
 */
export function composeQuotedMessage(quoteText: string | undefined, message: string): string {
  const q = quoteText?.trim();
  if (!q) return message;
  return `【引用：${q}】\n\n${message}`;
}
