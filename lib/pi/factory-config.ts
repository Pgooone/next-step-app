import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 工厂级运行配置（V1.2 第七轮 T5 / D-V1.2-41）—— 当前仅「全局并发上限」一项。
 *
 * 「并发会话 ≤3」原是硬墙；冻结释槽模型（每阶段跑完 evict 还槽）让它从「硬墙」降级为
 * 「吞吐限流」，故改为可配：默认 3、用户可调，但有 HARD_CAP=100 兜底（真约束是 CPU 吞吐 +
 * LLM 限流、非内存，2026-06-28 资源实测见 ADR D-R7-09）。
 *
 * 落点：用户级 `~/.pi/factory-config.json`，与 `projects.json` 同级（全局并发 = 进程级资源约束，
 * 非 per-project，理由见 ADR D-R7-*）。纯文件、无 DB（沿用 pi-web 哲学）。
 *
 * 读盘容错完全仿 `lib/domain/session-agent-map.ts:27-47` 的 readMap：缺省 / 空 / 解析失败 /
 * 类型不符 / 越界 / 非整数 一律静默回退 DEFAULT_MAX，封装层绝不抛错（acquireSlot 是热路径，
 * 配置坏不能拖垮起会话）。
 */

/** 缺省并发上限（沿用项目原红线 ≤3）。文件缺失 / 损坏 / 字段非法时的兜底值。 */
export const DEFAULT_MAX = 3;

/**
 * 硬上限：用户调到再高也 clamp 到此值。原为 8（基于「每会话 = 独立进程 + 工具子进程常驻」的
 * 保守估计——**已证伪**）；2026-06-28 资源实测（ADR D-R7-09）证一个活会话仅 Next 进程内 ~1MB
 * JS 对象、0 独立进程/子进程、idle 时 0 常驻连接，内存非瓶颈（20G 可用理论容数千会话），故放宽
 * 到 100（用户拍板 D-V1.2-49）。真约束是 CPU 核数（事件循环吞吐）+ 下游 LLM provider 限流，
 * 调高需自担——非内存 OOM。默认仍 3。
 */
export const HARD_CAP = 100;

/** 配置文件落点：`~/.pi/factory-config.json`（与 projects.json 同级，仿 project-registry.ts:34）。 */
function configPath(): string {
  return join(homedir(), ".pi", "factory-config.json");
}

/**
 * 读「全局最大并发会话数」。
 * 缺省 / 空文件 / JSON 解析失败 / 顶层非对象 / 字段缺失或非数字 / NaN / 非整数 → 返 {@link DEFAULT_MAX}；
 * 合法但越界 → clamp 到 `[1, HARD_CAP]`。任何分支都返回一个 `[1, HARD_CAP]` 内的整数，调用方无需再校验。
 */
export function readMaxConcurrent(): number {
  const file = configPath();
  if (!existsSync(file)) return DEFAULT_MAX;

  const raw = readFileSync(file, "utf-8").trim();
  if (!raw) return DEFAULT_MAX;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_MAX;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_MAX;

  const value = (parsed as { maxConcurrentSessions?: unknown }).maxConcurrentSessions;
  // 非数字 / NaN / ±Infinity / 非整数 一律回退缺省（宁可退默认也不静默吃掉脏值）。
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_MAX;

  // 合法整数：clamp 到 [1, HARD_CAP]。
  return Math.min(HARD_CAP, Math.max(1, value));
}
