import { NextRequest, NextResponse } from "next/server";
import { getLatestStats } from "@/lib/garage/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";
  try {
    const { ts, res } = await getLatestStats({ forceRefresh });
    return NextResponse.json({ ts, data: res });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
