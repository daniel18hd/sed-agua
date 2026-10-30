import { NextResponse } from "next/server";
import { consultaDemo, demoEntradas } from "@/lib/bot";

export const runtime = "nodejs";

// Eventos precalculados de los 10 casos + 2 escenarios para /os?mock=1 (el cliente los reproduce localmente, sin Twilio ni Supabase).
export function GET(req: Request) {
  const now = new URL(req.url).searchParams.get("now") || undefined;
  const eventos = demoEntradas().map((e) => consultaDemo(e.id, { now, canal: "mock" })).filter(Boolean);
  return NextResponse.json({ eventos }, { headers: { "Cache-Control": "public, s-maxage=600" } });
}
