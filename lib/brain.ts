// Brain en servidor: carga brain/data una sola vez (singleton) y expone locate / signalsFor / llegadaFor / calidadFor / evaluar.
// Las reglas viven en brain/rules (puras). Aquí solo se arman señales desde los JSON empaquetados. No se inventan datos.
import fs from "node:fs";
import path from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { evaluate, type Fuente, type Resultado, type Signals, type CategoriaSequia } from "@/brain/rules/semaforo.ts";
import { estimarLlegada, type Llegada, type LlegadaInput } from "@/brain/rules/llegada.ts";
import { avisoCalidad, type AvisoCalidad } from "@/brain/rules/calidad.ts";
import { buildReply } from "@/brain/rules/whatsapp.ts";
import { fechaCDMX, nowISO } from "@/lib/time";

// ---------- tipos de datos ----------
type Meta = { fuente: string; url: string | null; fecha_corte: string; verificado?: string };
type BBox = [number, number, number, number];
type Geom = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
interface AlcFeature { type: "Feature"; geometry: Geom; properties: { cve_mun: string; nombre: string; label_lat: number; label_lon: number; bbox: BBox } }
interface ColFeature { type: "Feature"; geometry: Geom; properties: { cve_col: string; colonia: string; cve_mun: string; alcaldia: string }; _bbox?: BBox; _c?: [number, number] }

export interface CasoDemo {
  id: string; cve_col: string | null; alcaldia: string; cve_mun: string; colonia_reportada: string; referencia: string | null;
  tipo: "reportado en prensa" | "inferido por base histórica"; categoria?: string; descripcion: string; fecha_nota: string;
  ventana_oficial?: { inicio: string; fin: string; horario: string }; fuentes: string[]; colonia_catalogo?: string;
  lat: number | null; lon: number | null; coord_tipo: string; frase: string; texto_whatsapp_demo: string; nota_fecha?: string;
}
export interface EscenarioDemo {
  id: string; es_demo: true; etiqueta: string; cve_col: string; colonia: string; alcaldia: string; por_que: string;
  alerta_calidad_demo?: { parametro: string; tipo: "quimico" | "microbiologico" };
  evento_sin_fin_demo?: { inicio: string; tipo: "fuga" | "obra" };
}
export interface Loc { lat: number; lon: number; cve_mun: string; alcaldia: string; cve_col?: string; colonia?: string }

const DATA_DIR = path.join(process.cwd(), "brain", "data");
const read = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")) as T;

interface BrainData {
  alcaldias: AlcFeature[];
  colonias: ColFeature[];
  sequia: { _meta: Meta; por_cve_mun: Record<string, { alcaldia: string; categoria: CategoriaSequia; historial_12m: { fecha: string; cat: CategoriaSequia }[] }> };
  cutzamala: { _meta: Meta; ultimo: Record<string, any> & { total_pct: number; fecha: string }; serie_mes: { fecha: string; total_pct: number }[] };
  berros: { _meta: Meta; ultimo: Record<string, any> & { parametros_fuera_de_norma: string[]; fecha: string }; limites_nom127: Record<string, [number | null, number | null]> };
  lluvia: { _meta: Meta; por_cve_mun: Record<string, { alcaldia: string; mm_7d: number; serie: Record<string, number> }> };
  inegi: { _meta: Meta; por_cve_mun: Record<string, { alcaldia: string; pct_sin_agua_entubada: number; vph_aguafv: number; pct_tinaco: number; pct_cisterna: number; tvivparhab: number }> };
  tandeo: { _meta: Meta; por_cve_mun: Record<string, { si: number; no: number; colonias_tandeo: string[]; pct_colonias_tandeo: number }> };
  tandeoSet: Record<string, Set<string>>;
  reportes: { _meta: Meta; p75_falta_por_1000_viviendas: number; por_cve_mun: Record<string, { falta_de_agua: number; mala_calidad: number; fuga: number; falta_por_1000_viviendas: number; sobre_p75: boolean; top_colonias_falta_agua: { colonia: string; n: number }[] }> };
  abast: { _meta: Meta; fuentes: Record<string, { t: string; url: string; fecha: string }>; por_cve_mun: Record<string, { alcaldia: string; cutzamala: boolean; sistemas: string[]; fuentes: string[] }> };
  demo: { _meta: { ahora_demo: { valor: string } }; casos: CasoDemo[]; escenarios_demo: EscenarioDemo[] };
}

let _data: BrainData | null = null;

