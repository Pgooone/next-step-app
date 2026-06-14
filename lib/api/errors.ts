import { NextResponse } from "next/server";

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  INVALID: 422,
  VERSION_CONFLICT: 409,
};

/** 把领域错误（带 string 类型的 code 字段）映射为符合 docs/04 契约的 HTTP 响应。 */
export function domainErrorResponse(error: unknown): NextResponse {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    const message = error instanceof Error ? error.message : code;
    return NextResponse.json({ error: message, code }, { status: STATUS_BY_CODE[code] ?? 500 });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
