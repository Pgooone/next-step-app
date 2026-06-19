/**
 * 第三轮 V3「受管文档入口并入 file panel」E2E 验收 fixture（一次性测试资产，不属实现代码）。
 * tsx 在项目根跑、共用 ~/.pi/projects.json。把 FIXTURE_JSON 打到 stdout 末行供驱动读取。
 *
 * 造主项目 P1（root 优先复用一个现成 pi 会话的 cwd —— 让 ChatWindow 能离开 isEmptyNew 欢迎态、
 *   AC⑨ 中栏 PendingChangeCard 可挂；无可复用会话则用临时目录、sessionId=null，驱动跳过中栏卡
 *   只验右栏「N 处待确认」）：
 *   - 普通非受管文件：项目说明.md（根级）、src/index.ts（子目录）—— 证 .pi 隐藏未误伤 + 普通树/FileViewer。
 *   - 受管 artClean（无 pending）—— 纯浏览：右栏 ArtifactPanel 无「N 处待确认」、中栏无确认卡。
 *   - 受管 artPend（1 条 replace PendingChange：del/mod/add）—— 经新分组入口打开 → 右栏「N 处待确认」+
 *       （有会话时）中栏确认卡、resolve 全块后消失。
 *   受管 artifact 由 createArtifact 物化到项目根（filePath 由 title 清洗、与已有 .md 避让）；
 *   侧车在 <root>/.pi/artifacts/managed/<id>/（供 AC⑥ type=read 探测、AC⑤ .pi 隐藏）。
 * 另造空项目 P2（仅 1 普通文件、无受管）：验 AC⑦ 空项目不显分组、树照常、无报错。
 */
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry } from "../lib/domain/project-registry";
import { ArtifactService } from "../lib/domain/artifact-service";
import {
  PendingChangeStore,
  buildReplacePendingChange,
} from "../lib/domain/pending-change-service";

const registry = new ProjectRegistry();
const artifacts = new ArtifactService(registry);
const store = new PendingChangeStore(registry);

// --- P1/P2 root：放进 app 自己认的「允许根」~/pi-cwd-<YYYYMMDD>/ 下 ---
// 文件 API（type=list/read）只服务允许根内路径：getAllowedRoots() = 全部会话 cwd + ~/pi-cwd-\d{8} 目录。
// 临时 /tmp 裸目录不在其中会被 403、致普通树空（AC⑤/⑦/⑧ 假失败、AC③ 因空树假通过）。
// 用 ~/pi-cwd-<date> 子目录既满足允许根、又无需会话、无需 import 内核。
// sessionId=null → 驱动跳过 AC⑨ Tier2 中栏卡：中栏 PendingChangeCard 需离开 isEmptyNew（选中已有会话），
// 而中栏卡 = D4 已验、V3 未改结构（新入口调同一 useArtifactStore.open()），其 V3 相关性已由右栏
// 「N 处待确认」（经新分组入口加载 pendingChanges）在 Tier1 证同源，故本轮不在浏览器复跑。
const d = new Date();
const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const allowedBase = join(homedir(), `pi-cwd-${ymd}`);
mkdirSync(allowedBase, { recursive: true });
const root = mkdtempSync(join(allowedBase, "ns-v3-p1-"));
const sessionId: string | null = null;
const p1 = registry.create({ name: `V3验收-${Date.now()}`, root });

// 普通非受管文件（证 .pi 隐藏未误伤项目根 md + 普通树/FileViewer）
writeFileSync(
  join(root, "项目说明.md"),
  "# 项目说明\n\n这是普通非受管 markdown，应正常出现在文件树并经 FileViewer 打开。\n",
);
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "index.ts"), "export const hello = 'world';\n");

// 受管 artClean：无 pending（纯浏览态）
const artClean = artifacts.createArtifact(p1.id, {
  kind: "doc",
  title: "需求规格",
  content: "# 需求规格\n\n## 概述\n受管的需求规格文档（无 pending），用于验证纯浏览态。\n",
});

// 受管 artPend：1 条 replace PendingChange（del + mod + add，未变行隔开避免 LCS 并块）
const P_OLD = [
  "# 设计草案",
  "",
  "## 概述",
  "概述首段，保持不变作为锚点。",
  "这一行将被删除，前后都有未变行隔开它。",
  "概述收尾行，保持不变。",
  "",
  "## 背景",
  "背景说明保持不变，用于锚定下方修改块。",
  "旧的背景细节行，会被替换成新行（mod）。",
  "背景收尾行，保持不变。",
].join("\n");
const P_NEW = [
  "# 设计草案",
  "",
  "## 概述",
  "概述首段，保持不变作为锚点。",
  "概述收尾行，保持不变。",
  "",
  "## 背景",
  "背景说明保持不变，用于锚定下方修改块。",
  "新的背景细节行（设计草案），由旧细节行替换而来（mod）。",
  "背景收尾行，保持不变。",
  "这是全新增加的一段，用于验证 add 高亮。",
].join("\n");
const artPend = artifacts.createArtifact(p1.id, {
  kind: "design",
  title: "设计草案",
  content: P_NEW,
});
const pc = buildReplacePendingChange({
  artifactId: artPend.id,
  sourceActor: "e2e-fixture",
  oldContent: P_OLD,
  newContent: P_NEW,
});
store.save(p1.id, pc);

// 侧车样本路径（AC⑥ type=read 探测：.pi 在 list 被隐藏，但 read 分支不查 IGNORED_NAMES 仍可读）
const piProbe = join(root, ".pi", "artifacts", "managed", artClean.id, "artifact.json");

// --- P2 空项目：仅普通文件、无受管 ---
const root2 = mkdtempSync(join(allowedBase, "ns-v3-p2-"));
const p2 = registry.create({ name: `V3空项目-${Date.now()}`, root: root2 });
writeFileSync(join(root2, "readme.txt"), "empty project, no managed artifacts\n");

const result = {
  p1: p1.id,
  root,
  sessionId,
  artClean: artClean.id,
  artCleanFile: artClean.filePath,
  artPend: artPend.id,
  artPendFile: artPend.filePath,
  pendKinds: pc.diffBlocks.map((b) => b.kind),
  plainMd: "项目说明.md",
  subFile: "src/index.ts",
  piProbe,
  piProbeExists: existsSync(piProbe),
  p2: p2.id,
  root2,
};
console.log("FIXTURE_JSON " + JSON.stringify(result));
