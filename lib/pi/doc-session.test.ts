/**
 * V2-3 文档会话装配单测：assembleDocSessionOptions 产出的受限工具集 options 形态——
 *   - tools 白名单 = 含且仅含 7 名（read/grep/find/ls + 3 提议工具），**不含 write/edit/bash**
 *   - customTools = 含且仅含 create_artifact / propose_edit / list_artifacts
 *
 * 受限组合「白名单含全部 customTool 名 + customTools 提议工具」在真实会话下的激活行为
 * （3 工具被激活、write/edit/bash 不在激活集、漏名则被过滤）已由 V2-0 spike（spike/v2-tools）
 * 双向实证，此处只验装配 options 本身的形态（AC 范围）。
 */
import { describe, expect, it } from "vitest";

import { assembleDocSessionOptions, DOC_SESSION_TOOLS } from "./doc-session";

const FORBIDDEN = ["write", "edit", "bash"];
const PROPOSE_NAMES = ["create_artifact", "propose_edit", "list_artifacts"];

function assemble() {
  return assembleDocSessionOptions({
    projectId: "p-1",
    sourceActor: "需求分析师",
    cwd: "/tmp/proj",
  }).options;
}

describe("assembleDocSessionOptions", () => {
  it("tools 白名单 = 含且仅含 7 名（read/grep/find/ls + 3 提议工具）", () => {
    const { tools } = assemble();
    expect([...tools].sort()).toEqual(
      ["create_artifact", "find", "grep", "list_artifacts", "ls", "propose_edit", "read"].sort(),
    );
    // 与导出的常量一致
    expect(tools).toEqual([...DOC_SESSION_TOOLS]);
  });

  it("tools 白名单不含 write/edit/bash（无写盘/执行能力）", () => {
    const { tools } = assemble();
    for (const f of FORBIDDEN) {
      expect(tools).not.toContain(f);
    }
  });

  it("白名单含全部 3 个 customTool 名（D-V2-04：漏名则内核过滤掉、调不到）", () => {
    const { tools } = assemble();
    for (const n of PROPOSE_NAMES) {
      expect(tools).toContain(n);
    }
  });

  it("customTools = 含且仅含 create_artifact / propose_edit / list_artifacts", () => {
    const { customTools } = assemble();
    expect(customTools.map((t) => t.name).sort()).toEqual([...PROPOSE_NAMES].sort());
  });

  it("customTools 不含任何写盘/执行工具（没有 write/edit/bash 同名 customTool）", () => {
    const { customTools } = assemble();
    const names = customTools.map((t) => t.name);
    for (const f of FORBIDDEN) {
      expect(names).not.toContain(f);
    }
  });

  it("返回形态可直接展开进 createAgentSession（{ options: { tools, customTools } }）", () => {
    const result = assembleDocSessionOptions({ projectId: "p", sourceActor: "a", cwd: "/c" });
    expect(result).toHaveProperty("options");
    expect(Array.isArray(result.options.tools)).toBe(true);
    expect(Array.isArray(result.options.customTools)).toBe(true);
  });
});
