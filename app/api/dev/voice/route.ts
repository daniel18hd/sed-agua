// /dev "Simular llamada": arma las variables de voz de un caso y las muestra. NUNCA llama.
import { NextResponse } from "next/server";
import { demoEntradas } from "@/lib/bot";
import { locate, evaluar, data } from "@/lib/brain";
import { buildVoiceVars, isCritical } from "@/lib/voice/vars";
import { AGENT_ID, PHONE_ID, dryRun } from "@/lib/voice/call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.DEV_KEY && new URL(req.url).searchParams.get("key") !== process.env.DEV_KEY)
    return NextResponse.json({ error: "DEV_KEY requerida" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const e = demoEntradas().find((x) => x.id === b.casoId);
  if (!e) return NextResponse.json({ error: "casoId desconocido" }, { status: 400 });
  let loc = locate(e.lat, e.lon)!;
  if (e.coord_nota) loc = { lat: e.lat, lon: e.lon, cve_mun: loc.cve_mun, alcaldia: loc.alcaldia, colonia: `${e.label} (ubicación aprox.)` };
  const now = b.now || process.env.DEMO_NOW || data().demo._meta.ahora_demo.valor;
  const ev = evaluar(loc, { now, demo: e.demo || b.demo !== false, casoId: e.demo ? undefined : e.id });
  const critico = isCritical(ev);
  return NextResponse.json({
    critico,
    se_ofreceria_llamada: critico,
    dry_run_en_produccion: dryRun(),
    agent_id: AGENT_ID(),
    agent_phone_number_id: PHONE_ID(),
    dynamic_variables: critico ? buildVoiceVars(ev, { demo: true }) : null,
    reply: ev.reply,
  });
}
