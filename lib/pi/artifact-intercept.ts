import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ProjectRegistry } from "../domain/project-registry";

/**
 * 受管 artifact 写盘目标的反查结果。
 */
export type ManagedTarget = { projectId: string; artifactId: string };

/**
 * 运行时判定一个写盘绝对路径是否落在某项目的受管 artifact 目录下，并解出 (projectId, artifactId)。
 * 不命中（普通文件写、或落在 Iter C 派发产物目录）返回 null —— 调用方据此放行正常写盘（D-D2-2）。
 *
 * 设计（决策 D-D2-2：运行时计算、不建持久化索引）：
 * - 不预埋 realpath→artifactId 索引（D-D1-4 故意留到 D2），单用户项目少，扫描 registry 即可（同 findArtifact 哲学）。
 * - 仅做**词法归一** `resolve(absPath)`（处理 `.` / `..`），**不**用 `fs.realpathSync`：
 *   受管 artifact 的写盘目标文件此刻可能尚不存在（agent 新写），realpath 会抛 ENOENT。
 *   调用方应已用 `resolve(ctx.cwd, params.path)` 把相对路径转绝对再传入；这里再 resolve 一次做防御。
 * - 命中判据：路径在 `<root>/.pi/artifacts/managed/<id>/` 之下（`<id>` 取 managed 下第一段），
 *   且 `<id>/artifact.json` 真实存在（确认是受管 artifact，而非恰好同名的无关目录）。
 * - 不误命中 Iter C：派发产物在 `<root>/.pi/artifacts/<dispatchId>/`（managed 的父级），
 *   `relative(managedRoot, …)` 会以 `..` 开头 → 自然排除。
 */
export function resolveManagedTarget(
  absPath: string,
  registry: ProjectRegistry = new ProjectRegistry(),
): ManagedTarget | null {
  const target = resolve(absPath);

  for (const project of registry.list()) {
    const managedRoot = resolve(join(project.root, ".pi", "artifacts", "managed"));
    const rel = relative(managedRoot, target);

    // rel 以 ".." 开头或为绝对路径 → 不在 managedRoot 之下
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;

    // managed 下第一段即 artifactId（兼容平台分隔符）
    const artifactId = rel.split(/[\\/]/)[0];
    if (!artifactId) continue;

    // 确认是受管 artifact（artifact.json 存在），否则视为无关目录、放行
    if (existsSync(join(managedRoot, artifactId, "artifact.json"))) {
      return { projectId: project.id, artifactId };
    }
  }

  return null;
}
