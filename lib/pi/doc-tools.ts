/**
 * V2-2 · 文档「提议工具」工厂（`defineTool` 自定义工具）。
 *
 * 给文档会话挂三个自定义工具——`create_artifact` / `propose_edit` / `list_artifacts`——
 * 让 AI **不能直接写盘**，只能：建文档（直接落 v1 + 物化）、对已存在文档**提议**整篇修改
 * （转 PendingChange、等用户按块确认才写新版）、列文档。这是 V2「文档实体 + 提议工具」模型的核心：
 * diff/版本/确认是文档层通用能力、AI 只是调用方之一（取代 P0「逐路给会话装 guard 拦写」）。
 *
 * 闭包注入范式沿用 P0 guard 装配的「构造期闭包注入」先例（QA Q4，guard 已于 V2-5 删除）：
 * execute 的 ctx（ExtensionContext）不带 projectId / agent 身份，故由本工厂在装配时把
 * `projectId` / `sourceActor` 经闭包注入每个工具的 execute。
 *
 * 红线：本文件写 Next-Step 自己的工具（非改 pi 内核）；落的 PendingChange 与既有 resolve 路由 /
 * PendingChangeCard 完全兼容（op=replace、diffBlocks 由 computeReplaceDiffBlocks 算），确认流水线零新增。
 */
import { type Static, Type } from "typebox";
import {
  defineTool,
  type AgentToolResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { ArtifactService } from "../domain/artifact-service";
import {
  PendingChangeStore,
  buildReplacePendingChange,
  computeReplaceDiffBlocks,
} from "../domain/pending-change-service";
import { ProjectRegistry } from "../domain/project-registry";

/**
 * 内核工具工厂返回具体 `ToolDefinition<具体schema,具体details>`，把异构具体类型收进数组会因
 * `renderCall`/`parameters` 泛型逆变方差报错（阶段0/D-D2-1 实测）。内核自身用 `ToolDef =
 * ToolDefinition<any,any>` 规避、但该别名未从包根导出，故本地等价定义 `DocToolDef =
 * ToolDefinition<any,any>`，`any` 限定在这一行。export 供 V2-3 文档会话装配复用。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DocToolDef = ToolDefinition<any, any>;

/**
 * 提议工具工厂的依赖：projectId / sourceActor 在装配期由闭包注入（execute 的 ctx 不带）；
 * artifactService / pendingStore 可注入（测试用 hermetic 临时后端），生产省略走默认文件后端。
 */
export type DocToolDeps = {
  /** 当前项目（提议工具按 id 操作受管文档时定位项目）。 */
  projectId: string;
  /** 哪个 agent 发起（写进 version.author / PendingChange.sourceActor）。 */
  sourceActor: string;
  artifactService?: ArtifactService;
  pendingStore?: PendingChangeStore;
};

/** AgentToolResult 成功返回：把结构化结果 JSON 化进 text content（模型唯一真读的通道）。details 不用→undefined。 */
function jsonResult(payload: unknown): AgentToolResult<undefined> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: undefined,
  };
}

/**
 * 把工具执行中抛出的错误转成给模型看的 content text（而非让未捕获异常炸会话）。
 * artifactService/pendingStore 可能抛 ArtifactError（id 不存在=NOT_FOUND、EXTERNAL_MODIFIED 等）——
 * 返回带错误说明的文本，让 agent 知道失败原因、能改正（如换 id 重试、先 list_artifacts）。
 */
function errorResult(action: string, e: unknown): AgentToolResult<undefined> {
  const message = e instanceof Error ? e.message : String(e);
  return jsonResult({ error: `${action}失败：${message}` });
}

// ---------------------------------------------------------------------------
// 三个工具的 TypeBox schema（V2-0 spike 已实证：parameters 用 typebox、不是 zod）
// ---------------------------------------------------------------------------
const createArtifactSchema = Type.Object({
  kind: Type.String(),
  title: Type.String(),
  content: Type.String(),
});
const proposeEditSchema = Type.Object({
  id: Type.String(),
  newContent: Type.String(),
});
const listArtifactsSchema = Type.Object({});

/**
 * 解析提议工具的后端依赖（artifactService / pendingStore），供 {@link buildDocTools} 与
 * {@link buildDispatchDocTools} 共用——两者后端解析逻辑一致（默认文件后端、半注入防护，D-V2-09）。
 * 默认后端指向 ~/.pi/projects.json（registry 构造惰性、无 I/O），与 resolve/pending 路由的默认 store
 * 指向同一批文件、UI 读得到（沿用 P0 guard 装配的默认后端约定）。
 */
