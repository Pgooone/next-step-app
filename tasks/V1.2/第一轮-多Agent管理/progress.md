# V1.2 第一轮 · 多 Agent 管理 —— 任务进度（progress）

> vibe-coding 第 3 步。实现 = `ns-impl` agent team 逐批次（**每卡新队员**）；lead 协调 + 门禁绿即**独立真浏览器验收** + **逐卡 commit**。
> 详细规格见 `../../../docs/V1.2/第一轮-多Agent管理/详细设计.md`（§1~§4 各模块 + §0.1 红线铁律 + §5 验收要点）。

## 总进度
- [ ] **批次 1** · 玻璃 token（`app/globals.css`）—— 模块 A（基座）
- [ ] **批次 2** · AgentCard + AgentList（`components/AgentManager.tsx`）—— 模块 B+C
- [ ] **批次 3** · DispatchPanel 选择卡 + 技术债（`DispatchPanel.tsx` + AgentManager 4 处）—— 模块 D
- [ ] 真浏览器双层验收（lead 独立 + team e2e；含**基线/前后对比图**）
- [ ] 回写 docs/progress + 记忆 + push（push 由用户定）

---

## 批次 1 · 玻璃 token —— AC
- [ ] `globals.css` **末尾追加** token（`:root` + `html.dark` 各一套）：`--accent-soft` / `--card-glow-1` / `--card-glow-2` / `--brand-gradient` / `--glass-edge` / `--mode-coding-{fg,bg,bd}`
- [ ] `.glass-card.agent-card` 作用域增强（`::before` 极光 / `::after` mask 渐变边 / `:hover` / `:focus-visible`）—— ⚠️ **绝不裸 `.glass-card`**（承重铁律）
- [ ] `.agent-avatar` 品牌环 + `.agent-badge`（doc/coding/meta/mono）+ `prefers-reduced-motion` 降级
- [ ] **既有变量 / 既有 `.glass-card` 规则一行未改**（只追加）
- [ ] 门禁绿（lint/test/build）→ lead 独立 commit

## 批次 2 · AgentCard + AgentList —— AC
- [ ] AgentCard 三段式 6 字段：身份行（`.agent-avatar` 头像 + 名 + 模式文字徽章）/ 模型行 / role 2 行摘要（line-clamp）/ meta 页脚计数
- [ ] `className` `glass-card` → `glass-card agent-card`；`aspectRatio:1` → `minHeight:132`；**保留**全部 `data-testid` + `onClick` + `title`
- [ ] 字段渲染条件：model 用 `splitModel(p.model)?.modelId ?? p.model`（**非** `?? '默认'`）；tools 仅 `coding && >0`；thinking 仅非 `off`；空段隐藏
- [ ] 新增 `data-testid`：`agent-card-mode` / `agent-card-skills` / `agent-card-tools` / `agent-card-thinking`
- [ ] AgentList grid `minmax(150→176px,1fr)`；新建空卡加 `agent-card` + `minHeight:132` 等高
- [ ] 门禁绿 → **lead 独立真浏览器验收**（亮/暗 × 字段条件 × **不污染全局** × 不回归 × pageErrors=0）→ commit

## 批次 3 · DispatchPanel + 技术债 —— AC（批次 2 收口后开）
- [ ] DispatchPanel 选 agent 行升级玻璃风 + 复用 `.agent-badge` 模式徽章；**保留** `dispatch-agent-item` testid + 勾选 / MIN-MAX 逻辑
- [ ] 硬编码 `rgba(37,99,235,0.x)` → `var(--accent-soft)`（AgentManager 4 处 + DispatchPanel 1 处，**逐处核准语义**再替换；行号会随批次 2 漂移）
- [ ] 门禁绿 → lead 独立真浏览器验收（选 agent 行新风 + 模式徽章 + 选中态亮暗自适应 + 不回归）→ commit

---

## DoD（每批次通用）
`lint + test + build` 绿 → **lead 亲跑真浏览器**（项目红线：UI 卡必走，不认 teammate 自证）→ `pageErrors=0` + Read 截图核对 → 勾 progress → 逐卡**中文 commit**（结尾 `Co-Authored-By`）。每卡开工前对照 `详细设计.md` §0.1 红线。
