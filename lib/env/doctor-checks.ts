import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CheckResult = { ok: boolean; detail: string };

/**
 * 纯函数：从 "v22.22.3" 形式的版本串解析主版本号，与 min 比较。
 * 畸形输入（解析不出数字）返回 false。
 */
export function isNodeVersionOk(version: string, min = 20): boolean {
  const match = /v?(\d+)\./.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= min;
}

export function checkNode(min = 20): CheckResult {
  const version = process.version;
  const ok = isNodeVersionOk(version, min);
  return {
    ok,
    detail: ok
      ? `Node ${version}（>= ${min}）`
      : `Node ${version} 过低，需要 >= ${min}`,
  };
}

/**
 * 用 import() 实际加载内核两个包，兼容 ESM / Next / vitest 三种上下文。
 * 注意必须用「字符串字面量」import：
 *  - 内核为 ESM-only（package.json exports 仅含 import 条件，无 require），
 *    require.resolve 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED；
 *  - 而 import(变量) 在 Next 生产构建里被 webpack 当作运行时动态请求、找不到模块，
 *    只有字面量 import 才能被静态分析并正确打包（与 checkCredentials 同款写法）。
 * 任一加载失败 → ok:false。
 */
export async function checkDeps(): Promise<CheckResult> {
  try {
    await import("@earendil-works/pi-coding-agent");
  } catch {
    return { ok: false, detail: "缺少依赖 @earendil-works/pi-coding-agent，请运行 npm install" };
  }
  try {
    await import("@earendil-works/pi-ai");
  } catch {
    return { ok: false, detail: "缺少依赖 @earendil-works/pi-ai，请运行 npm install" };
  }
  return { ok: true, detail: "内核依赖已安装（@earendil-works/pi-coding-agent、@earendil-works/pi-ai）" };
}

/**
 * 惰性 import 内核，避免本模块加载硬依赖内核（依赖缺失时仍可安全返回 false）。
 * 与 app/api/models/route.ts 的凭证判定保持一致。
 */
export async function checkCredentials(): Promise<CheckResult> {
  try {
    const { AuthStorage, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
    const available = ModelRegistry.create(AuthStorage.create()).getAvailable();
    const ok = available.length > 0;
    return {
      ok,
      detail: ok
        ? `已配置 ${available.length} 个可用模型`
        : "未检测到任何可用模型凭证",
    };
  } catch (err) {
    return { ok: false, detail: `凭证检查失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * 测 ~/.pi 是否可写。piHome 可注入便于单测。
 * 不存在则尝试创建；创建或写入失败 → ok:false。
 */
export function checkPiHome(piHome = join(homedir(), ".pi")): CheckResult {
  try {
    mkdirSync(piHome, { recursive: true });
    accessSync(piHome, constants.W_OK);
    return { ok: true, detail: `${piHome} 可写` };
  } catch (err) {
    return { ok: false, detail: `${piHome} 不可写：${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runAllChecks(): Promise<{
  node: CheckResult;
  deps: CheckResult;
  credentials: CheckResult;
  piHome: CheckResult;
}> {
  const [deps, credentials] = await Promise.all([checkDeps(), checkCredentials()]);
  return {
    node: checkNode(),
    deps,
    credentials,
    piHome: checkPiHome(),
  };
}
