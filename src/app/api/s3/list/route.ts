import { NextRequest, NextResponse } from "next/server";
import { listObjects } from "@/lib/garage/s3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bucketId = sp.get("bucketId");
  const bucketName = sp.get("bucketName");
  if (!bucketId || !bucketName) {
    return NextResponse.json({ error: "bucketId and bucketName are required" }, { status: 400 });
  }
  try {
    const result = await listObjects({
      bucketId,
      bucketName,
      prefix: sp.get("prefix") ?? undefined,
      continuationToken: sp.get("continuationToken") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
