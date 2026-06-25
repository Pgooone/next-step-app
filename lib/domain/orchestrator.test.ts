/**
 * Orchestrator 编排单测（§5.3 AC①②③⑤ + 状态机 + 失败 + 落盘）。
 *
 * 用真实 `runWorker`（lib/pi）+ faux 装配（仿 B4：registerFauxProvider → 捕获 streamSimple →
 * inMemory registry；每次 prompt 前 setResponses 注入 assistant 文本），端到端验证：
 *   - 串行执行、上游产物喂下游（AC③：下游首条 message 含上游文本）；
 *   - 每个 worker 起独立会话（AC②：sessionId 各异）；
 *   - 产物落 .pi/artifacts/<dispatchId>/<seq>-<agent>.md、Assignment.output 记相对路径（D-C-1）；
 *   - 状态机 pending→running→done 全程落盘可回读；
 *   - worker 产物为空 → 该 assignment failed、task failed、中止后续；
 *   - 并发闸门 acquireSlot 在每个 worker 前被 await（AC⑤），且同时活跃 worker 恒 ≤1（串行）。
 *
 * faux register 用真实 AgentSessionWrapper（提供 onEvent/send 的真实事件接线），但不入
 * 进程级 globalThis registry——保持 hermetic，与 rpc-manager 契约分开。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider, getApiProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";

import { AgentProfileStore } from "./agent-profile-store";
import { DispatchStore, type DispatchTask } from "./dispatch-store";
import { ProjectRegistry } from "./project-registry";
import { runDispatch, sanitizeFileName } from "./orchestrator";
import { AgentSessionWrapper } from "../rpc-manager";
import { runWorker, type RegisterInnerSession } from "../pi/dispatch-runner";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
let dir: string;
let registry: ProjectRegistry;
let dispatchStore: DispatchStore;
let profileStore: AgentProfileStore;
let projectId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ns-c1-orch-"));
  registry = new ProjectRegistry(join(dir, "projects.json"));
  projectId = registry.create({ name: "proj", root: dir }).id;
  dispatchStore = new DispatchStore(registry);
  profileStore = new AgentProfileStore(registry);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function projectRoot(): string {
  return registry.get(projectId).root;
}

// ---------------------------------------------------------------------------
// faux 装配（仿 B4 / B2 Tier 2）
// ---------------------------------------------------------------------------
type Faux = {
  reg: ReturnType<typeof registerFauxProvider>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: NonNullable<ReturnType<ModelRegistry["find"]>>;
  unregister: () => void;
};

function makeFaux(): Faux {
  const reg = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", name: "Faux", contextWindow: 128000, maxTokens: 16384 }],
  });
  const liveFaux = getApiProvider("faux") as { streamSimple?: unknown; stream?: unknown };
  const capturedStreamSimple = (liveFaux.streamSimple ?? liveFaux.stream) as never;
  const authStorage = AuthStorage.inMemory({ faux: { type: "api_key", key: "dummy-key" } });
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider("faux", {
    api: "faux",
    baseUrl: "http://localhost:0",
    apiKey: "dummy-key",
    streamSimple: capturedStreamSimple,
    models: [
      { id: "faux-1", name: "faux-1", baseUrl: "http://localhost:0", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 },
    ],
  });
  const model = modelRegistry.find("faux", "faux-1")!;
  return { reg, authStorage, modelRegistry, model, unregister: () => reg.unregister() };
}

/**
 * faux register：用真实 AgentSessionWrapper 提供 onEvent/send 的真实事件接线，
 * 但不入进程级 globalThis registry（保持 hermetic）。同时捕获每次接到的 inner（断言会话独立性）。
 */
function makeCapturingRegister(): {
  register: RegisterInnerSession;
  capturedIds: string[];
} {
  const capturedIds: string[] = [];
  const register: RegisterInnerSession = (inner: AgentSession) => {
    const wrapper = new AgentSessionWrapper(inner);
    wrapper.start();
    capturedIds.push(inner.sessionId);
    return { session: wrapper, realSessionId: inner.sessionId };
  };
  return { register, capturedIds };
}

