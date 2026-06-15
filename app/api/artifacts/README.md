# app/api/artifacts（受管 artifact 读写路由）

> 归属：Next-Step 新增。　规格：`../../../next-step/docs/05-features-功能清单.md` §5.6（版本管理）、`../../../next-step/docs/04-api-contracts-接口契约.md`（接口契约）

## 作用
受管 artifact 的 HTTP 入口（D1），是 `lib/domain/artifact-service.ts` 的薄 HTTP 包装：
路由只解析入参 / 跨项目定位（`findArtifact`），业务逻辑全在领域层。
契约路径无 projectId（artifact 全局唯一句柄），故由 service 内 `findArtifact(id)` 扫各项目 `managed/` 反查。
创建入口在另一处 `app/api/projects/[id]/artifacts/route.ts`（建 artifact 需项目上下文）。

## 路由
- `GET /api/artifacts/[id]` — 取 artifact 元数据 + 当前版本内容（404/422）。
- `GET /api/artifacts/[id]/versions` — 列版本，按 version 升序（404）。
- `POST /api/artifacts/[id]/submit-version` — body `{content,note?}` + Header `If-Match`；提交新版（If-Match≠当前 version→409；content 缺→422）。
- `POST /api/artifacts/[id]/rollback` — body `{version}` + Header `If-Match`；回滚（复制目标版成新版）（If-Match≠→409；目标版不存在→404；version 非整数→422）。
- `POST /api/projects/[id]/artifacts` — body `{kind,title,content,author?,extra?}`；建 artifact（201；kind/title 缺→422）。

## 约定 / 红线
- 领域层只抛带 `code` 的错误、**不碰 NextResponse**；路由 `catch` 后交 `lib/api/errors.ts` 的 `domainErrorResponse` 映射。
- 所有写（submit/rollback）经乐观锁：`If-Match` = 客户端上次读到的 `Artifact.version`，缺省=放行、非数字→422（`lib/api/if-match.ts`）。

## 改这个区前
先读 `docs/04` 接口契约 + `docs/05` §5.6；落盘布局见 `docs/02`。
