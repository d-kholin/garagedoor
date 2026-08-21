import { NextRequest, NextResponse } from "next/server";
import { getHistory } from "@/lib/garage/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hours = Math.min(
    24 * 31,
    Math.max(0.05, parseFloat(req.nextUrl.searchParams.get("hours") ?? "24")),
  );
  try {
    const samples = await getHistory(hours);
    return NextResponse.json({ samples });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
