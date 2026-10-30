// Llamada de alerta (interna). La usa el bot tras un "SÍ"; también acepta POST con x-internal-key.
// Guardas: header interno · el número escribió antes (≤24 h) y no hizo opt-out · crítico · ≤1/hora · texto seguro.
import { NextResponse } from "next/server";
import { triggerVoiceAlert } from "@/lib/voice/call";
import { getSesion, phoneHash } from "@/lib/store";
import type { VoiceVars } from "@/lib/voice/vars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.INTERNAL_KEY || req.headers.get("x-internal-key") !== process.env.INTERNAL_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { to, vars, consulta_id } = (await req.json().catch(() => ({}))) as { to?: string; vars?: VoiceVars; consulta_id?: string };
  if (!to || !vars) return NextResponse.json({ error: "to y vars requeridos" }, { status: 400 });
  const ph = phoneHash(to.startsWith("whatsapp:") ? to : `whatsapp:${to}`);
  const ses = await getSesion(ph);
  const optIn = !!ses.voz?.last_inbound_at && Date.now() - ses.voz.last_inbound_at < 86_400_000 && !ses.voz.opt_out;
  const r = await triggerVoiceAlert({ to, phone_hash: ph, vars, optIn, consulta_id });
  return NextResponse.json(r.ok ? r.body : { error: r.error, body: r.body }, { status: r.status });
}
