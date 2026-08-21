import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getObjectStream } from "@/lib/garage/s3";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bucketId = sp.get("bucketId");
  const bucketName = sp.get("bucketName");
  const key = sp.get("key");
  if (!bucketId || !bucketName || !key) {
    return NextResponse.json(
      { error: "bucketId, bucketName and key are required" },
      { status: 400 },
    );
  }
  try {
    const { body, contentType, contentLength } = await getObjectStream({
      bucketId,
      bucketName,
      key,
    });
    if (!body) {
      return NextResponse.json({ error: "Empty response body" }, { status: 502 });
    }
    const filename = key.split("/").pop() || "download";
    const stream = Readable.toWeb(body as Readable) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
