// Plantilla de respuesta WhatsApp: máx. 4 líneas: semáforo · cuándo llega · calidad/razón · fuente+acción.
// El LLM (opcional) SOLO puede reescribir este texto a partir de los JSON calculados; nunca inventa ni afirma potabilidad.
import type { Resultado } from "./semaforo.ts";
import { type Llegada, textoLlegada } from "./llegada.ts";
import type { AvisoCalidad } from "./calidad.ts";

const EMOJI = { verde: "🟢", ambar: "🟡", rojo: "🔴", gris: "⚪" } as const;
const TITULO = { verde: "Sin alertas", ambar: "Atención", rojo: "Alerta", gris: "Sin datos suficientes" } as const;
export const PROHIBIDAS = [/apta para (beber|consumo)/i, /\bes potable\b/i, /\bse puede beber\b/i, /\bsegura para beber\b/i, /\bagua segura\b/i];

// llegadaDemo: el "cuándo llega" viene de escenarios_demo (fuga sin fin demo) → se marca [DEMO] y "Fuente: caso de demostración".
export interface ReplyCtx { lugar: string; llegada?: Llegada; calidad?: AvisoCalidad | null; llegadaDemo?: boolean }

export function buildReply(res: Resultado, ctx: ReplyCtx): string {
  const razon = res.razones.slice(0, 2).join(". ") || "Sin señales relevantes";
  const l2 = ctx.llegada ? (ctx.llegadaDemo ? textoLlegada(ctx.llegada).replace(/^⏱ /, "⏱ [DEMO] ") : textoLlegada(ctx.llegada)) : razon;
  const l3 = ctx.calidad ? `⚠️ ${ctx.calidad.texto}. ${ctx.calidad.recomendacion}` : ctx.llegada ? razon : null;
  const f = (ctx.llegada?.tipo === "oficial" ? ctx.llegada.fuente : undefined) ?? ctx.calidad?.fuente ?? res.fuentes[0];
  const fuente = ctx.calidad?.es_demo || ctx.llegadaDemo ? "Fuente: caso de demostración" : f ? `Fuente: ${f.nombre} (${f.fecha})` : "Fuente: sin dato";
  const accion = res.nivel === "rojo" ? "Pipa gratis *426 · Locatel *0311" : ctx.calidad ? "Reporta: *426" : "¿Sin agua? Responde *REPORTAR*";
  const lines = [`${EMOJI[res.nivel]} ${TITULO[res.nivel]} · ${ctx.lugar}`, l2, l3, `${fuente} · ${accion}`].filter(Boolean);
  return assertSafe(lines.join("\n"));
}

export function assertSafe(text: string): string {
  for (const re of PROHIBIDAS) if (re.test(text)) throw new Error("Texto prohibido: no afirmar potabilidad");
  return text;
}
