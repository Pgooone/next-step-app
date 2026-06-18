import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: ["spike/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // 允许以 `_` 前缀显式标注「有意未使用」的形参（如自定义工具 execute 须匹配内核 5 参
      // 签名 (toolCallId, params, signal, onUpdate, ctx)，但只用 params 一项；保留完整签名有
      // 文档价值）。仍捕获非 `_` 前缀的真未用变量。
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
