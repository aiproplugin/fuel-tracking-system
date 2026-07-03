import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves /favicon.ico from public/logo.png so the browser's automatic
 * favicon request stops 404ing, while preserving the brand
 * single-source-of-truth rule: swapping public/logo.png updates the tab
 * icon too (within the 1h cache window). Browsers accept PNG bytes at
 * /favicon.ico and downscale them.
 */
export const runtime = "nodejs";

export async function GET() {
  const logo = await readFile(path.join(process.cwd(), "public", "logo.png"));
  return new Response(logo, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
