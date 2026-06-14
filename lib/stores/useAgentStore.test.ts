import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/lib/domain/agent-profile-store";
import {
  CODING_TOOL_NAMES,
  joinModel,
  selectAgentsForProject,
  splitModel,
  toggleTool,
  useAgentStore,
} from "./useAgentStore";

function makeAgent(id: string, name = id, projectId = "proj"): AgentProfile {
  return {
    id,
    projectId,
    name,
    role: "",
    model: "",
    skills: [],
    tools: [],
    thinkingLevel: "off",
    agentMdPath: `.pi/agents/${id}/agent.md`,
    memoryPath: `.pi/agents/${id}/memory.md`,
  };
}

beforeEach(() => {
  useAgentStore.setState({ agents: [], loadedProjectId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("纯逻辑：model 单 string 拆/拼", () => {
  it("按首个 / 拆 provider/modelId（modelId 可含 /）", () => {
    expect(splitModel("anthropic/claude-opus")).toEqual({
      provider: "anthropic",
      modelId: "claude-opus",
    });
    expect(splitModel("openrouter/meta/llama-3")).toEqual({
      provider: "openrouter",
      modelId: "meta/llama-3",
    });
  });

  it("空 / 无 / / 首尾为 / 视为未选模型", () => {
    expect(splitModel("")).toBeNull();
    expect(splitModel("anthropic")).toBeNull();
    expect(splitModel("/foo")).toBeNull();
    expect(splitModel("foo/")).toBeNull();
  });

  it("joinModel 拼回；任一为空则空串", () => {
    expect(joinModel("anthropic", "claude-opus")).toBe("anthropic/claude-opus");
    expect(joinModel("", "claude-opus")).toBe("");
    expect(joinModel("anthropic", "")).toBe("");
  });
});

describe("纯逻辑：tools 勾选集合", () => {
  it("加入/移除并保持 CODING_TOOL_NAMES 顺序", () => {
    expect(toggleTool([], "write")).toEqual(["write"]);
    // 乱序加入后仍按固定集顺序输出
    expect(toggleTool(["write"], "read")).toEqual(["read", "write"]);
    expect(toggleTool(["read", "write"], "read")).toEqual(["write"]);
  });

  it("CODING_TOOL_NAMES 即内置编码工具固定集", () => {
    expect(CODING_TOOL_NAMES).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
  });
});

describe("纯逻辑：按项目选档案（切项目不串显）", () => {
  it("loadedProjectId 匹配返回列表，不匹配 / null 返回空", () => {
    const agents = [makeAgent("a")];
    expect(selectAgentsForProject({ agents, loadedProjectId: "proj" } as never, "proj")).toEqual(
      agents,
    );
    expect(
      selectAgentsForProject({ agents, loadedProjectId: "proj" } as never, "other"),
    ).toEqual([]);
    expect(selectAgentsForProject({ agents, loadedProjectId: "proj" } as never, null)).toEqual([]);
  });
});

describe("store 动作（mock fetch）", () => {
  it("refresh 拉列表并标记 loadedProjectId", async () => {
    const agents = [makeAgent("a"), makeAgent("b")];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => agents });
    vi.stubGlobal("fetch", fetchMock);

    await useAgentStore.getState().refresh("proj");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj/agents");
    expect(useAgentStore.getState().agents).toEqual(agents);
    expect(useAgentStore.getState().loadedProjectId).toBe("proj");
  });

  it("create POST 正确请求体，201 后 refresh 并返回新档案", async () => {
    const created = makeAgent("new", "新助手");
    const fetchMock = vi
      .fn()
      // POST /api/projects/proj/agents
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => created })
      // refresh GET
      .mockResolvedValueOnce({ ok: true, json: async () => [created] });
    vi.stubGlobal("fetch", fetchMock);

    const input = { name: "新助手", role: "r", model: "", skills: [], tools: ["read"] as string[] };
    const result = await useAgentStore.getState().create("proj", input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/agents");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(result).toEqual(created);
    expect(useAgentStore.getState().agents).toEqual([created]);
    expect(useAgentStore.getState().loadedProjectId).toBe("proj");
  });

  it("create 失败时抛出后端 422 的 error 文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: "Agent 重名: 新助手" }),
      }),
    );

    await expect(
      useAgentStore.getState().create("proj", { name: "新助手" }),
    ).rejects.toThrow("Agent 重名: 新助手");
  });

  it("update PATCH 正确请求体，成功后 refresh", async () => {
    const updated = { ...makeAgent("a", "改名后"), role: "新角色" };
    const fetchMock = vi
      .fn()
      // PATCH
      .mockResolvedValueOnce({ ok: true, json: async () => updated })
      // refresh GET
      .mockResolvedValueOnce({ ok: true, json: async () => [updated] });
    vi.stubGlobal("fetch", fetchMock);

    const patch = { name: "改名后", role: "新角色" };
    const result = await useAgentStore.getState().update("proj", "a", patch);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/agents/a");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual(patch);
    expect(result).toEqual(updated);
    expect(useAgentStore.getState().agents).toEqual([updated]);
  });

  it("update 失败时抛出 422 文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: "name 不能为空" }),
      }),
    );

    await expect(
      useAgentStore.getState().update("proj", "a", { name: "" }),
    ).rejects.toThrow("name 不能为空");
  });

  it("remove DELETE 204 后 refresh", async () => {
    const fetchMock = vi
      .fn()
      // DELETE 204 无 body
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) })
      // refresh GET
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    useAgentStore.setState({ agents: [makeAgent("a")], loadedProjectId: "proj" });
    await useAgentStore.getState().remove("proj", "a");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/agents/a");
    expect(init.method).toBe("DELETE");
    expect(useAgentStore.getState().agents).toEqual([]);
  });

  it("remove 容忍后端 404（视为已删除），仍 refresh 不抛", async () => {
    const fetchMock = vi
      .fn()
      // DELETE 404
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      // refresh GET
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    await expect(useAgentStore.getState().remove("proj", "a")).resolves.toBeUndefined();
    expect(useAgentStore.getState().agents).toEqual([]);
  });

  it("切项目后 selectAgentsForProject 不串显旧项目数据", async () => {
    const projAgents = [makeAgent("a", "a", "proj")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => projAgents }));

    await useAgentStore.getState().refresh("proj");
    // 此时 loadedProjectId=proj；查询 other 项目应得空
    expect(selectAgentsForProject(useAgentStore.getState(), "other")).toEqual([]);
    expect(selectAgentsForProject(useAgentStore.getState(), "proj")).toEqual(projAgents);
  });
});
