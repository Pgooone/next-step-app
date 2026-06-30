import localFont from "next/font/local";

// 自托管字体（第8.5轮 T5·D-V1.2-69）：标题字体自托管，正文 CJK 走系统回退。
// woff2 下载自 Google Fonts（容器 --noproxy '*' 直连），放 app/fonts/*.woff2。
// 一律走 next/font/local，不引 Google Fonts 在线字体（容器 build 取不到，ADR D-R1-04）。

// 标题 Latin：Instrument Serif（eyebrow 斜体 + big 正体）。单字重 400，含 normal+italic。
export const instrumentSerif = localFont({
  src: [
    {
      path: "./fonts/InstrumentSerif-Regular-latin.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/InstrumentSerif-Regular-latinExt.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/InstrumentSerif-Italic-latin.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "./fonts/InstrumentSerif-Italic-latinExt.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

// big 标题中文：Noto Serif SC weight 900，已按标题文案 &text= 子集（仅 17 个 CJK 码点）。
export const notoSerifSC = localFont({
  src: [
    {
      path: "./fonts/NotoSerifSC-900-subset.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-noto-serif-sc",
  display: "swap",
});

// 品牌 / UI Latin：Space Grotesk（variable，含 latin + latin-ext）。
export const spaceGrotesk = localFont({
  src: [
    {
      path: "./fonts/SpaceGrotesk-latin.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "./fonts/SpaceGrotesk-latinExt.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  variable: "--font-space-grotesk",
  display: "swap",
});

// 等宽（迁自 layout 在线 Noto_Sans_Mono → 自托管，variable，含 latin + cyrillic）。
// 变量名沿用 --font-noto-mono，globals.css 既有消费点零回归。
export const notoSansMono = localFont({
  src: [
    {
      path: "./fonts/NotoSansMono-latin.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "./fonts/NotoSansMono-cyrillic.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  variable: "--font-noto-mono",
  display: "swap",
});
