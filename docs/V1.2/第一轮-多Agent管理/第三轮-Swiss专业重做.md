# 第三轮 · Swiss 极简专业重做（ui-ux-pro-max 驱动）

> 用户用 `ui-ux-pro-max` 技能、要「更专业的 UI/UX」。技能推荐 = **Swiss Minimalism**（`Best For: Enterprise apps, dashboards, SaaS, professional tools`）：高对比、精排版、严谨留白栅格、**克制阴影与渐变**（"Avoid shadows and gradients. Focus on clarity"）、单一强调色、清晰 hover/焦点态、亮暗双主题 ✓ Full、WCAG AAA。用户拍板 **D-V1.2-9 = Swiss 极简**（方向从「玻璃」转向「干净专业」）。
> **保留**第一轮卡片**信息结构**（6 字段：头像 + 名 + 模式徽章 + 模型 + 角色 + 计数）；本轮只换**视觉执行**：收掉玻璃装饰、换 Swiss 干净表面。

## 核心转向

| | 玻璃方向（前两轮，弃） | Swiss 专业（本轮） |
|---|---|---|
| 表面 | 半透明 blur 玻璃 + 极光 + 渐变边 + 模态环境底 | **纯色干净表面 + 细边框**，无 blur/极光/渐变 |
| 头像 | 色块 + cyan→violet 品牌环 | 纯色块 + 首字母（**去环**） |
| 强调 | 极光/渐变多色 | **单一蓝色 accent** |
| hover | 上浮 + 描边 + 极光增强 | 克制：border/bg 渐变 200ms（**无上浮**） |
| 质感来源 | 装饰 | **排版层级 + 留白 + 对比** |

## A · 设计 token（`app/globals.css`）
- `.glass-card.agent-card`：**删** `::before` 极光 + `::after` 渐变边；改 Swiss surface——`background: var(--bg)`、`border:1px solid var(--border)`、`border-radius:10`、**无 blur/极光/渐变**。
  - `:hover`：`border-color: var(--accent)`（可选极淡 `box-shadow:0 1px 3px rgba(0,0,0,0.07)`，Swiss「sharp shadow if any」）；**无 translateY 上浮**。
  - `:focus-visible`：`box-shadow:0 0 0 2px var(--accent-soft)` 焦点环（保留）。
  - `transition: border-color .2s, box-shadow .2s`（Swiss 200ms）。
- `.agent-avatar`：**删 `::after` 品牌环**；纯色块 `agentColor` + 首字母（白字）、`border-radius:8`。
- `.agent-badge`：Swiss 克制——细边 pill（`padding:1px 7px`、`font-size:11`）；doc 中性（`border:var(--border)` + `color:var(--text-muted)`、底透明或极淡 `var(--bg-subtle)`）；coding 语义色但克制（`color/border` 用琥珀、底极淡）。
- `.agent-badge--meta`：极简（`color:var(--text-muted)` + 细边或纯文字）。
- `--modal-glow-1/2`、`--card-glow-1/2`、`--brand-gradient`、`--glass-edge`：本轮**不再引用**（可保留定义不用，或一并删，lead 定；倾向删干净）。
- 字体：**保留 app 现有**（Swiss 专业感靠字阶/层级/留白，**不引 Google Fonts Inter**——本环境 build 取 Google Fonts 失败；可后续单独换本地 Inter）。

## B · AgentManager 卡片 + 模态（`components/AgentManager.tsx`）
- 卡片：Swiss surface（见 A）；字阶 16/13/12/11 保持；留白 8px 节奏；role 1 行 ellipsis。
- 模态面板（约 :283）：`background: var(--bg)`（**去环境底 radial-gradient**）；header 清晰；网格 gap 适度；padding 充足。

## C · DispatchPanel 选择行（`components/DispatchPanel.tsx`）
- Swiss 行：勾选框 + 纯头像（32，**无环**）+ 名 + 模式徽章 + 模型·role 1 行；细边框/分隔；选中态 `border-color:var(--accent)` + 极淡 `var(--accent-soft)` bg；hover 细微。
- 模态面板：去环境底、纯 `var(--bg)`。

## D · 全局专业 checklist（技能 §1-2 CRITICAL）
所有可点元素 `cursor:pointer`；hover/active/disabled 状态清晰；**焦点环可见**；文本对比 ≥4.5:1（亮暗都验）；transition 200ms；`prefers-reduced-motion` 降级保留；图标无 emoji（现用色块+字母，OK）。

## 红线
纯展示层 · 复用 token 不硬编码 · 不改机制/内核 · 保留全部 `data-testid` + 勾选/派发逻辑。

## 验收（双层）
- 门禁：lint + test 绿（build 受 Google Fonts 环境限制、非本轮回归）。
- 真浏览器（lead 亲看截图）：① 干净专业、无玻璃噪音；② 字阶清晰、留白匀、对比高；③ hover/焦点态清晰；④ AgentManager 与 Dispatch 两套界面一致；⑤ 亮/暗双主题；⑥ pageErrors=0 + 不回归。
