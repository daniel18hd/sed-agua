import { NextResponse } from "next/server";
import { locate, evaluar } from "@/lib/brain";
import { countReportes24h } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evaluate?lat=19.386&lon=-99.143[&now=ISO][&demo=1]
export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "lat y lon requeridos" }, { status: 400 });
  const loc = locate(lat, lon);
  if (!loc) return NextResponse.json({ error: "fuera de CDMX", loc: null }, { status: 404 });
  const now = u.searchParams.get("now") || undefined;
  const reportes24h = await countReportes24h(loc);
  const e = evaluar(loc, { now, reportes24h, demo: u.searchParams.get("demo") === "1" });
  return NextResponse.json({ loc: e.loc, resultado: e.resultado, llegada: e.llegada, calidad: e.calidad, reply: e.reply, caso: e.caso, signals: e.signals, llegada_demo: e.llegada_demo, ahora: e.ahora });
}
