import { after } from "next/server";
import twilio from "twilio";
import { handleIncoming, MSG, type Salida } from "@/lib/bot";
import { twiml } from "@/lib/twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUDGET_MS = 4200; // Twilio espera ≤15 s, pero queremos responder en <5 s

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
  if (first) return twiml(first.reply, ...(first.extra ?? []));

  after(async () => {
    const res = await work;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!sid || !token || !from || !params.From) return;
    const client = twilio(sid, token);
    for (const body of [res.reply, ...(res.extra ?? [])]) await client.messages.create({ from: `whatsapp:${from.replace(/^whatsapp:/, "")}`, to: params.From, body });
  });
  return twiml(MSG.espera);
}
