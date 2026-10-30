import { after } from "next/server";
import twilio from "twilio";
import { handleIncoming, MSG, type Salida } from "@/lib/bot";
import { twiml } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUDGET_MS = 4200; // Twilio espera ≤15 s, pero queremos responder en <5 s

async function sendExtras(to: string | undefined, msgs: string[], delayMs: number) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sid || !token || !from || !to) return;
  const client = twilio(sid, token);
  for (const body of msgs) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      await client.messages.create({ from: `whatsapp:${from.replace(/^whatsapp:/, "")}`, to, body });
    } catch (e) {
      console.error("[twilio] no se pudo enviar el mensaje extra:", (e as Error).message);
    }
  }
}

/** Avisos a otros vecinos (zona marcada en el panel de atención). */
async function sendAvisos(list: { to: string; body: string }[] | undefined) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sid || !token || !from || !list?.length) return;
  const client = twilio(sid, token);
  for (const a of list) {
    try { await client.messages.create({ from: `whatsapp:${from.replace(/^whatsapp:/, "")}`, to: a.to, body: a.body }); }
    catch (e) { console.error("[twilio] aviso no enviado:", (e as Error).message); }
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;

  // 1) firma
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const url = (process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") + new URL(req.url).pathname : req.url);
    const ok = twilio.validateRequest(token, req.headers.get("x-twilio-signature") ?? "", url, params);
    if (!ok) return new Response("firma inválida", { status: 403 });
  } else {
    console.warn("[twilio] TWILIO_AUTH_TOKEN vacío: firma NO validada (solo dev)");
  }

  // 2) router con presupuesto de tiempo; si se pasa, "Dame un segundo…" y luego REST
  const work = handleIncoming(params, { canal: "whatsapp" }).catch((e): Salida => {
    console.error("[twilio] error", e);
    return { reply: "Tuve un problema al consultar 😓. Intenta de nuevo o comparte tu ubicación 📍", kind: "error" };
  });
  const timer = new Promise<null>((r) => setTimeout(() => r(null), BUDGET_MS));
  const first = await Promise.race([work, timer]);
  if (first) {
    // El Sandbox limita a ~1 msg/3 s: la respuesta va en TwiML y los extras (oferta de llamada) por REST 3.5 s después.
    if (first.extra?.length) after(() => sendExtras(params.From, first.extra!, 3500));
    if (first.avisos?.length) after(() => sendAvisos(first.avisos));
    return twiml(first.reply || undefined); // "gracias" → cierra sin mandar más
  }

  after(async () => {
    const res = await work;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!sid || !token || !from || !params.From) return;
    if (res.reply) await twilio(sid, token).messages.create({ from: `whatsapp:${from.replace(/^whatsapp:/, "")}`, to: params.From, body: res.reply });
    if (res.extra?.length) await sendExtras(params.From, res.extra, 3500);
    await sendAvisos(res.avisos);
  });
  return twiml(MSG.espera);
}
