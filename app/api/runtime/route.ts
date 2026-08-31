import { PLOTLINE_RUNTIME_VERSION } from "@/lib/runtime-version";

export async function GET() {
  return Response.json(
    { runtimeVersion: PLOTLINE_RUNTIME_VERSION },
    { headers: { "cache-control": "no-store" } },
  );
}
