import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/domain/project-registry";
import {
  loadPersistedId,
  persistId,
  resolveCurrentProject,
  useProjectStore,
} from "./useProjectStore";

const STORAGE_KEY = "next-step:current-project-id";

function makeProject(id: string, name = id): Project {
  return { id, name, root: `/tmp/${name}`, createdAt: new Date().toISOString() };
}

/** 极简内存版 localStorage，挂到全局供纯函数与 store 使用。 */
function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

beforeEach(() => {
  installMemoryLocalStorage();
  // 每个用例重置 store，避免相互污染
  useProjectStore.setState({ projects: [], currentProjectId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("纯逻辑：localStorage 持久化", () => {
  it("persistId 写入、loadPersistedId 读回", () => {
    expect(loadPersistedId()).toBeNull();
    persistId("abc");
    expect(loadPersistedId()).toBe("abc");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("abc");
  });

  it("persistId(null) 清除持久化", () => {
    persistId("abc");
    persistId(null);
    expect(loadPersistedId()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("纯逻辑：按 id 解析当前项目 + 回退", () => {
  const projects = [makeProject("a"), makeProject("b")];

  it("命中返回对应项目", () => {
    expect(resolveCurrentProject(projects, "b")).toEqual(projects[1]);
  });

  it("id 为 null 回退 null", () => {
    expect(resolveCurrentProject(projects, null)).toBeNull();
  });

  it("id 查不到回退 null", () => {
    expect(resolveCurrentProject(projects, "missing")).toBeNull();
  });
});

describe("store 动作（mock fetch）", () => {
  it("refresh 拉列表；持久化 id 在新列表中不存在时回退无选中", async () => {
    useProjectStore.setState({ currentProjectId: "gone" });
    persistId("gone");
    const projects = [makeProject("a")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => projects }),
    );

    await useProjectStore.getState().refresh();

    expect(useProjectStore.getState().projects).toEqual(projects);
    expect(useProjectStore.getState().currentProjectId).toBeNull();
    expect(loadPersistedId()).toBeNull();
  });

  it("refresh 时持久化 id 仍存在则保留选中", async () => {
    useProjectStore.setState({ currentProjectId: "a" });
    const projects = [makeProject("a")];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => projects }),
    );

    await useProjectStore.getState().refresh();

    expect(useProjectStore.getState().currentProjectId).toBe("a");
  });

  it("create 成功后 refresh 并选中新项目", async () => {
    const created = makeProject("new", "demo");
    const fetchMock = vi
      .fn()
      // POST /api/projects
      .mockResolvedValueOnce({ ok: true, json: async () => created })
      // refresh GET /api/projects
      .mockResolvedValueOnce({ ok: true, json: async () => [created] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await useProjectStore.getState().create({ name: "demo", root: "/tmp/demo" });

    expect(result).toEqual(created);
    expect(useProjectStore.getState().currentProjectId).toBe("new");
    expect(loadPersistedId()).toBe("new");
  });

  it("create 失败时抛出后端 422 的 error 文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "项目重名: demo" }) }),
    );

    await expect(
      useProjectStore.getState().create({ name: "demo", root: "/tmp/demo" }),
    ).rejects.toThrow("项目重名: demo");
  });

  it("remove 当前项目时取消选中", async () => {
    useProjectStore.setState({ projects: [makeProject("a")], currentProjectId: "a" });
    persistId("a");
    const fetchMock = vi
      .fn()
      // DELETE
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) })
      // refresh GET
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);

    await useProjectStore.getState().remove("a");

    expect(useProjectStore.getState().currentProjectId).toBeNull();
    expect(loadPersistedId()).toBeNull();
    expect(useProjectStore.getState().projects).toEqual([]);
  });

  it("remove 非当前项目时保留当前选中", async () => {
    useProjectStore.setState({ projects: [makeProject("a"), makeProject("b")], currentProjectId: "a" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => [makeProject("a")] });
    vi.stubGlobal("fetch", fetchMock);

    await useProjectStore.getState().remove("b");

    expect(useProjectStore.getState().currentProjectId).toBe("a");
  });
});
