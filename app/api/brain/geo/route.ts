import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const FILES: Record<string, string> = { alcaldias: "alcaldias.simplified.geojson", ruta: "ruta_agua.geojson" };
const cache: Record<string, string> = {};

// GeoJSON ligero para el cliente (alcaldías 22 KB, ruta 8 KB). Las colonias NUNCA salen del servidor.
export function GET(req: Request) {
  const f = new URL(req.url).searchParams.get("f") ?? "";
  const file = FILES[f];
  if (!file) return new Response("no", { status: 404 });
  cache[f] ??= fs.readFileSync(path.join(process.cwd(), "brain", "data", file), "utf8");
  return new Response(cache[f], { headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
