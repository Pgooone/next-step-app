# P0 承重墙·档位1 —— profile.tools × artifact-guard 共存 spike

> 状态：✅ **已实测通过**（2026-06-18，`@earendil-works/pi-coding-agent@0.79.x`，`node v22`）。
> `node --conditions=import --import tsx harness.ts` → **11/11 PASS，exit 0**，`tsc --noEmit` 通过。

## 目的：回答「接线命门」

P0 档位1 真实接线时（`lib/pi/profile-session-wiring.ts:105`）会把两层 options 合并：

```ts
createAgentSession({ ...profileOptions, ...guardOptions, model, ... })
```

- `profileOptions` 关键只有 `tools: profile.tools` —— **白名单**，取值是
  `CODING_TOOL_NAMES = ["read","bash","edit","write","grep","find","ls"]` 的子集。
- `guardOptions = assembleArtifactGuardOptions(...)` = `{ noTools:"builtin", customTools:[同名 7 工具] }`
  （C 路线：复用内核 write/edit 工厂，只把写盘动作改成「受管拦截 / 非受管放行」）。

D2 / `lib/pi/artifact-guard.test.ts` 已证明【裸会话】（只有 guard、无白名单）下 guard 工作。
**但从没测过叠加 `profile.tools` 白名单层。** 本 spike 唯一新增就是起会话时把
`tools: profileTools` 与 guard 的 options 一起传，验证：

> **白名单与 `noTools:"builtin"+customTools` 共存时，guard 的受管写拦截是否仍成立？**

## 命门为何只能靠「行为」证明

C 路线 guard 复用内核工厂，custom write/edit 的 `name` / `label` 仍是 `"write"`/`"edit"`，
与内置 **同名同 label，不可分辨**。所以「当前激活的 write 是 guard 版而非内置版」无法用 label 区分，
只能靠行为：受管路径写 → PendingChange 落 `pending/` + 磁盘无目标文件 + 无 `versions/2.json`（= guard 胜）；
若反而真落盘 / 出现 `versions/2.json` → 内置 write 胜出 → 命门 FAIL。

## 跑法

cwd = 仓库根（`next-step-V1.1/`），任选其一：

```bash
node --conditions=import --import tsx spike/p0-profile-guard/harness.ts
# 或
NODE_OPTIONS="--conditions=import" node_modules/.bin/tsx spike/p0-profile-guard/harness.ts
# 或
npm run --prefix spike/p0-profile-guard spike
```

类型检查：`node_modules/.bin/tsc --noEmit -p spike/p0-profile-guard/tsconfig.json`。

### 为何需要 `--conditions=import`（环境约束，非命门结论）

本 harness 经 `../../lib/*.ts` 间接 import `@earendil-works/pi-coding-agent`，而 `lib/` 受仓库根
**CJS** `package.json` 管辖、被 tsx 当 CJS 加载。该包 `exports` 只给了 `import` 条件（无 `require`），
CJS `require` 解析会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。`--conditions=import` 让 `require` 解析也走
`import` 导出（Node 22 支持 `require(ESM)`），即可放行。**裸 `tsx harness.ts` 会失败——这是模块解析
环境约束，与命门结论无关**（对比：`spike/d2-intercept` 直接 import 包、不碰 lib，故裸 tsx 即可跑）。

## 测试矩阵

每个 case 用**全新 temp 项目 + 全新受管 artifact**（避免串扰），打印
`profileTools` / `session.getActiveToolNames()` / `write.label` / 行为结果。

| Case | profileTools | 断言要点 |
|---|---|---|
| **A（FULL，go/no-go 核心）** | 全 7 工具 | active ⊇ 全 7；受管 write → PendingChange 落盘 + 磁盘无文件 + 无 `versions/2.json`（行为证明 guard 胜）；非受管 write → 正常落盘 + 无 pending；受管 edit → pending 落盘（含 NEW） |
| **A'（partial 含 write/edit）** | `["read","write","edit"]` | active ⊇ {read,write,edit} 且 **不含** bash/grep/find/ls（断言④：profile 限制被尊重）；受管 write 仍被拦成 pending |
| **B（只读）** | `["read"]` | active 只含 read、**不含** write/edit（只读 profile 语义完好） |
| **C（空）** | `[]` | active 为空数组 |

## 内核事实（已查证，支撑断言）

- `sdk.js:132`：`initialActiveToolNames = (options.tools ? [...options.tools] : options.noTools ? [] : default).filter(...)`
  —— **`options.tools` 存在时 noTools 被完全忽略**，active 集 = `[...tools]`。
- `agent-session.js:1868-1871`：toolRegistry 先塞内置（被 `isAllowedTool` 过滤）、再用 customTools 按名 `.set` 覆盖。
- `agent-session.js:1823`：`isAllowedTool(name) = (!allowed || allowed.has(name)) && !excluded?.has(name)`
  —— 工具要进激活集，名字必须 ∈ tools 白名单。
- 推论：内置 write 与 guard custom write 同名 → custom 覆盖内置；但二者都需 `"write" ∈ tools` 才进表/激活。

## 命门结论

✅ **PASS（可行）。** `{...profileOptions(tools 白名单), ...guardOptions(noTools+customTools)}` 共存下：

1. 白名单只决定「**有哪些**工具」（active 集 = `[...tools]`），profile 的收窄/只读/清空语义完好（Case A'/B/C）。
2. 只要 `write`/`edit` 在白名单内，guard 的同名 custom 工具仍覆盖内置工具，受管写仍被拦成 PendingChange、
   不落盘、不产新版本（Case A 行为证明）；非受管路径照常放行。

→ P0 档位1 按 `{...profileOptions, ...guardOptions}` 接线可行，不需为「白名单 × guard 共存」另想办法。
（注意：白名单**必须包含** write/edit，否则相应工具根本不激活——这是 profile 配置约束，不是 guard 失效。）
