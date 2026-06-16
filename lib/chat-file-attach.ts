/**
 * M2 · chat-file-upload —— 对话框文本文件上传的纯逻辑。
 *
 * 把「文本文件 → 内核官方 <file> 内联格式」的拼装与「图片 / 文本 / 不支持」的分流
 * 判断抽成纯函数，供 ChatInput 调用，并供 M8（@agent 转交载荷）复用同一 <file> 格式。
 * 不碰内核 / pi-ai，不涉及 DOM 与 FileReader（IO 留在组件层）。
 */

/** 文本类文件白名单扩展名（含点，小写）。可扩展。 */
export const TEXT_FILE_EXTENSIONS = [
  ".md", ".txt", ".json", ".csv", ".log",
  ".py", ".ts", ".tsx", ".js", ".jsx",
  ".html", ".css", ".yaml", ".yml", ".xml", ".sql", ".sh",
] as const;

/** 文件选择器 accept 串：图片 + 文本类白名单。 */
export const FILE_INPUT_ACCEPT = `image/*,${TEXT_FILE_EXTENSIONS.join(",")}`;

/** 单文件软提示阈值：> 256KB 提醒消耗大量 token，不阻断。 */
export const LARGE_FILE_THRESHOLD = 256 * 1024;

/** 取文件名的小写扩展名（含点）；无扩展名返回空串。 */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

/**
 * 分流判断：图片走多模态通道，文本类走 <file> 内联，其余不支持。
 * @param fileName 文件名（取扩展名用）
 * @param mimeType File.type（可能为空串）
 */
export function classifyFile(
  fileName: string,
  mimeType: string,
): "image" | "text" | "unsupported" {
  if (mimeType.startsWith("image/")) return "image";
  if ((TEXT_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName))) {
    return "text";
  }
  return "unsupported";
}

/** 单文件是否超过软提示阈值。 */
export function isLargeFile(size: number): boolean {
  return size > LARGE_FILE_THRESHOLD;
}

/**
 * 把一个文本文件拼成内核官方 <file> 块。
 * 浏览器上传无绝对路径，name 用文件名（与内核 @file 的绝对路径语义不同，本功能可接受）。
 */
export function buildFileBlock(name: string, content: string): string {
  return `<file name="${name}">\n${content}\n</file>`;
}

/** 一个待发送的文本附件。 */
export interface TextAttachment {
  name: string;
  content: string;
}

/**
 * 把消息正文与文本附件拼成最终发送文本：正文在前，<file> 块依次附在后面。
 * 正文为空时只发 <file> 块；无附件时原样返回正文。供 M8 转交载荷复用。
 */
export function composeMessageWithFiles(
  message: string,
  attachments: TextAttachment[],
): string {
  if (attachments.length === 0) return message;
  const blocks = attachments.map((a) => buildFileBlock(a.name, a.content)).join("\n");
  return message ? `${message}\n\n${blocks}` : blocks;
}
