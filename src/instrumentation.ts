export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSampler } = await import("@/lib/garage/history");
    startSampler();
  }
}