/** "C T M El Risco" → "CTM El Risco" (siglas separadas en el catálogo) */
export const juntaSiglas = (s: string) => s.replace(/\b([A-Za-z])\s(?=[A-Za-z]\b)/g, "$1");
/** "Pedregal De Santa Ursula" → "Pedregal de Santa Ursula" (solo para mostrar) */
export const bonito = (s: string) =>
  juntaSiglas(s).replace(/(?<=\S\s)(De|Del|Y)(?=\s)/g, (w) => w.toLowerCase()).replace(/(?<=\sde\s)(La|Las|Los|El)(?=\s)/g, (w) => w.toLowerCase());
export const normaliza = (s: string) =>
  juntaSiglas(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const sinPrefijo = (s: string) => s.replace(/^(PUEBLO|BARRIO|COL|COLONIA|U H|UNIDAD HABITACIONAL|FRACC|FRACCIONAMIENTO)\s+/, "");

function bboxOf(coords: any): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === "number") { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }
    else for (const k of c) walk(k);
  };
  walk(coords);
  return [x0, y0, x1, y1];
}

export function data(): BrainData {
  if (_data) return _data;
  const alc = read<{ features: AlcFeature[] }>("alcaldias.simplified.geojson");
  const col = read<{ features: ColFeature[] }>("colonias.simplified.geojson");
  for (const f of col.features) {
    f._bbox = bboxOf(f.geometry.coordinates);
    f._c = [(f._bbox[0] + f._bbox[2]) / 2, (f._bbox[1] + f._bbox[3]) / 2];
  }
  const tandeo = read<BrainData["tandeo"]>("tandeo_2019_alcaldia.json");
  const tandeoSet: Record<string, Set<string>> = {};
  for (const [cve, v] of Object.entries(tandeo.por_cve_mun)) tandeoSet[cve] = new Set(v.colonias_tandeo.map((n) => sinPrefijo(normaliza(n))));
  _data = {
    alcaldias: alc.features,
    colonias: col.features,
    sequia: read("sequia_alcaldias.json"),
    cutzamala: read("cutzamala_latest.json"),
    berros: read("calidad_los_berros.json"),
    lluvia: read("lluvia_7d_alcaldia.json"),
    inegi: read("vulnerabilidad_inegi_alcaldia.json"),
    tandeo,
    tandeoSet,
    reportes: read("reportes_historicos_alcaldia.json"),
    abast: read("abastecimiento_alcaldia.json"),
    demo: read("demo-cases.json"),
  };
  return _data;
}

// ---------- fuentes ----------
const F = (nombre: string, m: Meta): Fuente => ({ nombre, fecha: m.fecha_corte, url: m.url ?? undefined });
export const fuentes = () => {
  const d = data();
  return {
    sequia: F("Monitor de Sequía SMN", d.sequia._meta),
    cutzamala: F("CONAGUA Cutzamala", d.cutzamala._meta),
    berros: F("CONAGUA Los Berros (salida de planta)", d.berros._meta),
    lluvia: F("Open-Meteo (modelo)", d.lluvia._meta),
    inegi: F("INEGI Censo 2020", d.inegi._meta),
    tandeo: F("SACMEX tandeo 2019", d.tandeo._meta),
    reportes: F("SACMEX reportes 2022–24", d.reportes._meta),
    abast: F("Abastecimiento (prensa, POR VALIDAR)", d.abast._meta),
  };
};

const MEDIOS: [RegExp, string][] = [
  [/adn40/, "adn40"], [/reforma\.com/, "Reforma"], [/nmas\.com/, "N+"], [/heraldodemexico/, "El Heraldo"], [/informador/, "El Informador"],
  [/cronica\.com/, "Crónica"], [/excelsior/, "Excélsior"], [/milenio/, "Milenio"], [/ambito/, "Ámbito"], [/datos\.cdmx/, "Datos CDMX"],
];
export const medio = (url: string) => MEDIOS.find(([re]) => re.test(url))?.[1] ?? new URL(url).hostname.replace(/^www\./, "");

