import { NextResponse } from "next/server";
import { PipelineRunStore } from "@/lib/domain/pipeline-run-store";
import { getRunController } from "@/lib/pi/run-controllers";
import { domainErrorResponse } from "@/lib/api/errors";

// POST /api/pipeline-runs/[runId]/cancel — 取消运行中的 run（翻 cancelRequested + abort 注册的 controller）。
// 路径无 projectId，故 findRun 跨项目定位返回 {projectId, run}（镜像同目录 GET route.ts:13-16）。
// 取消的真正中断靠 abort：controller.signal 翻转后，runPipeline 顶 cancel 检测 + worker signal 提前结束
// → run→failed('已取消')、该阶段 evict 释槽（AC-9 释放后半已由 T3 编排器覆盖，本路由不重复 evict）。
// controller 的清理**不在此处**：runs/route.ts 的 `.finally(deleteRunController)` 是唯一终态清理点
// （cancel→abort→runPipeline resolve→finally 触发删除），保持单一清理点 DRY、本路由只 abort 不删。
// 幂等：仅 running 才翻 + abort（终态/不存在均不动）；server route 可正常 value-import 领域层（非 "use client" 链）。
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    const store = new PipelineRunStore();
    const { projectId, run } = store.findRun(runId); // 跨项目定位；不存在→NOT_FOUND 404
    if (run.status === "running") {
      run.cancelRequested = true;
      store.write(projectId, run); // atomicWrite 内置 mkdir
      getRunController(runId)?.abort(); // 进程级单例；无则 ?. no-op（dev 重启后 controller 已丢，读时对账兜底）
    }
    return NextResponse.json(run);
  } catch (error) {
    return domainErrorResponse(error); // NOT_FOUND→404 自动映射
  }
}
