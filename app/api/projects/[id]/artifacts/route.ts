import { NextResponse } from "next/server";
import { ArtifactService } from "@/lib/domain/artifact-service";
import { domainErrorResponse } from "@/lib/api/errors";

// POST /api/projects/[id]/artifacts — 在该项目下新建受管 artifact（落 managed/<id>/ + v1）
// body: { kind, title, content, author?, extra? }；kind/title 缺 → 422。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: unknown;
      title?: unknown;
      content?: unknown;
      author?: unknown;
      extra?: unknown;
    };
    const input = {
      kind: typeof body.kind === "string" ? body.kind : "",
      title: typeof body.title === "string" ? body.title : "",
      content: typeof body.content === "string" ? body.content : "",
      ...(typeof body.author === "string" ? { author: body.author } : {}),
      ...(body.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
        ? { extra: body.extra as Record<string, unknown> }
        : {}),
    };
    const artifact = new ArtifactService().createArtifact(id, input);
    return NextResponse.json(artifact, { status: 201 });
  } catch (error) {
    return domainErrorResponse(error);
  }
}
