# scripts（命令行脚本）

> 归属：Next-Step 新增。

## doctor.ts — 环境自检 CLI
检查 ① Node 版本 ② 内核依赖 ③ 模型凭证 ④ `~/.pi` 可写，逐项打印 `✓/✗ + detail`。
检查逻辑全部来自 `lib/env/doctor-checks.ts`，本脚本只是 CLI 壳。

### 运行
```bash
npm run doctor
```

### 退出码语义
- **① Node / ② 依赖** 任一失败 → `exit 1`（阻断 `npm run dev`）。
- **③ 凭证 / ④ ~/.pi** 失败 → 仅 `console.warn` 引导，**不影响退出码**，最终 `exit 0`。

### predev 钩子
`package.json` 配置了 `"predev": "tsx scripts/doctor.ts"`，
`npm run dev` 前自动执行自检；①②不满足时阻断启动。
