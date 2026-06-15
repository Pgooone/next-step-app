/**
 * pending-change-service 领域单测：
 * - 行级切块纯函数：纯增(add) / 纯删(del) / 替换(mod) / 混合 / 无改动 / edit 多块。
 * - DiffBlock 形状：id/state=pending、mod 带 oldLines、add/del 无 oldLines。
 * - 落盘：managed/<id>/pending/<id>.json 原子写 + get 读回 + NOT_FOUND。
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PendingChangeStore,
  PendingChangeError,
  buildReplacePendingChange,
  buildPatchPendingChange,
  computeReplaceDiffBlocks,
  computeEditDiffBlocks,
  type DiffBlock,
} from "./pending-change-service";
import { ProjectRegistry } from "./project-registry";

let dir: string;
let registry: ProjectRegistry;
let store: PendingChangeStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-d2-pending-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  store = new PendingChangeStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 提取每块的 (kind, lines) 便于断言形状，忽略随机 id。 */
function shape(blocks: DiffBlock[]): { kind: string; lines: string[]; oldLines?: string[] }[] {
  return blocks.map((b) => ({
    kind: b.kind,
    lines: b.lines,
    ...(b.oldLines !== undefined ? { oldLines: b.oldLines } : {}),
  }));
}

// ---------------------------------------------------------------------------
// 切块：computeReplaceDiffBlocks（write 整文件替换）
// ---------------------------------------------------------------------------
describe("computeReplaceDiffBlocks", () => {
  it("内容相同 → 空块数组", () => {
    expect(computeReplaceDiffBlocks("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("纯新增：尾部追加行 → 一个 add 块", () => {
    const blocks = computeReplaceDiffBlocks("a\nb", "a\nb\nc\nd");
    expect(shape(blocks)).toEqual([{ kind: "add", lines: ["c", "d"] }]);
  });

  it("纯新增：空文件 → 全文 → 一个 add 块", () => {
    const blocks = computeReplaceDiffBlocks("", "x\ny");
    expect(shape(blocks)).toEqual([{ kind: "add", lines: ["x", "y"] }]);
  });

  it("纯删除：删掉中间几行 → 一个 del 块", () => {
    const blocks = computeReplaceDiffBlocks("a\nb\nc\nd", "a\nd");
    expect(shape(blocks)).toEqual([{ kind: "del", lines: ["b", "c"] }]);
  });

  it("纯删除：全文清空 → 一个 del 块", () => {
    const blocks = computeReplaceDiffBlocks("a\nb", "");
    expect(shape(blocks)).toEqual([{ kind: "del", lines: ["a", "b"] }]);
  });

  it("替换：连续 del 后紧跟 add → 合并为 mod 块（lines=新, oldLines=旧）", () => {
    const blocks = computeReplaceDiffBlocks("a\nOLD\nc", "a\nNEW\nc");
    expect(shape(blocks)).toEqual([{ kind: "mod", lines: ["NEW"], oldLines: ["OLD"] }]);
  });

  it("替换：多行替换多行 → 一个 mod 块", () => {
    const blocks = computeReplaceDiffBlocks("a\nO1\nO2\nb", "a\nN1\nN2\nN3\nb");
    expect(shape(blocks)).toEqual([{ kind: "mod", lines: ["N1", "N2", "N3"], oldLines: ["O1", "O2"] }]);
  });

  it("混合：一处 mod + 一处 add（被未改动行隔开）→ 两个块", () => {
    // a [OLD→NEW] b c [+追加 d]
    const blocks = computeReplaceDiffBlocks("a\nOLD\nb\nc", "a\nNEW\nb\nc\nd");
    expect(shape(blocks)).toEqual([
      { kind: "mod", lines: ["NEW"], oldLines: ["OLD"] },
      { kind: "add", lines: ["d"] },
    ]);
  });

  it("所有块初始 state=pending 且带 id；add/del 块不带 oldLines", () => {
    const blocks = computeReplaceDiffBlocks("a\nb", "a\nX");
    for (const b of blocks) {
      expect(b.state).toBe("pending");
      expect(typeof b.id).toBe("string");
      expect(b.id.length).toBeGreaterThan(0);
    }
    // 这例是 mod（b→X），带 oldLines
    expect(blocks[0].kind).toBe("mod");
    expect(blocks[0].oldLines).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// 切块：computeEditDiffBlocks（edit 局部替换）
// ---------------------------------------------------------------------------
describe("computeEditDiffBlocks", () => {
  it("单 edit 单行替换 → 一个 mod 块", () => {
    const blocks = computeEditDiffBlocks([{ oldText: "foo", newText: "bar" }]);
    expect(shape(blocks)).toEqual([{ kind: "mod", lines: ["bar"], oldLines: ["foo"] }]);
  });

  it("多个 edit 按顺序各自成块", () => {
    const blocks = computeEditDiffBlocks([
      { oldText: "a", newText: "A" },
      { oldText: "b", newText: "" }, // 纯删
      { oldText: "", newText: "c" }, // 纯增
    ]);
    expect(shape(blocks)).toEqual([
      { kind: "mod", lines: ["A"], oldLines: ["a"] },
      { kind: "del", lines: ["b"] },
      { kind: "add", lines: ["c"] },
    ]);
  });

  it("单 edit 内部多行替换 → 行级精确切块", () => {
    const blocks = computeEditDiffBlocks([{ oldText: "keep\nOLD\ntail", newText: "keep\nNEW\ntail" }]);
    expect(shape(blocks)).toEqual([{ kind: "mod", lines: ["NEW"], oldLines: ["OLD"] }]);
  });
});

// ---------------------------------------------------------------------------
// 组装 PendingChange
// ---------------------------------------------------------------------------
describe("buildReplacePendingChange / buildPatchPendingChange", () => {
  it("replace：op=replace、targetType=artifact、diff 携新旧全文、默认 hitlMode=per_block", () => {
    const pc = buildReplacePendingChange({
      artifactId: "art-1",
      sourceActor: "需求分析师",
      oldContent: "a",
      newContent: "b",
    });
    expect(pc.op).toBe("replace");
    expect(pc.targetType).toBe("artifact");
    expect(pc.sourceActor).toBe("需求分析师");
    expect(pc.hitlMode).toBe("per_block");
    expect(pc.diff).toEqual({ kind: "replace", oldContent: "a", newContent: "b" });
    expect(pc.diffBlocks.length).toBeGreaterThan(0);
    expect(typeof pc.createdAt).toBe("string");
  });

  it("patch：op=patch、diff 携 edits、diffBlocks 由 edits 切出", () => {
    const pc = buildPatchPendingChange({
      artifactId: "art-1",
      sourceActor: "agent-x",
      edits: [{ oldText: "x", newText: "y" }],
    });
    expect(pc.op).toBe("patch");
    expect(pc.diff).toEqual({ kind: "patch", edits: [{ oldText: "x", newText: "y" }] });
    expect(shape(pc.diffBlocks)).toEqual([{ kind: "mod", lines: ["y"], oldLines: ["x"] }]);
  });
});

// ---------------------------------------------------------------------------
// 落盘 PendingChangeStore
// ---------------------------------------------------------------------------
describe("PendingChangeStore", () => {
  it("save 落盘到 managed/<artifactId>/pending/<id>.json 且 get 读回一致", () => {
    const pc = buildReplacePendingChange({
      artifactId: "art-42",
      sourceActor: "a",
      oldContent: "old",
      newContent: "new",
    });
    store.save(projectId, pc);

    const path = join(dir, ".pi", "artifacts", "managed", "art-42", "pending", `${pc.id}.json`);
    expect(existsSync(path)).toBe(true);

    const got = store.get(projectId, "art-42", pc.id);
    expect(got).toEqual(pc);
  });

  it("save 用原子写（不留 .tmp 残留）", () => {
    const pc = buildReplacePendingChange({ artifactId: "art-9", sourceActor: "a", oldContent: "", newContent: "z" });
    store.save(projectId, pc);
    const pendingDir = join(dir, ".pi", "artifacts", "managed", "art-9", "pending");
    const leftover = readdirSync(pendingDir).filter((f) => f.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("get 不存在 → NOT_FOUND", () => {
    try {
      store.get(projectId, "art-x", "missing-id");
    } catch (e) {
      expect(e).toBeInstanceOf(PendingChangeError);
      expect((e as PendingChangeError).code).toBe("NOT_FOUND");
      return;
    }
    throw new Error("期望抛 PendingChangeError(NOT_FOUND)，但没抛");
  });
});
