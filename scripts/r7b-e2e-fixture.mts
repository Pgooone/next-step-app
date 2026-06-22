/**
 * 第七轮·第二轮「内联 diff 纠偏」E2E 验收 fixture（一次性测试资产，不属实现代码）。
 * tsx 在项目根跑、共用 ~/.pi/projects.json。把 FIXTURE_JSON 打到 stdout 末行供驱动读取。
 *
 * ⚠️ 与第七轮/D3 fixture 的关键区别（D-R7B-06 验收造数据纠偏）：
 *   artifact.content = **A_OLD（改动前的旧内容）**，PendingChange diff = old→new。
 *   这是**真实 propose 流程**产生的形态（红线：未确认不写盘，故正文恒为旧内容）。
 *   d3-e2e-fixture 当年把 content 设成 A_NEW（变更已呈现）才让旧 buildSegments 锚得到——
 *   那是把"真实流程必坏"的 case 反向造成"通过"的假绿元凶。本 fixture 反过来用 A_OLD，
 *   验证新的 buildLineDiffSegments（按 LCS ops 真实顺序渲染）能真正在原文内联呈现。
 *
 * 复用一个现成 pi 会话的 cwd 作项目 root（让 ChatWindow 能离开 isEmptyNew 欢迎态、
 *   中栏 PendingChangeCard 可挂，供 A3 点击跳转真测），并把该 sessionId 传给驱动经 ?session= 恢复。
 */
import { ProjectRegistry } from "../lib/domain/project-registry";
import { ArtifactService } from "../lib/domain/artifact-service";
import {
  PendingChangeStore,
  buildReplacePendingChange,
} from "../lib/domain/pending-change-service";

const registry = new ProjectRegistry();
const artifacts = new ArtifactService(registry);
const store = new PendingChangeStore(registry);

// 复用现成会话 cwd（存在、是允许根；其会话非空→ChatWindow 离开欢迎态→中栏卡可挂）。
const root = process.env.REUSE_CWD || "/home/dev/pi-cwd-20260622/r7-1782087399552";
const sessionId = process.env.REUSE_SESSION_ID || "019eece6-6dba-78f8-be9c-ebca2f82d2c0";
const project = registry.create({ name: `第二轮验收-${Date.now()}`, root });

// 旧内容（= 真实 propose 阶段的 artifact.content）。含多级 markdown 标题（验 equal 段富渲染）+
// del/mod/add 三类改动（未变行隔开，避免 LCS 把相邻 del+add 并成 mod）。
const A_OLD = [
  "# 价格告警设计",
  "",
  "## 概述",
  "本文档描述价格告警的整体设计，这一段保持不变作为上下文锚点。",
  "这一行将被删除，前后都有未变行把它隔开（独立 del 块）。",
  "概述结束行，保持不变。",
  "",
  "## 背景",
  "背景说明保持不变，用于锚定下方的修改块。",
  "旧的背景细节行，会被替换成新的细节行（mod）。",
  "背景收尾行，保持不变。",
  "",
  "## 方案",
  "方案首段保持不变，下面将新增一段。",
  "",
  "### 子方案",
  "子方案内容保持不变，作为文档结尾锚点。",
].join("\n");

// 新内容（= propose 提议的 newContent）。删一行、改一行、加一行。
const A_NEW = [
  "# 价格告警设计",
  "",
  "## 概述",
  "本文档描述价格告警的整体设计，这一段保持不变作为上下文锚点。",
  // 删除了「这一行将被删除…」→ del 块
  "概述结束行，保持不变。",
  "",
  "## 背景",
  "背景说明保持不变，用于锚定下方的修改块。",
  "新的背景细节行，由旧细节行替换而来（mod 已生效）。", // mod：替换上一行
  "背景收尾行，保持不变。",
  "",
  "## 方案",
  "方案首段保持不变，下面将新增一段。",
  "这是全新增加的一段，用于验证 add 绿色高亮在原文行内呈现。", // add 块（前面是未变行）
  "",
  "### 子方案",
  "子方案内容保持不变，作为文档结尾锚点。",
].join("\n");

// ⭐ 真实形态：content = A_OLD（旧内容，未确认不写盘）。
const art = artifacts.createArtifact(project.id, {
  kind: "design",
  title: "价格告警设计",
  content: A_OLD,
});
const pc = buildReplacePendingChange({
  artifactId: art.id,
  sourceActor: "e2e-fixture",
  oldContent: A_OLD,
  newContent: A_NEW,
});
store.save(project.id, pc);

const result = {
  projectId: project.id,
  root,
  sessionId,
  artifactId: art.id,
  blocks: pc.diffBlocks.map((b) => ({ id: b.id, kind: b.kind, firstLine: (b.lines[0] ?? "").slice(0, 20) })),
  // 期望在原文行内可见的新文本（验混合渲染真的把改动呈现在原文里）
  expectNewText: ["新的背景细节行", "这是全新增加的一段"],
  expectDelText: "这一行将被删除",
  // equal 段应保留为真实 markdown 标题
  expectHeadings: ["概述", "背景", "方案", "子方案"],
};
console.log("FIXTURE_JSON " + JSON.stringify(result));
