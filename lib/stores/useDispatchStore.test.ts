import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectIsActive,
  selectTaskForProject,
  useDispatchStore,
  type DispatchTask,
} from "./useDispatchStore";

function makeTask(overrides: Partial<DispatchTask> = {}): DispatchTask {
  return {
    id: "t1",
    projectId: "proj",
    goal: "做点东西",
    status: "pending",
    assignments: [
      { agentId: "a1", subTask: "调研", status: "pending" },
      { agentId: "a2", subTask: "撰写", status: "pending" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  useDispatchStore.setState({ task: null, loadedProjectId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("纯逻辑：按项目选任务（切项目不串显）", () => {
  it("loadedProjectId 匹配返回任务，不匹配 / null 返回 null", () => {
    const task = makeTask();
    expect(selectTaskForProject(task, "proj", "proj")).toEqual(task);
    expect(selectTaskForProject(task, "proj", "other")).toBeNull();
    expect(selectTaskForProject(task, "proj", null)).toBeNull();
  });
});

describe("纯逻辑：任务是否活跃（决定是否继续轮询）", () => {
  it("pending / running 活跃；done / failed / null 非活跃", () => {
    expect(selectIsActive(makeTask({ status: "pending" }))).toBe(true);
    expect(selectIsActive(makeTask({ status: "running" }))).toBe(true);
    expect(selectIsActive(makeTask({ status: "done" }))).toBe(false);
    expect(selectIsActive(makeTask({ status: "failed" }))).toBe(false);
    expect(selectIsActive(null)).toBe(false);
  });
});

describe("dispatch 动作（mock fetch）", () => {
  it("POST 正确请求体，成功后存任务并返回 taskId", async () => {
    const task = makeTask();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => task });
    vi.stubGlobal("fetch", fetchMock);

    const assignments = [
      { agentId: "a1", subTask: "调研" },
      { agentId: "a2", subTask: "撰写" },
    ];
    const r = await useDispatchStore.getState().dispatch("proj", "做点东西", assignments);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/proj/dispatch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ goal: "做点东西", assignments });
    expect(r).toEqual({ taskId: "t1" });
    expect(useDispatchStore.getState().task).toEqual(task);
    expect(useDispatchStore.getState().loadedProjectId).toBe("proj");
  });

  it("失败时抛出后端 error 文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: "assignments 至少 2 个" }),
      }),
    );

    await expect(
      useDispatchStore.getState().dispatch("proj", "g", [{ agentId: "a1", subTask: "x" }]),
    ).rejects.toThrow("assignments 至少 2 个");
  });

  it("2xx 但缺 id → 抛出（防御异常响应）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await expect(
      useDispatchStore.getState().dispatch("proj", "g", [{ agentId: "a1", subTask: "x" }]),
    ).rejects.toThrow();
  });
});

describe("pollOnce 动作（mock fetch）", () => {
  it("GET 到 /api/dispatch/[taskId]，刷新 task", async () => {
    const running = makeTask({ status: "running" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => running });
    vi.stubGlobal("fetch", fetchMock);

    useDispatchStore.setState({ task: makeTask(), loadedProjectId: "proj" });
    const r = await useDispatchStore.getState().pollOnce("proj", "t1");

    expect(fetchMock).toHaveBeenCalledWith("/api/dispatch/t1");
    expect(r).toEqual(running);
    expect(useDispatchStore.getState().task).toEqual(running);
  });

  it("项目已切换（loadedProjectId 不一致）则不写入 state，但仍返回结果", async () => {
    const other = makeTask({ projectId: "other" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => other }));

    const prev = makeTask();
    useDispatchStore.setState({ task: prev, loadedProjectId: "proj2" });
    // 用旧项目 id 轮询，store 已是 proj2 → 不应覆盖
    const r = await useDispatchStore.getState().pollOnce("proj", "t1");

    expect(r).toEqual(other);
    expect(useDispatchStore.getState().task).toEqual(prev);
  });

  it("失败时抛出后端 error 文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "任务不存在" }) }),
    );
    await expect(useDispatchStore.getState().pollOnce("proj", "nope")).rejects.toThrow("任务不存在");
  });
});

describe("reset 动作", () => {
  it("清空 task 与 loadedProjectId", () => {
    useDispatchStore.setState({ task: makeTask(), loadedProjectId: "proj" });
    useDispatchStore.getState().reset();
    expect(useDispatchStore.getState().task).toBeNull();
    expect(useDispatchStore.getState().loadedProjectId).toBeNull();
  });
});
