import { NextResponse } from "next/server";
import { handleIncoming, consultaDemo, demoEntradas } from "@/lib/bot";
import { insertConsulta } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST {Body?, Latitude?, Longitude?, From?, NumMedia?, now?, demo?, casoId?}
// casoId → dispara un demo-case/escenario por id con sus coordenadas, y lo publica al OS como una consulta más.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const t0 = Date.now();
  if (b.casoId) {
    const pub = consultaDemo(b.casoId, { now: b.now || undefined, canal: "dev" });
    if (!pub) return NextResponse.json({ error: "casoId desconocido" }, { status: 400 });
    pub.id = crypto.randomUUID();
    pub.created_at = new Date().toISOString();
    pub.id = await insertConsulta(pub, { texto: `[dev] ${b.casoId}` });
    return NextResponse.json({ reply: pub.resultado.reply, consulta: pub, kind: "consulta", ms: Date.now() - t0 });
  }
  const r = await handleIncoming(
    { From: b.From || "whatsapp:+5215500000000", Body: b.Body, Latitude: b.Latitude, Longitude: b.Longitude, NumMedia: b.NumMedia },
    { canal: "dev", now: b.now || undefined, demo: b.demo !== false },
  );
  return NextResponse.json({ ...r, ms: Date.now() - t0 });
}

export function GET() {
  return NextResponse.json({ entradas: demoEntradas() });
}
