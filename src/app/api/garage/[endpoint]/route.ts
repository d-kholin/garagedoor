import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_ENDPOINTS, garageAdmin, GarageApiError } from "@/lib/garage/admin";

export const dynamic = "force-dynamic";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ endpoint: string }> },
) {
  const { endpoint } = await params;
  const expectedMethod = ALLOWED_ENDPOINTS[endpoint];
  if (!expectedMethod) {
    return NextResponse.json({ error: `Endpoint not allowed: ${endpoint}` }, { status: 403 });
  }
  if (req.method !== expectedMethod) {
    return NextResponse.json(
      { error: `${endpoint} requires ${expectedMethod}` },
      { status: 405 },
    );
  }

  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (query[k] = v));

  let body: unknown = undefined;
  if (req.method === "POST") {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  }

  try {
    const result = await garageAdmin(endpoint, { params: query, body });
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof GarageApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Failed to reach Garage admin API: ${message}` },
      { status: 502 },
    );
  }
}

export { handle as GET, handle as POST };
