import { describe, it, expect } from "vitest";
import {
  buildManagedAbsPaths,
  joinFilePath,
  normalizeFilePathSlashes,
} from "./file-paths";

describe("buildManagedAbsPaths", () => {
  it("基本：crd.md + /p → Set 含 /p/crd.md，根级同名节点会被剔", () => {
    const set = buildManagedAbsPaths([{ filePath: "crd.md" }], "/p");
    expect(set.has(joinFilePath("/p", "crd.md"))).toBe(true);
    // 不同 projectRoot 下的同名文件不会被误剔
    expect(set.has(joinFilePath("/other", "crd.md"))).toBe(false);
  });

  it("filePath=undefined 的旧 artifact 不进 Set（不污染）", () => {
    const set = buildManagedAbsPaths(
      [{ filePath: undefined }, { filePath: "crd.md" }],
      "/p",
    );
    expect(set.size).toBe(1);
    expect(set.has(joinFilePath("/p", "crd.md"))).toBe(true);
  });

  it("cwd≠projectRoot 不误剔：节点在 /q 下，projectRoot 是 /p", () => {
    const set = buildManagedAbsPaths([{ filePath: "crd.md" }], "/p");
    const nodeFullPath = joinFilePath("/q", "crd.md");
    expect(set.has(nodeFullPath)).toBe(false);
  });

  it("子目录 artifact：docs/crd.md + /p → Set 含归一化后的 /p/docs/crd.md", () => {
    const set = buildManagedAbsPaths([{ filePath: "docs/crd.md" }], "/p");
    expect(set.has(normalizeFilePathSlashes(joinFilePath("/p", "docs/crd.md")))).toBe(true);
  });

  it("空 projectRoot → 空 Set（防 key 退化成 /crd.md 误剔根目录同名文件）", () => {
    const set = buildManagedAbsPaths([{ filePath: "crd.md" }], "");
    expect(set.size).toBe(0);
  });
});
