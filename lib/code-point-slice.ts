/**
 * 按 Unicode 码点切片字符串前 n 个码点（n<0 视为 0）。
 *
 * 打字机逐字推进时若直接用 `str.slice(0, n)`（按 UTF-16 码元），遇到代理对
 * （emoji / 部分生僻字）会把一个字符切成半个、渲染出乱码方块。改用 Array.from
 * 先拆成码点数组再切，保证每步落在完整字符边界（C2/C12 加固，本组中文短语本就安全）。
 */
export function sliceByCodePoint(str: string, n: number): string {
  if (n <= 0) return "";
  return Array.from(str).slice(0, n).join("");
}

/** 字符串的码点长度（= Array.from(str).length），打字机用来判断是否已打完。 */
export function codePointLength(str: string): number {
  return Array.from(str).length;
}
