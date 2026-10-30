// Disparo de la llamada de alerta (ElevenLabs → Twilio outbound). Guardas duras: opt-in, crítico, ≤1/hora, texto seguro.
// Dry-run por defecto: solo llama de verdad con VOICE_DRY_RUN=0 + ELEVENLABS_API_KEY.
import { callsSince, logVoiceCall, maskPhone, marcarLlamada } from "@/lib/store";
import type { VoiceVars } from "@/lib/voice/vars";

export const BANNED = /apta para (beber|consumo)|agua (segura|potable)|es potable/i;
export const AGENT_ID = () => process.env.ELEVENLABS_AGENT_ID || "agent_9501m674z09mfptt3z954cmmfrbg";
// Número de Sed: +1 832 346 6398 (antes "Demo KL Residences", reasignado al agente de Sed el 30-oct-2026 con OK de Daniel).
// Se lee de ELEVENLABS_SED_PHONE_ID; ELEVENLABS_PHONE_NUMBER_ID quedó obsoleta (apuntaba al outbound de Sofía).
export const PHONE_ID = () => process.env.ELEVENLABS_SED_PHONE_ID || "phnum_5701m4vx6vvsfz1bn8bz4nzn4320";
// Nunca usar el número de Sofía · Devoluciones (otro proyecto).
const PROHIBIDO_PHONE_ID = "phnum_8701m5gat1j3f38s59jpfmdg2145";
// Llamadas reales con VOICE_LIVE=1 (o VOICE_DRY_RUN=0) y la API key; si no, dry-run.
export const dryRun = () => !(process.env.VOICE_LIVE === "1" || process.env.VOICE_DRY_RUN === "0") || !process.env.ELEVENLABS_API_KEY;

export type VoiceResult =
  | { ok: true; dry_run: boolean; status: 200; body: Record<string, unknown> }
  | { ok: false; dry_run: boolean; status: 403 | 422 | 429 | 502; error: string; body?: unknown };

export interface VoiceRequest {
  to: string;               // siempre el From del WhatsApp (whatsapp:+52…)
  phone_hash: string;
  vars: VoiceVars;
  optIn: boolean;           // escribió antes y respondió SÍ dentro de la ventana
  consulta_id?: string;
}

/** WhatsApp entrega celulares de México como +521 + 10 dígitos; para llamar se marca +52 + 10 dígitos. */
export function numeroParaLlamar(from: string): string {
  const n = from.replace(/^whatsapp:/, "").replace(/[^\d+]/g, "");
  const mx = n.match(/^\+521(\d{10})$/);
  return mx ? `+52${mx[1]}` : n;
}

const critico = (v: VoiceVars) => v.nivel === "rojo" || v.motivo === "corte programado" || v.motivo === "alerta de calidad";

export async function triggerVoiceAlert(r: VoiceRequest): Promise<VoiceResult> {
  const dry = dryRun();
  if (!r.optIn) return { ok: false, dry_run: dry, status: 403, error: "no_opt_in" };
  if (!critico(r.vars)) return { ok: false, dry_run: dry, status: 422, error: "not_critical" };
  if (BANNED.test(JSON.stringify(r.vars))) return { ok: false, dry_run: dry, status: 422, error: "unsafe_text" };
  if ((await callsSince(r.phone_hash, Date.now() - 3_600_000)) > 0) return { ok: false, dry_run: dry, status: 429, error: "rate_limited" };
  if (PHONE_ID() === PROHIBIDO_PHONE_ID) return { ok: false, dry_run: dry, status: 422, error: "phone_number_prohibido" };

  const to_number = numeroParaLlamar(r.to);
  const body = {
    agent_id: AGENT_ID(),
    agent_phone_number_id: PHONE_ID(),
    to_number,
    conversation_initiation_client_data: { dynamic_variables: r.vars },
    telephony_call_config: { ringing_timeout_secs: 30 },
  };
  const base = { phone_hash: r.phone_hash, to_masked: maskPhone(r.to), colonia: r.vars.colonia, nivel: r.vars.nivel, motivo: r.vars.motivo, es_demo: r.vars.es_demo === "true", consulta_id: r.consulta_id ?? null };

  if (dry) {
    await logVoiceCall({ ...base, ok: true, dry_run: true, conversation_id: null, call_sid: null, error: null });
    await marcarLlamada(r.consulta_id, { estado: "dry_run" });
    return { ok: true, dry_run: true, status: 200, body: { dry_run: true, request: { ...body, to_number: maskPhone(to_number) } } };
  }

  let data: any = {};
  let ok = false;
  let error: string | null = null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    ok = res.ok && data?.success !== false;
    if (!ok) error = JSON.stringify(data).slice(0, 500);
  } catch (e) {
    error = (e as Error).message;
  }
  await logVoiceCall({ ...base, ok, dry_run: false, conversation_id: data?.conversation_id ?? null, call_sid: data?.callSid ?? null, error });
  await marcarLlamada(r.consulta_id, { estado: ok ? "llamando" : "error" });
  return ok ? { ok: true, dry_run: false, status: 200, body: data } : { ok: false, dry_run: false, status: 502, error: error ?? "error", body: data };
}