/**
 * 包装真实 runWorker：每次调用给一个**全新** inMemory SessionManager。
 * 生产里 runWorker 默认 `SessionManager.create(cwd)` 本就每 worker 一个新会话；测试若注入
 * 同一个 inMemory 实例会让两 worker 拿到同一 sessionId（共享内存会话），故这里每次新建一个，
 * 既保持 hermetic 又如实复现「每 assignment 独立会话」（AC②）。
 */
function freshManagerRunWorker(faux: Faux): typeof runWorker {
  return ((args) =>
    runWorker({
      ...args,
      sessionManager: SessionManager.inMemory(),
      createOptionsOverride: {
        model: faux.model,
        authStorage: faux.authStorage,
        modelRegistry: faux.modelRegistry,
      },
    })) as typeof runWorker;
}

/** 建一个含 N 个 assignment 的 pending 任务（agent 档案随建）。返回 task 与各 agentName。 */
function makeTask(subTasks: string[]): { task: DispatchTask; agentNames: string[] } {
  const agentNames = subTasks.map((_, i) => `agent-${i}`);
  const assignments = subTasks.map((subTask, i) => {
    const profile = profileStore.create(projectId, { name: agentNames[i] });
    return { agentId: profile.id, subTask };
  });
  const task = dispatchStore.create(projectId, { goal: "总目标", assignments });
  return { task, agentNames };
}

// ---------------------------------------------------------------------------
// AC②③ + 落盘 + 状态机：真实 runWorker 端到端
// ---------------------------------------------------------------------------
describe("runDispatch 串行 + 上游喂下游 + 落盘（真实 runWorker）", () => {
  it("两个 worker 串行执行；下游首条 message 含上游产物；产物落盘；状态机 done", async () => {
    const faux = makeFaux();
    const { register } = makeCapturingRegister();
    const { task, agentNames } = makeTask(["上游子任务", "下游子任务"]);

    // 捕获每次 faux 实际收到的 prompt 上下文（用于断言「上游产物喂进下游」）。
    const promptTexts: string[] = [];
    // faux 队列响应：每条 step 是函数，运行时读 context、记录、返回带序号的产物文本。
    faux.reg.setResponses([
      (context: { messages: Array<{ role: string; content: unknown }> }) => {
        promptTexts.push(serializeUserText(context));
        return fauxAssistantMessage("上游产物 OUT-UP");
      },
      (context: { messages: Array<{ role: string; content: unknown }> }) => {
        promptTexts.push(serializeUserText(context));
        return fauxAssistantMessage("下游产物 OUT-DOWN");
      },
    ]);

    try {
      const result = await runDispatch(task, {
        registry,
        dispatchStore,
        profileStore,
        runWorker: freshManagerRunWorker(faux),
        acquireSlot: async () => {},
        registerInnerSession: register,
        workerTimeoutMs: 5000,
      });

      // 状态机：整任务 done，两 assignment 都 done
      expect(result.status).toBe("done");
      expect(result.assignments.map((a) => a.status)).toEqual(["done", "done"]);

      // AC③：第二个 worker 的首条 message 含上游产物文本
      expect(promptTexts).toHaveLength(2);
      expect(promptTexts[0]).toContain("上游子任务");
      expect(promptTexts[0]).not.toContain("OUT-UP"); // 第一个无上游
      expect(promptTexts[1]).toContain("下游子任务");
      expect(promptTexts[1]).toContain("OUT-UP"); // 上游产物喂进来了
      expect(promptTexts[1]).toContain("## 上游产物");

      // 产物落盘：.pi/artifacts/<dispatchId>/<seq>-<agent>.md，Assignment.output 记相对路径
      const rel0 = result.assignments[0].output!;
      const rel1 = result.assignments[1].output!;
      expect(rel0).toBe(join(".pi", "artifacts", task.id, `1-${agentNames[0]}.md`));
      expect(rel1).toBe(join(".pi", "artifacts", task.id, `2-${agentNames[1]}.md`));
      expect(readFileSync(join(projectRoot(), rel0), "utf-8")).toContain("OUT-UP");
      expect(readFileSync(join(projectRoot(), rel1), "utf-8")).toContain("OUT-DOWN");

      // AC②：两个 worker 是独立会话（sessionId 不同）
      expect(result.assignments[0].sessionId).toBeTruthy();
      expect(result.assignments[1].sessionId).toBeTruthy();
      expect(result.assignments[0].sessionId).not.toBe(result.assignments[1].sessionId);

      // 状态机全程落盘可回读：最终盘上是 done
      const onDisk = dispatchStore.get(projectId, task.id);
      expect(onDisk.status).toBe("done");
      expect(onDisk.assignments[1].output).toBe(rel1);
    } finally {
      faux.unregister();
    }
  });

  it("中文 agentName → 产物文件名保留中文（真实端到端 1-_.md bug 回归）", async () => {
    const faux = makeFaux();
    const { register } = makeCapturingRegister();
    // 直接用中文名建档案 + 任务（绕过 makeTask 的 ASCII 名）。
    const a0 = profileStore.create(projectId, { name: "需求分析师" });
    const a1 = profileStore.create(projectId, { name: "资料解析员" });
    const task = dispatchStore.create(projectId, {
      goal: "总目标",
      assignments: [
        { agentId: a0.id, subTask: "子任务1" },
        { agentId: a1.id, subTask: "子任务2" },
      ],
    });
    faux.reg.setResponses([fauxAssistantMessage("产物甲"), fauxAssistantMessage("产物乙")]);

    try {
      const result = await runDispatch(task, {
        registry,
        dispatchStore,
        profileStore,
        runWorker: freshManagerRunWorker(faux),
        acquireSlot: async () => {},
        registerInnerSession: register,
        workerTimeoutMs: 5000,
      });

      expect(result.status).toBe("done");
      // 文件名保留中文、不是被压成的 `_`
      expect(result.assignments[0].output).toBe(join(".pi", "artifacts", task.id, "1-需求分析师.md"));
      expect(result.assignments[1].output).toBe(join(".pi", "artifacts", task.id, "2-资料解析员.md"));
      expect(result.assignments[0].output).not.toContain("1-_.md");
      // 文件真的能按该中文路径读到
      expect(readFileSync(join(projectRoot(), result.assignments[0].output!), "utf-8")).toContain("产物甲");
    } finally {
      faux.unregister();
    }
  });
});

