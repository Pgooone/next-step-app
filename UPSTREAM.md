# 上游溯源与对照（UPSTREAM）

> 本文件记录 Next-Step **fork 自哪个上游、哪个版本**，以及**如何对照上游、判断要不要回合并/升级基座**。
> **权威版本号以 `package.json` 的 `upstream` 字段为准**（机器锚）；本文件是人读叙事 + 操作手册。
> 维护约定：每次「对照上游」后，更新 `package.json.upstream.lastComparedUpstream` 与本文件「最近一次对照」节。

## 1. fork 关系（三层）

```
上游基座  @agegr/pi-web          fork 基线 0.6.16  ──┐ 整体复制 + surgical 改造（基座非必要不改）
                                  (导入 commit f923751)│
我们的应用 next-step-app          version 1.2.x       ◄┘ 在基座上叠加领域层（项目/多Agent/文档块级diff）
                                                       │ 依赖（不 fork、只封装，封装层 lib/pi/**）
Agent 内核  @earendil-works/pi-coding-agent + pi-ai    声明 ^0.79.0，跟进 0.79.10
```

- **pi-web**（`@agegr/pi-web`，"Web UI for the pi coding agent"）：我们 fork 的 Web UI 基座。
  - 公开仓库：`https://github.com/agegr/pi-web`（默认分支 `main`，**用 git tag 发版、不用 GitHub Release**）。
  - npm 包 `files` 只含构建产物（`bin`/`.next`/`public`），**不含源码**——源码级 diff 必须走仓库 tag，不能靠 npm 包。
  - 我们的 fork 基线 = **0.6.16**；原始快照另存于 `../next-step-V1/archive/pi-web-code/`。
- **pi 内核**（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`，逐版同步）：Agent 内核。
  - 公开仓库：`https://github.com/earendil-works/pi`（monorepo，`packages/coding-agent`），有完整 GitHub Release notes。
  - 我们 **不 fork、只在 `lib/pi/**` 封装**（红线）。声明 `^0.79.0`。

## 2. 如何对照上游（操作手册）

### 2.1 看上游有没有新版

```bash
npm view @agegr/pi-web version time --json                      # pi-web 最新版 + 各版时间
npm view @earendil-works/pi-coding-agent version time --json    # 内核最新版 + 各版时间
```

- 「我们当前的 pi-web 版本」**不在 node_modules**（我们不依赖 pi-web 包）→ 取 `package.json.upstream.forkBaseVersion`。
- 「我们当前的内核版本」= `node_modules/@earendil-works/pi-coding-agent/package.json` 的 version（首页 `pi v…` 显示的就是它）。

### 2.2 看上游改了什么（源码级 diff）

```bash
# pi-web：用仓库 tag 比对（npm 包无源码）
gh api repos/agegr/pi-web/compare/v0.6.16...v0.6.18 --jq '.total_commits, [.files[].filename]'
gh api "repos/agegr/pi-web/contents/<path>?ref=v0.6.18" --jq '.content' | base64 -d   # 读某文件某版

# 内核：看 Release notes（最可靠）
gh release view v0.80.0 -R earendil-works/pi --json body --jq '.body'
gh release list -R earendil-works/pi -L 10
```

> ⚠️ **教训（2026-06-26）**：判断「修复落在哪个版本」**不要只信 changelog/单一来源**——曾把「扩展工具过滤」修复误归到 0.6.17，`npm pack` 三个版本实测才发现 0.6.17 与 0.6.16 字节相同、真修复在 **0.6.18**。承重事实须 `npm pack` 解包 + 真比对：
> ```bash
> npm pack @agegr/pi-web@0.6.18   # 下到当前目录，tar xzf 后比对 package/.next
> ```

### 2.3 内核版本范围语义（关键）

- `^0.79.0` 对 0.x **锁 minor** = `>=0.79.0 <0.80.0` → **只接受 0.79.x**。`0.80.x` 不会被 `npm install`/`npm update` 自动装，升 0.80 须手动改 `package.json` 的 spec。
- 同 minor 内升级（如 `→0.79.10`）= `npm update @earendil-works/pi-coding-agent @earendil-works/pi-ai`，零破坏。

## 3. 最近一次对照（2026-06-26，V1.2 第六轮）

由 ultracode 调研 + lead npm/GitHub 实测 + file:line 复核驱动。详见 `docs/V1.2/QA/第六轮-版本治理与上游对齐决策.md`。

| 上游 | 我们 | 当时最新 | 结论 |
|---|---|---|---|
| pi-web `@agegr/pi-web` | 0.6.16 | 0.6.18 | 落后 2 补丁；本轮回合并项均判**暂缓**（见下） |
| pi 内核 | 0.79.0 | 0.80.2 | **升到 0.79.10**（本轮 M3，`^0.79.0` 范围内、零破坏、= 上游 pi-web 0.6.18 钉的版本）；**0.80.x 暂不升**（含 pi-ai 入口重组破坏性变更，连上游 pi-web 都未上 0.80） |

**暂缓项（已留 TODO 线索，待将来按需立项）：**
- **rpc-manager 扩展工具过滤修复**（上游 pi-web **0.6.18**，非 0.6.17）：上游修「非空工具预设把扩展工具过滤掉」。本环境**零扩展安装** → 套用是 **provable no-op**，本轮不做。TODO 见 `lib/rpc-manager.ts`。将来真 `npm i` 某 pi 扩展且要在非 doc 路径用它时再做；**doc 会话受限工具集是红线、绝不给它加扩展工具**。
- **markdown 渲染原始 HTML**（上游 pi-web **0.6.17**，新增 `lib/markdown.ts` + `rehype-raw`/`rehype-sanitize`）：是「让 markdown 里原始 HTML 也能渲染（净化过）」的**可选功能**、非 bug 修复，且对现有 KaTeX/mermaid 渲染有回归风险。本轮不做。TODO 见 `components/MarkdownBody.tsx`。

**落在我们已重写区域、合并价值低（供完整性，不再单独评估）：** 上游会话树压缩防栈溢出、扩展模型选择器、智能自动滚动等，集中在我们已分叉的 `hooks/useAgentSession.ts` 等交互层。

## 4. 升级基座的建议路径（将来真要做时）

1. 先按 §2 对照、列出 delta、逐条判「落在未改基座（可受益）/ 已重写区（冲突无意义）」。
2. 内核优先走**同 minor patch**（`npm update`，零破坏）；跨 minor（如 0.80）须先审 `lib/pi/**` 对内核 API 的依赖、跑 `tsc` 看破坏点。
3. pi-web 源码级回合并：从仓库 tag 取 patch，**只合命中未改基座的修复**；合并后必过 `lint`/`test`/`tsc` + UI 改动走真浏览器。
4. 更新本文件「最近一次对照」+ `package.json.upstream`。
