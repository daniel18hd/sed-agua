// Respuesta de WhatsApp: español de México, cálido y directo, lenguaje sencillo. Máx. 4 líneas, 1 emoji (el del semáforo).
// Aterrizada a lo que preguntó (foco): resumen (abasto + calidad + 1 tip), calidad primero, o "cuándo llega" primero.
// Cierra con UNA acción y la fuente con fecha corta. Nunca afirma potabilidad: la calidad es de la PLANTA, no de la llave.
// El LLM (opcional) solo puede reescribir este texto a partir de los JSON calculados; nunca inventa.
import type { Resultado, Fuente } from "./semaforo.ts";
import type { Llegada } from "./llegada.ts";
import type { AvisoCalidad } from "./calidad.ts";
import type { OrigenAgua } from "./origen.ts";

const EMOJI = { verde: "🟢", ambar: "🟡", rojo: "🔴", gris: "⚪" } as const;
export const PROHIBIDAS = [/apta para (beber|consumo)/i, /\bes potable\b/i, /\bse puede beber\b/i, /\bsegura para beber\b/i, /\bagua segura\b/i];

export type Foco = "resumen" | "calidad" | "cuando";
export type Accion = "te_llega" | "pipa" | "reporta_calidad" | "reportar" | "ninguna";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fechaCorta = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]}` : iso);
const fuenteCorta = (f: Fuente) => `${f.nombre.replace(/\s*\(.*\)$/, "")}, ${fechaCorta(f.fecha)}`;

// Parámetros de planta en palabras sencillas
const PARAM: Record<string, string> = {
  turbiedad_unt: "qué tan clara está", turbiedad: "qué tan clara está", color_upt_co: "color", color: "color", ph: "acidez",
  cloro_residual_mg_l: "cloro", cloro: "cloro", dureza_mg_l: "dureza", olor: "olor", sabor: "sabor",
};

export interface ReplyCtx {
  lugar: string;
  llegada?: Llegada;
  calidad?: AvisoCalidad | null;
  llegadaDemo?: boolean;
  origen?: OrigenAgua;
  planta?: { fuera_de_norma: string[]; fecha: string; fuente?: Fuente } | null; // Los Berros (salida de planta ≠ llave)
  foco?: Foco;
}

/** Razón del semáforo en palabras sencillas. */
function razonSimple(r: string): string | null {
  if (/^Sequía (D\d)/.test(r)) return "hay sequía en la zona";
  if (/^Cutzamala al ([\d.]+)%/.test(r)) { const p = Number(r.match(/([\d.]+)%/)![1]); return p < 60 ? `las presas del Cutzamala están al ${Math.round(p)}%` : null; }
  if (/tandeo/i.test(r)) return "tu colonia ha tenido tandeos";
  if (/sin agua entubada/.test(r)) return "hay casas sin agua entubada en tu alcaldía";
  if (/histórica de reportes/.test(r)) return "es zona con muchos reportes de falta de agua";
  if (/Poca lluvia/.test(r)) return "ha llovido poco";
  if (/vecino\(s\) reportan falta/.test(r)) return "algunos vecinos reportan falta de agua";
  return null;
}

/** ¿Hoy no hay agua por un corte o por reportes? */
const sinAgua = (res: Resultado, ctx: ReplyCtx) =>
  ctx.llegada?.tipo === "oficial" || ctx.llegada?.tipo === "estimado" || (res.puntaje?.c ?? 0) >= 3 || res.nivel === "rojo";

/** Línea de abasto (estado: corte / no hay / sin avisos / sin dato). */
export function abasto(res: Resultado, ctx: ReplyCtx): string {
  const e = EMOJI[res.nivel], l = ctx.llegada, c = res.puntaje?.c ?? 0, lugar = ctx.lugar;
  if (l?.tipo === "oficial") return `${e} En ${lugar} hay corte programado hasta el ${l.hasta.replace(/ (\d{2}:\d{2})$/, ", $1")} (faltan ${l.horas < 48 ? `≈${l.horas} h` : `≈${l.dias} días`}).`;
  if (l?.tipo === "estimado") {
    const r = l.min_dias === l.max_dias ? (l.min_dias === 0 ? "hoy" : `en ${l.min_dias} día(s)`) : `en ${l.min_dias}–${l.max_dias} días`;
    return `${e} ${ctx.llegadaDemo ? "[DEMO] " : ""}En ${lugar} hay un corte sin fecha de fin. ESTIMADO (no oficial): el agua podría regresar ${r}.`;
  }
  if (c >= 3) return `${e} En ${lugar} ${c} vecinos reportan que no les llega agua; no hay aviso oficial de corte.`;
  if (l?.tipo === "sin_dato" && /terminó/.test(l.nota)) return `${e} En ${lugar} el aviso oficial de corte ya terminó. Si sigues sin agua, repórtalo.`;
  if (res.nivel === "gris") return `${e} Aún no tengo avisos oficiales en tu zona (${lugar}). Te digo lo que sí sé:`;
  const r = res.nivel === "ambar" && !ctx.calidad ? res.razones.map(razonSimple).find(Boolean) : null; // si es por calidad, el aviso va en su línea
  return `${e} Tu zona (${lugar}) hoy sin avisos de corte${r ? `, pero ${r}` : ""}.`;
}

/** De dónde viene el agua y cómo sale de la planta (nunca de la llave). */
export function origenPlanta(ctx: ReplyCtx): string | null {
  const o = ctx.origen;
  if (!o) return null;
  const de = o.texto.replace(/^Viene (del|de) /, (_, a) => `${a} `);
  if (!o.planta) return `El agua viene ${de.replace(/ · .*/, "")}; no hay medición pública de su calidad.`;
  const p = ctx.planta;
  if (!p) return `El agua viene del Cutzamala; no tengo dato reciente de la planta.`;
  if (p.fuera_de_norma.length) {
    const qs = [...new Set(p.fuera_de_norma.map((x) => PARAM[x] ?? x))].join(", ");
    return `El agua viene del Cutzamala; en la planta ${o.planta} salió fuera de norma en ${qs} (${fechaCorta(p.fecha)}).`;
  }
  return `El agua viene del Cutzamala y sale bien de la planta ${o.planta} (${fechaCorta(p.fecha)}), pero no sabemos cómo llega a tu llave.`;
}

/** Aviso de calidad en palabras sencillas. */
function avisoCalidad(a: AvisoCalidad): string {
  if (a.origen === "demo") return `${a.texto.replace(/^\[DEMO\] Alerta de calidad: /, "[DEMO] Ojo: ")}. ${/hervir no/.test(a.recomendacion) ? "No la tomes ni cocines con ella; hervirla no lo quita." : "No la tomes sin hervirla."}`;
  if (a.origen === "prensa") return `Ojo: en las noticias reportaron agua turbia o con mal olor en tu zona (${fechaCorta(a.fuente?.fecha ?? "")}). Si sale así, no la tomes.`;
  if (a.origen === "vecinos") return `Ojo: ${a.texto.replace(/ vecinos reportan/, " vecinos reportan")}. Si sale así, no la tomes.`;
  return "Si sale turbia o huele raro, no la tomes.";
}

const TIP = {
  corte: "Tip: guarda agua en cubetas limpias y tapadas; cuando regrese, si sale turbia déjala correr.",
  tinaco: "Tip: lava tu tinaco cada 6 meses.",
  calidad: "Si sale turbia o huele raro, no la tomes y repórtala.",
};

export function accionDe(res: Resultado, ctx: ReplyCtx): Accion {
  if (sinAgua(res, ctx)) return "pipa";
  if (ctx.calidad || ctx.foco === "calidad") return "reporta_calidad";
  if (res.nivel === "gris") return "reportar";
  return "te_llega";
}
const ACCION: Record<Accion, string> = {
  pipa: "Pide pipa gratis al *426.",
  reporta_calidad: "Si sale turbia, responde REPORTAR.",
  reportar: "Si te falta agua, responde REPORTAR.",
  te_llega: "¿Te llega agua hoy? Responde SÍ o NO.",
  ninguna: "",
};

export function buildReply(res: Resultado, ctx: ReplyCtx): string {
  const foco = ctx.foco ?? "resumen";
  const demo = ctx.calidad?.es_demo || ctx.llegadaDemo;
  const f = (ctx.llegada?.tipo === "oficial" ? ctx.llegada.fuente : undefined) ?? ctx.calidad?.fuente
    ?? ((foco === "calidad" || res.nivel === "verde") && ctx.planta?.fuente ? ctx.planta.fuente : undefined) ?? res.fuentes[0];
  const fuente = demo ? "Fuente: caso de demostración" : f ? `Fuente: ${fuenteCorta(f)}` : "Fuente: sin dato";
  const cierre = `${ACCION[accionDe(res, ctx)]} ${fuente}`.trim();
  const origen = origenPlanta(ctx);
  const aviso = ctx.calidad ? avisoCalidad(ctx.calidad) : null;
  const e = EMOJI[res.nivel];
  let lines: (string | null)[];
  if (foco === "calidad") {
    const l1 = origen ? `${e} Sobre la calidad en ${ctx.lugar}: ${origen.charAt(0).toLowerCase()}${origen.slice(1)}` : `${e} Sobre la calidad en ${ctx.lugar}: no hay medición pública.`;
    lines = [l1, aviso ?? "No tengo reportes de agua turbia en tu zona.", aviso ? null : TIP.calidad, cierre];
  } else if (foco === "cuando") {
    const l = ctx.llegada;
    const l1 = l?.tipo === "oficial" || l?.tipo === "estimado" || (res.puntaje?.c ?? 0) >= 3 ? abasto(res, ctx)
      : res.nivel === "gris" ? `${e} Aún no tengo avisos oficiales de cuándo llega el agua en ${ctx.lugar}.`
      : `${e} En ${ctx.lugar} no hay aviso de corte, así que no hay una fecha que esperar.`;
    lines = [l1, sinAgua(res, ctx) ? TIP.corte : "Si hoy no te llega, avísame: así lo ve el gobierno en su panel.", aviso, cierre];
  } else {
    lines = [abasto(res, ctx), origen, aviso ?? (sinAgua(res, ctx) ? TIP.corte : TIP.tinaco), cierre];
  }
  return assertSafe(lines.filter(Boolean).slice(0, 4).join("\n"));
}

export function assertSafe(text: string): string {
  for (const re of PROHIBIDAS) if (re.test(text)) throw new Error("Texto prohibido: no afirmar potabilidad");
  return text;
}