// ---------------------------------------------------------------------------
// 失败：worker 未产出 → assignment failed、task failed、中止后续
// ---------------------------------------------------------------------------
describe("runDispatch 失败路径", () => {
  it("worker 产物为空 → 该 assignment failed、task failed、不起后续 worker", async () => {
    const faux = makeFaux();
    const { register, capturedIds } = makeCapturingRegister();
    const { task } = makeTask(["子任务1", "子任务2"]);

    // 第一个 worker 返回空文本（模拟未产出）；第二个不该被触发。
    faux.reg.setResponses([fauxAssistantMessage("")]);

    try {
      const result = await runDispatch(task, {
        registry,
        dispatchStore,
        profileStore,
        runWorker: freshManagerRunWorker(faux),
        acquireSlot: async () => {},
        registerInnerSession: register,
        workerTimeoutMs: 5000,
      });

      expect(result.status).toBe("failed");
      expect(result.assignments[0].status).toBe("failed");
      // 失败原因必须是「未产出文本」（而非起会话/运行时报错——防测试因别的 bug 假绿）
      expect(result.assignments[0].output).toContain("未产出");
      expect(result.assignments[1].status).toBe("pending"); // 后续未启动
      // 只起了一个会话
      expect(capturedIds).toHaveLength(1);
      // 落盘也是 failed
      expect(dispatchStore.get(projectId, task.id).status).toBe("failed");
    } finally {
      faux.unregister();
    }
  });

  it("Agent 档案不存在 → assignment failed、task failed", async () => {
    const faux = makeFaux();
    const { register } = makeCapturingRegister();
    // 直接造一个引用不存在 agentId 的任务（绕过 makeTask）
    const a1 = profileStore.create(projectId, { name: "real" });
    const task = dispatchStore.create(projectId, {
      goal: "g",
      assignments: [
        { agentId: "does-not-exist", subTask: "t" },
        { agentId: a1.id, subTask: "u" },
      ],
    });
    faux.reg.setResponses([fauxAssistantMessage("x")]);

    try {
      const result = await runDispatch(task, {
        registry,
        dispatchStore,
        profileStore,
        runWorker: freshManagerRunWorker(faux),
        acquireSlot: async () => {},
        registerInnerSession: register,
      });
      expect(result.status).toBe("failed");
      expect(result.assignments[0].status).toBe("failed");
      expect(result.assignments[0].output).toContain("不存在");
    } finally {
      faux.unregister();
    }
  });
});