function resolveBackends(deps: DocToolDeps): {
  artifactService: ArtifactService;
  pendingStore: PendingChangeStore;
} {
  const registry = new ProjectRegistry();
  const artifactService = deps.artifactService ?? new ArtifactService(registry);
  // 透传 artifactService（D-V2-09）：PendingChangeStore 第二参为复用 artifactService 预留，
  // 默认分支也传同一实例——省一次实例化 + 强制默认 pendingStore 与上行 artifactService 同源，
  // 消除「半注入（只注 artifactService 省 pendingStore）→读不到对方落的数据」footgun 的一半爆炸半径。
  const pendingStore = deps.pendingStore ?? new PendingChangeStore(registry, artifactService);
  return { artifactService, pendingStore };
}

/** create_artifact 工具工厂（闭包注入 projectId/sourceActor/artifactService）。供两个装配函数共用。 */
function makeCreateArtifactTool(
  projectId: string,
  sourceActor: string,
  artifactService: ArtifactService,
): DocToolDef {
  return defineTool({
    name: "create_artifact",
    label: "create_artifact",
    description:
      "新建一个受管文档（如需求/PRD/设计），直接落第一版并物化成项目里的真实 .md 文件。" +
      "参数 kind（文档类型，如 crd/prd/design）、title（标题，将作为文件名）、content（首版完整正文）。" +
      "返回新文档的 id（后续 propose_edit 改它时用）、filePath、version。",
    parameters: createArtifactSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof createArtifactSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const artifact = artifactService.createArtifact(projectId, {
          kind: params.kind,
          title: params.title,
          content: params.content,
          author: sourceActor,
        });
        return jsonResult({
          id: artifact.id,
          filePath: artifact.filePath,
          version: artifact.currentVersion,
        });
      } catch (e) {
        return errorResult("创建文档", e);
      }
    },
  });
}

/** propose_edit 工具工厂（闭包注入 projectId/sourceActor/后端）。**仅交互式文档会话用**（headless dispatch 不挂它）。 */
function makeProposeEditTool(
  projectId: string,
  sourceActor: string,
  artifactService: ArtifactService,
  pendingStore: PendingChangeStore,
): DocToolDef {
  return defineTool({
    name: "propose_edit",
    label: "propose_edit",
    description:
      "对一个【已存在】的受管文档提议一次修改：不直接写盘，而是转成待确认变更（PendingChange），" +
      "由用户在界面上逐块确认 ✓/✗ 后才生成新版本。" +
      "参数 id（目标文档 id，用 list_artifacts 查；用户若用标题/文件名指代，请先 list_artifacts 按 title 挑出 id）、" +
      "newContent。" +
      "⚠️ newContent 必须是【完整的新全文】：未改动的段落必须逐字保留、不得改写或省略未提及的内容。" +
      "系统用 LCS 只把真正变化的块切出来给用户确认，所以你内部仍要回整篇；若回残篇/片段，" +
      "其余正文会被判为删除、造成满屏噪声。" +
      "返回 changeId（无变化时为 null）、diffBlockCount、note。",
    // promptGuidelines（D-V2-09，对抗 review 加固）：把 coreIssue 命门（整篇 vs 残篇）的硬约束
    // 同时挂到系统提示层、工具激活期常驻，与逐 call 的 description 形成双通道冗余——降低模型回残篇
    // 致「其余正文被判删除、满屏噪声」的概率。
    promptGuidelines: [
      "调用 propose_edit 时 newContent 必须是【完整的新全文】：未改动段落逐字保留，禁止只回片段/残篇，否则其余正文会被判为删除、造成满屏噪声。",
    ],
    parameters: proposeEditSchema,
    async execute(
      _toolCallId: string,
      params: Static<typeof proposeEditSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      try {
        // ① 查未决（D-V2-05）：该文档已有待确认变更则拒绝、引导先处理（避免叠加多份 pending 难对账）。
        const existing = pendingStore.listPendingChanges(projectId, params.id);
        if (existing.length > 0) {
          return jsonResult({
            changeId: null,
            diffBlockCount: 0,
            note: `该文档已有 ${existing.length} 处待确认变更，请先在界面处理（确认/拒绝）后再提议修改。`,
          });
        }

        // ② 切块：空块（与当前版逐字相同 → 无变化）不落 pending、不产生幽灵版本。
        const oldContent = artifactService.readCurrentContent(projectId, params.id);
        const diffBlocks = computeReplaceDiffBlocks(oldContent, params.newContent);
        if (diffBlocks.length === 0) {
          return jsonResult({ changeId: null, diffBlockCount: 0, note: "内容无变化，未创建待确认变更。" });
        }

        // ③ 组装并落盘 PendingChange（不写真实文件/不出新版本——等用户按块确认）。
        const change = buildReplacePendingChange({
          artifactId: params.id,
          sourceActor,
          oldContent,
          newContent: params.newContent,
        });
        pendingStore.save(projectId, change);
        return jsonResult({
          changeId: change.id,
          diffBlockCount: change.diffBlocks.length,
          note: `已创建待确认变更（${change.diffBlocks.length} 个变化块），等待用户逐块确认。`,
        });
      } catch (e) {
        // 常见：id 不存在 → readCurrentContent 抛 NOT_FOUND。提示 agent 先 list_artifacts 核对 id。
        return errorResult("提议修改（请确认 id 是否正确，可先用 list_artifacts 核对）", e);
      }
    },
  });
}

