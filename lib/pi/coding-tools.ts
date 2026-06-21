/**
 * 内置编码工具固定集的**唯一真相源**（D-30，源 rpc-manager PRESET_FULL）。
 * 中性叶子模块（无 "use client"、无 server-only 依赖），供 client（useAgentStore/AgentManager
 * 勾选 UI）与 server（profile-session-wiring 编码型空 tools 兜底，D-MODE-05）**共用同一份**，避免漂移。
 */
export const CODING_TOOL_NAMES: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