// ---------------------------------------------------------------------------
// AC⑤ 并发闸门：每个 worker 前 await acquireSlot；串行下同时活跃 worker ≤1
// ---------------------------------------------------------------------------
describe("runDispatch 并发闸门（AC⑤）", () => {
  it("每个 worker 前都 await acquireSlot（调用次数 == worker 数）", async () => {
    const { task } = makeTask(["t1", "t2", "t3"]);
    const acquireSpy = vi.fn(async () => {});
    // 注入 faux runWorker：直接产出文本、记录并发峰值。
    let inFlight = 0;
    let peak = 0;
    const fakeRun = (async (args: { firstMessage: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { sessionId: `s-${Math.random()}`, output: `out:${args.firstMessage}`, reason: "completed", artifactIds: [] };
    }) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: acquireSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用（faux runWorker 不起真实会话）");
      }) as unknown as RegisterInnerSession,
    });

    expect(result.status).toBe("done");
    expect(acquireSpy).toHaveBeenCalledTimes(3); // 3 个 worker 各 gate 一次
    expect(peak).toBe(1); // 串行：同时活跃 worker 恒 ≤1
  });

  it("acquireSlot 抛错（闸门超时）→ 该 assignment failed、task failed、错误信息透传", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const acquireSlot = vi.fn(async () => {
      throw new Error("活跃会话已达上限 3，请关闭部分会话后重试");
    });
    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: (async () => ({
        sessionId: "x",
        output: "y",
        reason: "completed",
        artifactIds: [],
      })) as unknown as typeof runWorker,
      acquireSlot,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });
    expect(result.status).toBe("failed");
    expect(result.assignments[0].status).toBe("failed");
    expect(result.assignments[0].output).toContain("上限");
  });

  it("worker 执行超时（runWorker 返回 reason=timeout）→ 明确失败信息、中止后续", async () => {
    const { task } = makeTask(["t1", "t2"]);
    // faux runWorker：第一个 worker 返回 timeout（产物为空），第二个不该被触发。
    const calls: string[] = [];
    const fakeRun = (async (args: { firstMessage: string }) => {
      calls.push(args.firstMessage);
      return { sessionId: "s1", output: "", reason: "timeout", artifactIds: [] };
    }) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
      workerTimeoutMs: 1234,
    });

    expect(result.status).toBe("failed");
    expect(result.assignments[0].status).toBe("failed");
    expect(result.assignments[0].output).toContain("超时"); // 明确是执行超时，而非泛泛「未产出」
    expect(result.assignments[1].status).toBe("pending"); // 中止后续
    expect(calls).toHaveLength(1); // 只起了第一个 worker
  });
});

