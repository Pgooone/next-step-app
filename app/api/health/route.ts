import { runAllChecks } from "@/lib/env/doctor-checks";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await runAllChecks();
  const ok = r.node.ok && r.deps.ok && r.credentials.ok && r.piHome.ok;
  return Response.json({
    node: { ok: r.node.ok, version: process.version },
    deps: { ok: r.deps.ok },
    credentials: { ok: r.credentials.ok },
    piHome: { ok: r.piHome.ok, writable: r.piHome.ok },
    ok,
  });
}
