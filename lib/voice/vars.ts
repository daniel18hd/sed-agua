import { RECOMENDACION_ROJO_CORTA } from "@/brain/rules/calidad.ts";
// Variables dinámicas para el agente de voz de ElevenLabs ([Sed] Alerta de agua). Todas son strings.
// Se arman SOLO desde la evaluación calculada; nunca afirman potabilidad (assertSafe).
import { assertSafe } from "@/brain/rules/whatsapp.ts";
import type { Evaluacion } from "@/lib/brain";

export interface VoiceVars {
  nombre: string;
  colonia: string;
  alcaldia: string;
  nivel: "rojo" | "ambar";
  motivo: "corte programado" | "fuga" | "sin dato" | "alerta de calidad";
  dias_estimados: string;
  tipo_dias: "oficial" | "estimado" | "sin_dato";
  fuente: string;
  fecha_fuente: string;
  aviso_calidad: string;
  es_demo: "true" | "false";
  recomendacion_casa: string; // zonas en rojo: precaución en casa (RECOMENDACION_ROJO_CORTA)
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const TZ = "America/Mexico_City";

/** "2026-10-27" → "27 de octubre" */
export function fechaHablada(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]}` : ymd;
}

/** ISO con zona → "el viernes 30 de octubre a las 12 del día" (hora de CDMX) */
export function momentoHablado(iso: string): string {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const h = Number(p.hour) % 24, min = Number(p.minute);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const franja = h === 12 ? "del día" : h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";
  const hora = `a las ${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${franja}`;
  return `el ${DIAS[wd]} ${Number(p.day)} de ${MESES[Number(p.month) - 1]} ${hora}`;
}

/** Crítico = semáforo rojo, o corte programado vigente, o alerta de calidad (incluye [DEMO] y nota de prensa). */
export function isCritical(e: Pick<Evaluacion, "resultado" | "signals" | "calidad">): boolean {
  return e.resultado.nivel === "rojo" || e.signals.corteOficial?.vigente === true || !!e.calidad;
}

export function buildVoiceVars(e: Evaluacion, o: { nombre?: string; demo?: boolean } = {}): VoiceVars {
  const ll = e.llegada;
  const corte = e.signals.corteOficial?.vigente === true;
  const motivo: VoiceVars["motivo"] = corte ? "corte programado" : e.calidad ? "alerta de calidad" : ll.tipo === "estimado" ? "fuga" : "sin dato";

  let dias_estimados = "";
  if (ll.tipo === "oficial") {
    const hasta = e.aviso_fin ? `, hasta ${momentoHablado(e.aviso_fin).replace(/^el /, "el ")}` : `, hasta el ${ll.hasta}`;
    dias_estimados = ll.horas < 48 ? `unas ${ll.horas} horas${hasta}` : `unos ${ll.dias} días${hasta}`;
  } else if (ll.tipo === "estimado") {
    dias_estimados = ll.min_dias === ll.max_dias ? `${ll.min_dias} días` : `${ll.min_dias} a ${ll.max_dias} días`;
  }

  const esDemo = !!(o.demo || e.calidad?.es_demo || e.llegada_demo);
  let fuente = "Sed";
  let fecha_fuente = "hoy";
  if (e.calidad?.es_demo || (e.llegada_demo && !corte)) {
    fuente = "escenario de demostración de Sed (no es un dato real)";
  } else if (ll.tipo === "oficial") {
    const medio = ll.fuente.nombre.replace(/^SEGIAGUA vía /, "");
    fuente = ll.fuente.nombre.startsWith("SEGIAGUA vía") ? `SEGIAGUA, aviso difundido por ${medio}` : ll.fuente.nombre;
    fecha_fuente = fechaHablada(ll.fuente.fecha);
  } else if (e.calidad?.fuente) {
    fuente = e.calidad.origen === "prensa" ? `nota de prensa de ${e.calidad.fuente.nombre}` : e.calidad.fuente.nombre;
    fecha_fuente = fechaHablada(e.calidad.fuente.fecha);
  } else if (e.resultado.fuentes[0]) {
    fuente = e.resultado.fuentes[0].nombre;
    fecha_fuente = fechaHablada(e.resultado.fuentes[0].fecha);
  }

  let aviso_calidad = "";
  if (e.calidad) {
    aviso_calidad = e.calidad.texto.replace(/^\[DEMO\] Alerta de calidad: /, "").replace(/\(olor a huevo\)/, ", olor a huevo");
    if (e.calidad.es_demo) aviso_calidad += "; caso de demostración";
  }

  const v: VoiceVars = {
    nombre: o.nombre ?? "",
    colonia: e.loc.colonia ?? "tu colonia",
    alcaldia: e.loc.alcaldia,
    nivel: e.resultado.nivel === "rojo" ? "rojo" : "ambar",
    motivo,
    dias_estimados,
    tipo_dias: ll.tipo,
    fuente,
    fecha_fuente,
    aviso_calidad,
    recomendacion_casa: e.resultado.nivel === "rojo" ? RECOMENDACION_ROJO_CORTA : "",
    es_demo: esDemo ? "true" : "false",
  };
  assertSafe(JSON.stringify(v));
  return v;
}
