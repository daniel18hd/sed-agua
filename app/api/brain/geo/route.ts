import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const FILES: Record<string, string> = { alcaldias: "alcaldias.simplified.geojson", ruta: "ruta_agua.geojson" };
const cache: Record<string, string> = {};

// GeoJSON ligero para el cliente (alcaldías 22 KB, ruta 8 KB). El catálogo de colonias no sale completo:
// solo el contorno de UNA colonia a la vez (?f=colonia&cve=006-001), para marcar zonas que requieren atención.
let colonias: { features: { properties: { cve_col: string } }[] } | null = null;
export function GET(req: Request) {
  const u = new URL(req.url);
  const f = u.searchParams.get("f") ?? "";
  if (f === "colonia") {
    const cve = u.searchParams.get("cve") ?? "";
    if (!/^\d{3}-\d{3}$/.test(cve)) return new Response("no", { status: 400 });
    colonias ??= JSON.parse(fs.readFileSync(path.join(process.cwd(), "brain", "data", "colonias.simplified.geojson"), "utf8"));
    const ft = colonias!.features.find((x) => x.properties.cve_col === cve);
    if (!ft) return new Response("no", { status: 404 });
    return Response.json(ft, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }
  const file = FILES[f];
  if (!file) return new Response("no", { status: 404 });
  cache[f] ??= fs.readFileSync(path.join(process.cwd(), "brain", "data", file), "utf8");
  return new Response(cache[f], { headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