/** list_artifacts 工具工厂（闭包注入 projectId/artifactService）。供两个装配函数共用。 */
function makeListArtifactsTool(projectId: string, artifactService: ArtifactService): DocToolDef {
  return defineTool({
    name: "list_artifacts",
    label: "list_artifacts",
    description:
      "列出当前项目里所有受管文档（只读）。用户用标题/文件名指代某文档、而你需要它的 id 时，" +
      "先用本工具按 title 挑出对应的 id，再 propose_edit。" +
      "返回 [{ id, title, kind, currentVersion, filePath }]（filePath 是相对项目根的路径，可用 read 工具读该文档正文；旧文档可能无 filePath）。",
    parameters: listArtifactsSchema,
    async execute(
      _toolCallId: string,
      _params: Static<typeof listArtifactsSchema>,
      _signal: AbortSignal | undefined,
      _onUpdate,
      _ctx,
    ): Promise<AgentToolResult<undefined>> {
      try {
        const artifacts = artifactService.listArtifacts(projectId);
        return jsonResult(
          // filePath（相对项目根）透传：主脑做汇总时按需用 read 工具读上游产物正文（轻读，非全量拼接）。
          // 旧文档无 filePath（undefined）→ JSON.stringify 略去该键，消费者按「不可轻读」处理。向后兼容：
          // 多一个字段、doc-session 交互会话 / dispatch-doc worker 等现有消费者忽略即可。
          artifacts.map((a) => ({
            id: a.id,
            title: a.title,
            kind: a.kind,
            currentVersion: a.currentVersion,
            filePath: a.filePath,
          })),
        );
      } catch (e) {
        return errorResult("列出文档", e);
      }
    },
  });
}

/**
 * 装配**交互式**文档会话的三个提议工具（闭包注入 deps）。返回数组直接进 `createAgentSession({ customTools })`。
 * 注意：白名单（tools）须含这三个工具名，否则内核 `_refreshToolRegistry` 按白名单名过滤掉它们
 * （D-V2-04 命门，V2-0 spike 已双向实证）——该白名单由 V2-3 的 assembleDocSessionOptions 负责。
 *
 * 返回顺序固定 [create_artifact, propose_edit, list_artifacts]（doc-session.test.ts 断言依赖）。
 */
export function buildDocTools(deps: DocToolDeps): DocToolDef[] {
  const { projectId, sourceActor } = deps;
  const { artifactService, pendingStore } = resolveBackends(deps);
  return [
    makeCreateArtifactTool(projectId, sourceActor, artifactService),
    makeProposeEditTool(projectId, sourceActor, artifactService, pendingStore),
    makeListArtifactsTool(projectId, artifactService),
  ];
}

/**
 * 装配**派发（headless dispatch）**文档会话的提议工具——只 `create_artifact` + `list_artifacts`，
 * **不含 `propose_edit`**：派发 worker 无人在界面按块确认，propose_edit 会落下永远悬而未决的 PendingChange。
 * 让文档型 dispatch worker 也能产受管文档（create_artifact 直接落 v1 + 物化），但改已存在文档仍须走交互式会话。
 *
 * 与 {@link buildDocTools} 共用同一批工具工厂（create/list），仅少装 propose_edit。
 * 白名单须含这两个工具名（{@link DISPATCH_DOC_SESSION_TOOLS}），否则内核按名过滤掉、调不到（D-V2-04）。
 */
export function buildDispatchDocTools(deps: DocToolDeps): DocToolDef[] {
  const { projectId, sourceActor } = deps;
  const { artifactService } = resolveBackends(deps);
  return [
    makeCreateArtifactTool(projectId, sourceActor, artifactService),
    makeListArtifactsTool(projectId, artifactService),
  ];
}
