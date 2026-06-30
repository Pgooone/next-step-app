/**
 * 首页（项目墙）炫酷深色 shader 试点开关（第8.5轮 T5 · AC4 可回退）。
 *
 * 仅首页生效：on = 深色玻璃 + WebGL shader 背景；off = 现有浅色 ProjectHome 原样。
 * 默认 on（展示试点）；设 NEXT_PUBLIC_HOME_SHADER=0/false/off 即一键回退浅色。
 *
 * 用 NEXT_PUBLIC_ 前缀让其在客户端可读（Next 编译期内联），无需运行时配置。
 */
const raw = process.env.NEXT_PUBLIC_HOME_SHADER;

export const HOME_SHADER = raw !== "0" && raw !== "false" && raw !== "off";