// ---------------------------------------------------------------------------
// T4 产物对账：受管文档作权威产物——回填 Assignment.artifactId、空文本也不失败、下游喂 createdContent
// ---------------------------------------------------------------------------
describe("runDispatch 产物对账（T4，受管文档作权威产物）", () => {
  it("worker 返回 artifactIds + 空文本 → assignment.artifactId 回填、不判失败、下游 upstreamOutput 取 createdContent", async () => {
    const { task } = makeTask(["上游子任务", "下游子任务"]);
    const downstreamFirstMessages: string[] = [];
    // 第一个 worker：文本为空但产出受管文档（artifactIds 非空 + createdContent=权威正文）。
    // 第二个 worker：捕获其首条 message（应含上游 createdContent，而非空 output），返回普通文本收尾。
    let call = 0;
    const fakeRun = (async (args: { firstMessage: string }) => {
      call += 1;
      if (call === 1) {
        return {
          sessionId: "s1",
          output: "", // 文档型 worker 可能不回 assistant 文本
          reason: "completed",
          artifactIds: ["art-上游"],
          createdContent: "受管文档权威正文 DOC-UP",
        };
      }
      downstreamFirstMessages.push(args.firstMessage);
      return { sessionId: "s2", output: "下游文本 OUT-DOWN", reason: "completed", artifactIds: [] };
    }) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      registerInnerSession: (() => {
        throw new Error("不应被调用（faux runWorker 不起真实会话）");
      }) as unknown as RegisterInnerSession,
    });

    // 不判失败：第一个 worker 空文本但有受管文档 → 整任务 done、两 assignment 都 done。
    expect(result.status).toBe("done");
    expect(result.assignments.map((a) => a.status)).toEqual(["done", "done"]);
    // 回填 artifactId（取最后一个 = 唯一一个）
    expect(result.assignments[0].artifactId).toBe("art-上游");
    expect(result.assignments[1].artifactId).toBeUndefined(); // 第二个无受管文档
    // 下游首条 message 取的是 createdContent（权威正文），不是空 output
    expect(downstreamFirstMessages).toHaveLength(1);
    expect(downstreamFirstMessages[0]).toContain("DOC-UP");
    expect(downstreamFirstMessages[0]).toContain("## 上游产物");
    // 落盘可回读 artifactId
    const onDisk = dispatchStore.get(projectId, task.id);
    expect(onDisk.assignments[0].artifactId).toBe("art-上游");
  });

  it("worker 空文本且 artifactIds 为空 → 仍判失败（未产出任何文本）", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const fakeRun = (async () => ({
      sessionId: "s1",
      output: "   ",
      reason: "completed",
      artifactIds: [],
    })) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });

    expect(result.status).toBe("failed");
    expect(result.assignments[0].status).toBe("failed");
    expect(result.assignments[0].output).toContain("未产出");
    expect(result.assignments[1].status).toBe("pending"); // 中止后续
  });
});

