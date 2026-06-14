# D2 拦截可行性验证（spike）

> 状态：✅ **已实测通过**（2026-06-14，`@earendil-works/pi-coding-agent@0.79.3`）。
> `npx tsx harness.ts` → 11/11 PASS，exit 0，`tsc --noEmit` 通过。

## 要回答的问题

在「不 fork pi 内核」红线下，能否拦截 agent 的 `edit`/`write`，**让它不真的写盘**，
而是把改动转成可供 HITL 按块确认的数据？

## 结论：可行

用 `createAgentSession({ noTools: "builtin", customTools: [自定义 write/edit] })` 装配
**同名替身工具**，替身 `execute` 内不写盘、只把内容/patch 捕获下来即可。验证覆盖三层（见 `harness.ts`）：

- **Tier 1a（纯 execute）**：直接调用替身 execute，磁盘无文件、改动进内存 `captured[]`、返回 shape 合法。
- **Tier 1b（会话装配）**：替身在会话里覆盖了内置工具（`getToolDefinition("write").label` 是替身）。
- **Tier 2（faux 端到端）**：用 pi-ai 的 `faux` provider 让 agent **真发一次 write 工具调用**，
  事件流出现 `tool_execution_start/end tool=write`，替身被命中、磁盘无文件。

写盘的唯一落点是内置 `write.js:157` / `edit.js:208`，都在工具 `execute` 内部；内核拿到工具结果后
只塞进消息历史、不旁路写目标文件（全包 grep 确认）——所以**替换同名工具就能阻止写盘**
（注册表是按 `name` 作 key 的 Map，自定义工具在内置之后 `.set()` 覆盖，`agent-session.js:1823-1898`）。

## ⚠️ 关键坑：用 `noTools:"builtin"`，不要用 `excludeTools`

实测对比（harness Tier 1b）：

| 组合 | active 工具 | write 是替身？ |
|---|---|---|
| `excludeTools:["write","edit"] + customTools` | `["read","bash"]` | ❌ 否 |
| `noTools:"builtin" + customTools` | `["write","edit"]` | ✅ 是 |

根因（`sdk.js:131-135`）：active 集 = 初始集**再 filter 掉 excludeTools 里的名字**，
denylist 按名字最后生效，会把同名替身一起剔除。`noTools:"builtin"` 让初始内置集为空、
自定义工具照常加入，同名替身得以存活。

## 确切 API（v0.79.3 实测）

- import：`{ createAgentSession, defineTool }` + `type AgentToolResult` 来自
  `@earendil-works/pi-coding-agent`；`{ Type }`（TypeBox）来自 `@earendil-works/pi-ai`（**别从裸 typebox import**，避免双份实例）。
- `defineTool({ name, label, description, parameters, execute })`；`execute(toolCallId, params, signal, onUpdate, ctx)`。
- 返回 `AgentToolResult`：`{ content: [{type:"text", text}], details, terminate? }` —— **`details` 必填**（undefined 也要显式写）。
- 内置 `write` 参数 `{ path, content }`，`details: undefined`。
- 内置 `edit` 参数 `{ path, edits: [{oldText, newText}] }`（驼峰、无 `replaceAll`），
  `details: { diff, patch, firstChangedLine? }`；正式实现建议复刻其 `prepareArguments`
  （处理 `edits` 为 JSON 字符串 / legacy 顶层 `oldText` 的模型）。
- 校验替身是否生效：`session.getActiveToolNames()` / `session.getToolDefinition(name)?.label`。

## 对 D2 正式实现的建议

1. **主方案**：`noTools:"builtin" + customTools:[替身 write/edit]`，替身 execute 转 PendingChange/diff_blocks、绝不写盘；
   `details` 复刻内置形状（write→`undefined`，edit→`{diff,patch,firstChangedLine}`）让下游 `renderResult` 不报错。
2. **备选（更省代码）**：内置 `createWriteToolDefinition(cwd,{operations})` / `createEditToolDefinition(cwd,{operations})`
   支持注入自定义 `writeFile/mkdir/readFile`，可在**保留内置 diff/patch 生成**的同时把写盘动作改成"捕获"。正式实现时二选一评估。
3. 本机制只解决「拦截」；「受管 Artifact 如何识别」（显式注册表 + realpath→artifactId 索引）
   与「写 staging 副本还是纯内存捕获」是 D1/D2 的下一层设计，不在本 spike 范围。

## 文件

- `harness.ts` —— 验证脚本，`npx tsx harness.ts`（Tier 1a / 1b / 2）。
- `package.json` / `tsconfig.json` / `package-lock.json` —— 仅 spike 用（pi 内核 0.79 + tsx）。
- `node_modules/` 已 gitignore；重新跑请先 `npm install`。
