/**
 * 解析乐观锁 If-Match 头为 ifMatch 数值（供 ArtifactService.submitVersion/rollback）。
 * - 头缺省 → undefined（领域层据此不校验、直接放行）。
 * - 头存在但非整数 → 抛带 `code:"INVALID"` 的普通错误，由 domainErrorResponse 鸭子类型映射 422。
 * 取值语义见 D-D1-3：If-Match = 客户端上次读到的 Artifact.version（版本号是整数）。
 *
 * 这里**刻意不 import lib/domain 的 ArtifactError**：errors.ts 用鸭子类型（`"code" in error`）映射、
 * lib/api 与 HTTP 解耦且零 domain 依赖（D-D1-7），故抛带 code 的普通错误即可，行为等价。
 */
export function parseIfMatch(req: Request): number | undefined {
  const im = req.headers.get("If-Match");
  if (im == null) return undefined;
  const n = Number(im);
  if (!Number.isInteger(n)) {
    throw Object.assign(new Error(`非法 If-Match: ${im}`), { code: "INVALID" });
  }
  return n;
}
