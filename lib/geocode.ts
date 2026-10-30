// Geocodificación acotada a CDMX. Google (si hay key) → Nominatim (1 req/s, solo demo) → match por nombre de colonia.
import { colonyByName } from "@/lib/brain";

export interface GeoHit { lat: number; lon: number; fuente: "direccion" | "cp" | "colonia"; proveedor: "google" | "nominatim" | "catalogo" }

// bounds CDMX (sur-oeste / nor-este)
const S = 19.04, W = -99.37, N = 19.6, E = -98.94;
const TIMEOUT = 2500;
export const esCP = (t: string) => /^\d{5}$/.test(t.trim());

async function fetchJSON(url: string, init?: RequestInit): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function google(texto: string, cp: boolean): Promise<GeoHit | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;
  const p = new URLSearchParams({ key, language: "es", region: "mx", bounds: `${S},${W}|${N},${E}` });
  if (cp) p.set("components", `postal_code:${texto.trim()}|country:MX|administrative_area:Ciudad de México`);
  else { p.set("address", texto); p.set("components", "country:MX"); }
  const j = await fetchJSON(`https://maps.googleapis.com/maps/api/geocode/json?${p}`);
  const r = j?.results?.[0];
  if (!r) return null;
  return { lat: r.geometry.location.lat, lon: r.geometry.location.lng, fuente: cp ? "cp" : "direccion", proveedor: "google" };
}

// Nominatim: máx 1 req/s y User-Agent propio (política OSM). Solo para demo.
let nomQueue: Promise<unknown> = Promise.resolve();
let nomLast = 0;
function nominatim(texto: string, cp: boolean): Promise<GeoHit | null> {
  const run = async () => {
    const wait = Math.max(0, nomLast + 1000 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nomLast = Date.now();
    const p = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "mx", "accept-language": "es", viewbox: `${W},${N},${E},${S}` });
    if (cp) { p.set("postalcode", texto.trim()); p.set("state", "Ciudad de México"); }
    else p.set("q", /cdmx|ciudad de m[eé]xico/i.test(texto) ? texto : `${texto}, Ciudad de México`);
    const j = await fetchJSON(`https://nominatim.openstreetmap.org/search?${p}`, {
      headers: { "User-Agent": "Sed-hackaton-demo/0.1 (agua CDMX; contacto: dan@roc.space)" },
    });
    const r = j?.[0];
    return r ? ({ lat: Number(r.lat), lon: Number(r.lon), fuente: cp ? "cp" : "direccion", proveedor: "nominatim" } as GeoHit) : null;
  };
  const p = nomQueue.then(run, run);
  nomQueue = p.catch(() => null);
  return p;
}

export async function geocode(texto: string): Promise<GeoHit | null> {
  const cp = esCP(texto);
  // El semáforo es por colonia: si el texto trae una colonia del catálogo sin ambigüedad, no hace falta red.
  const local = cp ? null : colonyByName(texto);
  if (local?.fuerza === "alta") return { lat: local.lat, lon: local.lon, fuente: "colonia", proveedor: "catalogo" };
  for (const fn of [google, nominatim]) {
    try {
      const hit = await fn(texto, cp);
      if (hit) return hit;
    } catch (e) {
      console.warn(`[geocode] ${fn.name} falló:`, (e as Error).message);
    }
  }
  // Solo alcaldía (sin colonia) no basta: el bot pide más detalle en vez de adivinar la colonia.
  return null;
}
