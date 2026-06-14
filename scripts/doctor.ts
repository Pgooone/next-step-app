import { runAllChecks } from "../lib/env/doctor-checks";

async function main() {
  const r = await runAllChecks();

  const line = (label: string, res: { ok: boolean; detail: string }) =>
    console.log(`${res.ok ? "✓" : "✗"} ${label}: ${res.detail}`);

  line("Node", r.node);
  line("依赖", r.deps);
  line("凭证", r.credentials);
  line("~/.pi", r.piHome);

  // ① Node / ② 依赖 失败时阻断启动
  if (!r.node.ok || !r.deps.ok) {
    console.error("\n环境自检未通过：Node 版本或内核依赖不满足要求，已阻断启动。");
    process.exit(1);
  }

  // ③ 凭证 / ④ ~/.pi 仅 warning
  if (!r.credentials.ok) {
    console.warn("\n提示：尚未配置模型凭证，启动后请点击侧边栏 Models 按钮添加模型。");
  }
  if (!r.piHome.ok) {
    console.warn("\n提示：~/.pi 目录不可写，项目 / 会话数据可能无法保存，请检查目录权限。");
  }

  process.exit(0);
}

main();