// ---------------------------------------------------------------------------
// T1（V1.2 第五轮·5.3）：worker 会话写「会话→agent」归属（setOwner），供左栏按 agent 分组（Bug1）
//   - completed/timeout/aborted 三类（都已在 L152 建会话）都写 (projectRoot, sessionId, agentId)；
//     决策③：失败/超时会话也归类、也计数。
//   - 档案不存在 / acquireSlot 抛错 / runWorker 抛错 三类前置失败（无 sessionId）→ 不写。
// ---------------------------------------------------------------------------
describe("runDispatch 写会话归属（T1·5.3）", () => {
  it("每个 completed worker 起会话后以 (projectRoot, sessionId, agentId) 调一次 setOwner", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const setOwnerSpy = vi.fn();
    const ids = ["sid-1", "sid-2"];
    let call = 0;
    const fakeRun = (async () => ({
      sessionId: ids[call++],
      output: "out",
      reason: "completed",
      artifactIds: [],
    })) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用（faux runWorker 不起真实会话）");
      }) as unknown as RegisterInnerSession,
    });

    expect(result.status).toBe("done");
    expect(setOwnerSpy).toHaveBeenCalledTimes(2);
    // 每条 assignment 用 (projectRoot, 真实 sessionId, 该 assignment 的 agentId) 调一次
    expect(setOwnerSpy).toHaveBeenNthCalledWith(1, projectRoot(), "sid-1", task.assignments[0].agentId);
    expect(setOwnerSpy).toHaveBeenNthCalledWith(2, projectRoot(), "sid-2", task.assignments[1].agentId);
  });

  it("worker timeout（已建会话）也写归属、然后中止后续（决策③）", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const setOwnerSpy = vi.fn();
    const fakeRun = (async () => ({
      sessionId: "sid-timeout",
      output: "",
      reason: "timeout",
      artifactIds: [],
    })) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });

    expect(result.status).toBe("failed");
    // 第一个 worker timeout 已建会话 → 写 1 次；中止后续 → 不起第二个、不再写
    expect(setOwnerSpy).toHaveBeenCalledTimes(1);
    expect(setOwnerSpy).toHaveBeenCalledWith(projectRoot(), "sid-timeout", task.assignments[0].agentId);
  });

  it("worker aborted（已建会话）也写归属、然后中止后续（决策③）", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const setOwnerSpy = vi.fn();
    const fakeRun = (async () => ({
      sessionId: "sid-aborted",
      output: "",
      reason: "aborted",
      artifactIds: [],
    })) as unknown as typeof runWorker;

    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: fakeRun,
      acquireSlot: async () => {},
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });

    expect(result.status).toBe("failed");
    expect(setOwnerSpy).toHaveBeenCalledTimes(1);
    expect(setOwnerSpy).toHaveBeenCalledWith(projectRoot(), "sid-aborted", task.assignments[0].agentId);
  });

  it("档案不存在（L97 前置失败、无 sessionId）→ 不写归属", async () => {
    const a1 = profileStore.create(projectId, { name: "real" });
    const task = dispatchStore.create(projectId, {
      goal: "g",
      assignments: [
        { agentId: "does-not-exist", subTask: "t" },
        { agentId: a1.id, subTask: "u" },
      ],
    });
    const setOwnerSpy = vi.fn();
    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: (async () => ({ sessionId: "x", output: "y", reason: "completed", artifactIds: [] })) as unknown as typeof runWorker,
      acquireSlot: async () => {},
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });
    expect(result.status).toBe("failed");
    expect(setOwnerSpy).not.toHaveBeenCalled();
  });

  it("acquireSlot 抛错（L113 前置失败、无 sessionId）→ 不写归属", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const setOwnerSpy = vi.fn();
    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: (async () => ({ sessionId: "x", output: "y", reason: "completed", artifactIds: [] })) as unknown as typeof runWorker,
      acquireSlot: async () => {
        throw new Error("活跃会话已达上限 3");
      },
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });
    expect(result.status).toBe("failed");
    expect(setOwnerSpy).not.toHaveBeenCalled();
  });

  it("runWorker 抛错（L142 前置失败、无 sessionId）→ 不写归属", async () => {
    const { task } = makeTask(["t1", "t2"]);
    const setOwnerSpy = vi.fn();
    const result = await runDispatch(task, {
      registry,
      dispatchStore,
      profileStore,
      runWorker: (async () => {
        throw new Error("worker 崩了");
      }) as unknown as typeof runWorker,
      acquireSlot: async () => {},
      setOwner: setOwnerSpy,
      registerInnerSession: (() => {
        throw new Error("不应被调用");
      }) as unknown as RegisterInnerSession,
    });
    expect(result.status).toBe("failed");
    expect(setOwnerSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 文件名净化：保留中文、只替换非法字符（真实端到端 deepseek 跑出 1-_.md 的 bug 回归）
// ---------------------------------------------------------------------------
describe("sanitizeFileName", () => {
  it("中文 agentName 原样保留（不被压成 _）", () => {
    expect(sanitizeFileName("需求分析师")).toBe("需求分析师");
    expect(sanitizeFileName("资料解析员")).toBe("资料解析员");
  });

  it("仅替换文件系统非法字符与控制字符为 _", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFileName("ab\tc")).toBe("ab_c"); // \t 是控制字符
  });

  it("去掉首尾空白与点（防越目录），中间空格与连字符保留", () => {
    expect(sanitizeFileName("  需求 分析-师  ")).toBe("需求 分析-师");
    expect(sanitizeFileName("..")).toBe("agent");
    expect(sanitizeFileName(".")).toBe("agent");
  });

  it("净化后为空 → 兜底 agent", () => {
    expect(sanitizeFileName("")).toBe("agent");
    expect(sanitizeFileName("   ")).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/** 从 faux stream 的 context 里抽出 user 消息文本（context.messages 末条 user）。 */
function serializeUserText(context: { messages: Array<{ role: string; content: unknown }> }): string {
  const users = context.messages.filter((m) => m.role === "user");
  const last = users[users.length - 1];
  if (!last) return "";
  const content = last.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => !!b && (b as { type?: string }).type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}