// ---------- locate ----------
const inBBox = (b: BBox, lon: number, lat: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
const pip = (lon: number, lat: number, g: Geom) => booleanPointInPolygon([lon, lat], g as any);

export function locate(lat: number, lon: number): Loc | null {
  const d = data();
  const alc = d.alcaldias.find((a) => inBBox(a.properties.bbox, lon, lat) && pip(lon, lat, a.geometry));
  if (!alc) return null;
  const { cve_mun, nombre } = alc.properties;
  const cands = d.colonias.filter((c) => c.properties.cve_mun === cve_mun);
  let col = cands.find((c) => inBBox(c._bbox!, lon, lat) && pip(lon, lat, c.geometry));
  if (!col) {
    // huecos por simplificación: colonia más cercana (centro de bbox) a < ~600 m
    let best: ColFeature | undefined, bd = Infinity;
    for (const c of cands) { const dd = (c._c![0] - lon) ** 2 + (c._c![1] - lat) ** 2; if (dd < bd) { bd = dd; best = c; } }
    if (best && Math.sqrt(bd) < 0.006) col = best;
  }
  return { lat, lon, cve_mun, alcaldia: nombre, cve_col: col?.properties.cve_col, colonia: col && bonito(col.properties.colonia) };
}

/**
 * Geocodificación local por nombre de colonia del catálogo (sin red).
 * fuerza "alta" = colonia + alcaldía en el texto, o colonia con nombre único en CDMX; "baja" = solo alcaldía (centro de etiqueta).
 */
export function colonyByName(texto: string): (Loc & { fuerza: "alta" | "baja" }) | null {
  const d = data();
  const t = ` ${normaliza(texto)} `;
  const alc = d.alcaldias.find((a) => t.includes(` ${normaliza(a.properties.nombre)} `))
    ?? d.alcaldias.find((a) => { const n = normaliza(a.properties.nombre); return n.split(" ").length > 1 && t.includes(` ${n.split(" ").slice(-1)[0]} `) && n !== "BENITO JUAREZ"; })
    ?? (/ (GAM|G A M) /.test(t) ? d.alcaldias.find((a) => a.properties.cve_mun === "005") : /\bBJ\b| BENITO JUAREZ /.test(t) ? d.alcaldias.find((a) => a.properties.cve_mun === "014") : undefined);
  let matches: ColFeature[] = [];
  let bestLen = 0;
  for (const c of d.colonias) {
    if (alc && c.properties.cve_mun !== alc.properties.cve_mun) continue;
    const n = normaliza(c.properties.colonia);
    if (n.length < 4 || !t.includes(` ${n} `)) continue;
    if (n.length > bestLen) { bestLen = n.length; matches = [c]; }
    else if (n.length === bestLen) matches.push(c);
  }
  if (matches.length === 1 || (matches.length > 1 && alc)) {
    const best = matches[0];
    const [lon, lat] = best._c!;
    const loc = locate(lat, lon);
    const base = loc && loc.cve_col === best.properties.cve_col ? loc
      : { lat, lon, cve_mun: best.properties.cve_mun, alcaldia: best.properties.alcaldia, cve_col: best.properties.cve_col, colonia: best.properties.colonia };
    return { ...base, fuerza: "alta" };
  }
  if (!alc) return null;
  const { label_lat, label_lon } = alc.properties;
  return { lat: label_lat, lon: label_lon, cve_mun: alc.properties.cve_mun, alcaldia: alc.properties.nombre, fuerza: "baja" };
}

// ---------- demo cases ----------
export const demoActivo = (opt?: { demo?: boolean }) => !!opt?.demo || process.env.DEMO_SCENARIOS === "1";
export const casoPorColonia = (cve_col?: string) => (cve_col ? data().demo.casos.find((c) => c.cve_col === cve_col) : undefined);
export const escenariosPorColonia = (cve_col?: string) => (cve_col ? data().demo.escenarios_demo.filter((e) => e.cve_col === cve_col) : []);

function avisoOficialPara(loc: Loc, ahora: string) {
  const caso = casoPorColonia(loc.cve_col);
  if (!caso?.ventana_oficial) return undefined;
  const v = caso.ventana_oficial;
  return {
    caso,
    fin: v.fin,
    vigente: Date.parse(ahora) >= Date.parse(caso.fecha_nota + "T00:00-06:00") && Date.parse(ahora) < Date.parse(v.fin),
    descripcion: `obra ${v.horario.replace(/(\d{2}:\d{2})-(\d{2}:\d{2})/, "$1–$2")}`,
    fuente: { nombre: `SEGIAGUA vía ${medio(caso.fuentes[0])}`, fecha: caso.fecha_nota, url: caso.fuentes[0] } as Fuente,
  };
}

// ---------- signals ----------
export interface Reportes24h { sin_agua: number; calidad: number }

export function signalsFor(loc: Loc, now: string, reportes24h: Reportes24h = { sin_agua: 0, calidad: 0 }, corteOficial?: Signals["corteOficial"]): Signals {
  const d = data();
  const fz = fuentes();
  const cve = loc.cve_mun;
  const s: Signals = { hoy: fechaCDMX(now), reportes24h };

  const seq = d.sequia.por_cve_mun[cve];
  if (seq) s.sequia = { categoria: seq.categoria ?? null, fuente: fz.sequia };

  const aplica = !!d.abast.por_cve_mun[cve]?.cutzamala;
  s.cutzamala = { pct: d.cutzamala.ultimo.total_pct, aplica, fuente: fz.cutzamala };

  const ll = d.lluvia.por_cve_mun[cve];
  if (ll) s.lluvia = { mm_7d: ll.mm_7d, fuente: fz.lluvia };

  const ine = d.inegi.por_cve_mun[cve];
  const rep = d.reportes.por_cve_mun[cve];
  const tset = d.tandeoSet[cve];
  const colTandeo = !!(loc.colonia && tset && tset.has(sinPrefijo(normaliza(loc.colonia))));
  s.vulnerabilidad = {
    colonia_tandeo_2019: colTandeo,
    pct_sin_agua_entubada: ine?.pct_sin_agua_entubada,
    reportes_hist_sobre_p75: rep?.sobre_p75 ?? false,
    fuentes: [fz.inegi, fz.tandeo, fz.reportes],
  };

  if (aplica) s.calidadPlanta = { fuera_de_norma: d.berros.ultimo.parametros_fuera_de_norma ?? [], fuente: fz.berros };

  if (corteOficial) s.corteOficial = corteOficial;
  else {
    const av = avisoOficialPara(loc, now);
    if (av?.vigente) s.corteOficial = { vigente: true, descripcion: av.descripcion, fuente: av.fuente };
  }
  return s;
}

export function llegadaFor(loc: Loc, now: string, opt?: { demo?: boolean }): { llegada: Llegada; demo: boolean } {
  const input: LlegadaInput = { ahora: now };
  const av = avisoOficialPara(loc, now);
  if (av) input.avisoOficial = { fin: av.fin, descripcion: av.descripcion, fuente: av.fuente };
  let demo = false;
  if (!av && demoActivo(opt)) {
    const esc = escenariosPorColonia(loc.cve_col).find((e) => e.evento_sin_fin_demo);
    if (esc?.evento_sin_fin_demo) {
      input.eventoSinFin = { ...esc.evento_sin_fin_demo, fuente: { nombre: "caso de demostración", fecha: esc.evento_sin_fin_demo.inicio.slice(0, 10) } };
      demo = true;
    }
  }
  const tset = data().tandeoSet[loc.cve_mun];
  input.tandeo2019 = !!(loc.colonia && tset?.has(sinPrefijo(normaliza(loc.colonia))));
  return { llegada: estimarLlegada(input), demo };
}

export function calidadFor(loc: Loc, s: Signals, opt?: { demo?: boolean }): AvisoCalidad | null {
  const esc = demoActivo(opt) ? escenariosPorColonia(loc.cve_col).find((e) => e.alerta_calidad_demo) : undefined;
  return avisoCalidad({
    planta: s.calidadPlanta,
    reportesCalidad24h: s.reportes24h?.calidad,
    demo: esc?.alerta_calidad_demo ? { ...esc.alerta_calidad_demo, etiqueta: "caso de demostración" } : undefined,
  });
}

// ---------- evaluación completa ----------
export interface CasoInfo { id: string; tipo: CasoDemo["tipo"]; frase: string; descripcion: string; fuentes: { medio: string; url: string }[]; fecha: string; nota_fecha?: string }
export interface Evaluacion {
  ahora: string;
  loc: Loc;
  signals: Signals;
  resultado: Resultado;
  llegada: Llegada;
  llegada_demo: boolean;
  calidad: AvisoCalidad | null;
  reply: string;
  caso?: CasoInfo;
  escenarios?: { id: string; etiqueta: string; por_que: string }[];
}

export function evaluar(loc: Loc, opt: { now?: string; reportes24h?: Reportes24h; demo?: boolean; casoId?: string } = {}): Evaluacion {
  const ahora = opt.now ?? nowISO();
  const signals = signalsFor(loc, ahora, opt.reportes24h);
  const resultado = evaluate(loc, signals);
  const { llegada, demo: llegada_demo } = llegadaFor(loc, ahora, opt);
  const calidad = calidadFor(loc, signals, opt);
  // PRD §10: "ÁMBAR … o alerta de calidad". evaluate() no conoce el aviso demo → lo aplicamos aquí con la misma regla.
  if (calidad && !resultado.alerta_calidad) {
    resultado.alerta_calidad = true;
    if (resultado.nivel === "verde" || resultado.nivel === "gris") resultado.nivel = "ambar";
    resultado.razones.push(calidad.es_demo ? "[DEMO] Alerta de calidad (caso de demostración)" : calidad.texto);
  }
  // Escenario demo "fuga sin fecha fin": es un corte anunciado (demo) → al menos ÁMBAR, nunca ROJO (no es un aviso oficial real).
  if (llegada_demo) {
    if (resultado.nivel === "verde" || resultado.nivel === "gris") resultado.nivel = "ambar";
    resultado.razones.unshift("[DEMO] Corte por fuga sin fecha de fin");
  }
  const lugar = [loc.colonia, abreviaAlcaldia(loc.alcaldia)].filter(Boolean).join(", ");
  const reply = buildReply(resultado, { lugar, llegada, calidad, llegadaDemo: llegada_demo });
  const c = (opt.casoId && data().demo.casos.find((x) => x.id === opt.casoId)) || casoPorColonia(loc.cve_col);
  const esc = demoActivo(opt) ? escenariosPorColonia(loc.cve_col) : [];
  return {
    ahora, loc, signals, resultado, llegada, llegada_demo, calidad, reply,
    caso: c && { id: c.id, tipo: c.tipo, frase: c.frase, descripcion: c.descripcion, fecha: c.fecha_nota, nota_fecha: c.nota_fecha, fuentes: c.fuentes.map((u) => ({ medio: medio(u), url: u })) },
    escenarios: esc.length ? esc.map((e) => ({ id: e.id, etiqueta: e.etiqueta, por_que: e.por_que })) : undefined,
  };
}

const ABREV: Record<string, string> = { "Gustavo A. Madero": "GAM", "Benito Juárez": "BJ", "Cuajimalpa de Morelos": "Cuajimalpa", "La Magdalena Contreras": "Magdalena Contreras" };
export const abreviaAlcaldia = (a: string) => ABREV[a] ?? a;

// ---------- resumen para el OS (cacheable) ----------
export function summary() {
  const d = data();
  const fz = fuentes();
  const alcaldias: Record<string, unknown> = {};
  for (const a of d.alcaldias) {
    const cve = a.properties.cve_mun;
    const ab = d.abast.por_cve_mun[cve];
    alcaldias[cve] = {
      nombre: a.properties.nombre,
      sequia: d.sequia.por_cve_mun[cve]?.categoria ?? null,
      lluvia_mm_7d: d.lluvia.por_cve_mun[cve]?.mm_7d ?? null,
      inegi: d.inegi.por_cve_mun[cve] ? { pct_sin_agua_entubada: d.inegi.por_cve_mun[cve].pct_sin_agua_entubada, viviendas_sin_agua: d.inegi.por_cve_mun[cve].vph_aguafv } : null,
      tandeo_2019: d.tandeo.por_cve_mun[cve] ? { colonias: d.tandeo.por_cve_mun[cve].si, pct: d.tandeo.por_cve_mun[cve].pct_colonias_tandeo } : null,
      reportes_hist: d.reportes.por_cve_mun[cve]
        ? { falta_de_agua: d.reportes.por_cve_mun[cve].falta_de_agua, mala_calidad: d.reportes.por_cve_mun[cve].mala_calidad, por_1000: d.reportes.por_cve_mun[cve].falta_por_1000_viviendas, sobre_p75: d.reportes.por_cve_mun[cve].sobre_p75 }
        : null,
      abastecimiento: ab ? { cutzamala: ab.cutzamala, sistemas: ab.sistemas, fuentes: ab.fuentes.map((k) => d.abast.fuentes[k]).filter(Boolean) } : null,
    };
  }
  const u = d.cutzamala.ultimo;
  return {
    fuentes: fz,
    p75_reportes: d.reportes.p75_falta_por_1000_viviendas,
    cutzamala: {
      total_pct: u.total_pct, fecha: u.fecha,
      presas: [
        { nombre: "Villa Victoria", pct: u.villa_victoria?.pct },
        { nombre: "Valle de Bravo", pct: u.valle_de_bravo?.pct },
        { nombre: "El Bosque", pct: u.el_bosque?.pct },
      ],
      serie: d.cutzamala.serie_mes,
    },
    berros: { fecha: d.berros.ultimo.fecha, fuera_de_norma: d.berros.ultimo.parametros_fuera_de_norma, ultimo: d.berros.ultimo },
    alcaldias,
  };
}
export type Summary = ReturnType<typeof summary>;
