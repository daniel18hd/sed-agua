// Completa lat/lon de los demo-cases que vienen sin coordenada (p. ej. U.H. Hacienda de las Flores) usando Nominatim
// (o Google si hay GOOGLE_GEOCODING_API_KEY). Valida que el punto caiga en la alcaldía del caso antes de escribir.
// Uso (con red): pnpm geocode:demo   → reescribe brain/data/demo-cases.json
import fs from "node:fs";
import path from "node:path";
import { locate } from "../lib/brain.ts";

const file = path.join(process.cwd(), "brain", "data", "demo-cases.json");
const j = JSON.parse(fs.readFileSync(file, "utf8"));
let cambios = 0;
for (const c of j.casos) {
  if (c.lat != null && c.lon != null) continue;
  const q = `${c.referencia ?? c.colonia_reportada}, ${c.alcaldia}, Ciudad de México`;
  let hit: { lat: number; lon: number } | null = null;
  try {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (key) {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address: q, key, region: "mx" })}`).then((r) => r.json());
    const g = r.results?.[0]?.geometry?.location;
    if (g) hit = { lat: g.lat, lon: g.lng };
  } else {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: "mx" })}`, { headers: { "User-Agent": "Sed-hackaton-demo/0.1 (setup)" } }).then((r) => r.json());
    if (r[0]) hit = { lat: Number(r[0].lat), lon: Number(r[0].lon) };
    await new Promise((r) => setTimeout(r, 1100));
  }
  } catch (e) { console.warn(`✗ ${c.id}: geocodificador no disponible (${(e as Error).message})`); continue; }
  if (!hit) { console.warn(`✗ ${c.id}: sin resultado para "${q}"`); continue; }
  const loc = locate(hit.lat, hit.lon);
  if (!loc || loc.cve_mun !== c.cve_mun) { console.warn(`✗ ${c.id}: el resultado cae fuera de ${c.alcaldia} (${loc?.alcaldia ?? "fuera de CDMX"})`); continue; }
  c.lat = Math.round(hit.lat * 1e5) / 1e5;
  c.lon = Math.round(hit.lon * 1e5) / 1e5;
  c.coord_tipo = `aproximada (geocodificada: "${q}")`;
  console.log(`✓ ${c.id}: ${c.lat}, ${c.lon} → ${loc.colonia ?? "?"}, ${loc.alcaldia}`);
  cambios++;
}
if (cambios) fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
console.log(cambios ? `${cambios} caso(s) actualizados` : "Nada que actualizar");
