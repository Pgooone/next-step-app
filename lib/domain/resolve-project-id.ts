/**
 * 第 8.6 轮 · T3（D-R8.6-11）—— cwd → projectId 反查 helper。
 *
 * 主脑派活工具 / reattach 需按 cwd 反查 projectId，但内核 execute 的 ctx 只暴露 cwd 不暴露 projectId
 * （doc-tools.ts:10-11 坐实、闭包注入先例）。抽此 helper 复用 lookupProfile（session-reattach.ts:63-65）
 * 的「registry.list().find 两侧 normalizeRoot 匹配」手法。
 *
 * 中性叶子：无 "use client"、仅值导入 ProjectRegistry / normalizeRoot（含 node:fs 链，属服务端领域层，
 * 绝不被客户端 value-import，D-R7B-07）。
 */
import { ProjectRegistry, normalizeRoot } from "./project-registry";

/**
 * 按 cwd 反查其所属项目 id；不在任何注册项目下（或 registry 空）返回 null。
 * 两侧 normalizeRoot 后比较（归一化 ~ 展开 / 相对→绝对，避免静默漏命中，同 lookupProfile）。
 * `registry` 仅供测试注入指向 tmpdir 的 registry；生产省略 → `new ProjectRegistry()`（默认 ~/.pi 后端）。
 */
export function resolveProjectIdByCwd(
  cwd: string,
  registry: ProjectRegistry = new ProjectRegistry(),
): string | null {
  const target = normalizeRoot(cwd);
  return registry.list().find((p) => normalizeRoot(p.root) === target)?.id ?? null;
}
