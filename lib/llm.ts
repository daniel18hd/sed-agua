// LLM opcional (LLM_REPLY=1 + OPENAI_API_KEY): SOLO reformula la respuesta ya calculada. Prompt cerrado; si algo falla → buildReply.
import { assertSafe } from "@/brain/rules/whatsapp.ts";
import type { Evaluacion } from "@/lib/brain";

const SYSTEM = `Reescribes un mensaje de WhatsApp en español de México: cálido, directo, lenguaje de 6º de primaria, frases cortas, sin tecnicismos. NO agregas datos.
Reglas duras: máximo 4 líneas; un solo emoji (el del semáforo, al inicio); conserva cifras, fechas, nombres de fuente, "[DEMO]", "ESTIMADO (no oficial)", "Fuente: …" al final y teléfonos (*426, *0311) EXACTOS;
termina con UNA acción; no inventes datos, horarios ni causas; la calidad es de la planta, no de la llave; nunca digas que el agua es potable, apta o segura para beber. Devuelve solo el mensaje.`;

export async function maybeLLM(ev: Evaluacion): Promise<string> {
  const base = ev.reply;
  if (process.env.LLM_REPLY !== "1" || !process.env.OPENAI_API_KEY) return base;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Mensaje base:\n${base}\n\nJSON calculado (única fuente de verdad):\n${JSON.stringify({ resultado: ev.resultado, llegada: ev.llegada, calidad: ev.calidad })}` },
        ],
      }),
    });
    const j = await r.json();
    const out: string = j?.choices?.[0]?.message?.content?.trim() ?? "";
    return validaLLM(base, out) ? assertSafe(out) : base;
  } catch {
    return base;
  } finally {
    clearTimeout(t);
  }
}

/** El texto reformulado debe conservar los marcadores críticos del texto base. */
export function validaLLM(base: string, out: string): boolean {
  if (!out || out.split("\n").length > 4) return false;
  try { assertSafe(out); } catch { return false; }
  const marcas = ["[DEMO]", "ESTIMADO (no oficial)", "caso de demostración", "*426", "corte programado", "no sabemos cómo llega a tu llave", "Aún no tengo avisos oficiales"].filter((m) => base.includes(m));
  if (!marcas.every((m) => out.includes(m))) return false;
  const fuente = base.match(/Fuente: [^\n]+$/)?.[0]?.trim();
  if (fuente && !out.includes(fuente)) return false;
  return out[0] === base[0] && out.slice(0, 2) === base.slice(0, 2);
}
