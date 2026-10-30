// Semáforo hídrico Sed – función PURA. Sin I/O: recibe señales ya cargadas del brain/data y devuelve el nivel.
// Umbrales = hipótesis de demo (no son norma oficial). Ajustar con datos reales.

export type Nivel = "verde" | "ambar" | "rojo" | "gris";
export type Confianza = "alta" | "media" | "baja";
export type CategoriaSequia = null | "D0" | "D1" | "D2" | "D3" | "D4";

export interface Location { lat: number; lon: number; cve_mun: string; alcaldia?: string; colonia?: string }

export interface Fuente { nombre: string; fecha: string; url?: string }

export interface Signals {
  hoy: string;                                   // ISO date, p. ej. "2026-10-30"
  sequia?: { categoria: CategoriaSequia; fuente: Fuente };
  cutzamala?: { pct: number; aplica: boolean; fuente: Fuente };     // aplica = la alcaldía recibe Cutzamala
  lluvia?: { mm_7d: number; fuente: Fuente };
  vulnerabilidad?: {
    colonia_tandeo_2019?: boolean;
    pct_sin_agua_entubada?: number;              // INEGI 2020
    reportes_hist_sobre_p75?: boolean;           // SACMEX 2022-24
    fuentes: Fuente[];
  };
  reportes24h?: { sin_agua: number; calidad: number };   // reportes vecinales únicos por número (texto, sin fotos)
  corteOficial?: { vigente: boolean; descripcion: string; fuente: Fuente };
  calidadPlanta?: { fuera_de_norma: string[]; fuente: Fuente };     // Los Berros: salida de planta, NO grifo
}

export interface Resultado {
  nivel: Nivel;
  razones: string[];
  fuentes: Fuente[];
  confianza: Confianza;
  alerta_calidad: boolean;
  puntaje: { s1: number; s2: number; s3: number; s4: number; total: number; c: number };
}

const DIAS_VIGENCIA = 30;
const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const fresca = (f: Fuente | undefined, hoy: string) => !!f && !isNaN(Date.parse(f.fecha)) && dias(f.fecha, hoy) <= DIAS_VIGENCIA;

export function evaluate(location: Location, s: Signals): Resultado {
  const razones: string[] = [];
  const fuentes: Fuente[] = [];
  const mes = new Date(s.hoy + "T12:00:00").getMonth() + 1;

  // S1 sequía
  const s1 = s.sequia && fresca(s.sequia.fuente, s.hoy)
    ? ({ null: 0, D0: 1, D1: 2 } as Record<string, number>)[String(s.sequia.categoria)] ?? 3 : 0;
  if (s.sequia) { fuentes.push(s.sequia.fuente); razones.push(s.sequia.categoria ? `Sequía ${s.sequia.categoria}` : "Sin sequía en el Monitor"); }

  // S2 Cutzamala (solo si la alcaldía depende de él)
  let s2 = 0;
  if (s.cutzamala) {
    fuentes.push(s.cutzamala.fuente);
    const p = s.cutzamala.pct;
    if (s.cutzamala.aplica && fresca(s.cutzamala.fuente, s.hoy)) s2 = p >= 80 ? 0 : p >= 60 ? 1 : p >= 40 ? 2 : 3;
    razones.push(`Cutzamala al ${p.toFixed(1)}%${s.cutzamala.aplica ? "" : " (esta alcaldía depende sobre todo de fuentes locales)"}`);
  }

  // S3 lluvia en temporada (jun–oct)
  let s3 = 0;
  if (s.lluvia) {
    fuentes.push(s.lluvia.fuente);
    if (mes >= 6 && mes <= 10 && s.lluvia.mm_7d < 10) { s3 = 1; razones.push(`Poca lluvia en temporada (${s.lluvia.mm_7d} mm en 7 días)`); }
  }

  // S4 vulnerabilidad estructural (histórica: no caduca, pero se etiqueta)
  let s4 = 0;
  const v = s.vulnerabilidad;
  if (v) {
    fuentes.push(...v.fuentes);
    if (v.colonia_tandeo_2019) { s4++; razones.push("Colonia con tandeo (registro 2019)"); }
    if ((v.pct_sin_agua_entubada ?? 0) > 5) { s4++; razones.push(`${v.pct_sin_agua_entubada}% de viviendas sin agua entubada (INEGI 2020)`); }
    if (v.reportes_hist_sobre_p75) { s4++; razones.push("Alta tasa histórica de reportes por falta de agua (2022–24)"); }
  }

  // C reportes ciudadanos 24 h
  const r = s.reportes24h ?? { sin_agua: 0, calidad: 0 };
  const c = r.sin_agua;
  if (c > 0) razones.push(`${c} vecino(s) reportan falta de agua en 24 h`);

  const total = s1 + s2 + s3 + s4;
  const alerta_calidad = r.calidad >= 3 || (s.calidadPlanta?.fuera_de_norma.length ?? 0) > 0;
  if (s.calidadPlanta) fuentes.push(s.calidadPlanta.fuente);
  if (r.calidad >= 3) razones.push(`${r.calidad} vecinos reportan agua turbia o con olor`);
  if (s.calidadPlanta?.fuera_de_norma.length) razones.push(`Planta Los Berros fuera de norma en: ${s.calidadPlanta.fuera_de_norma.join(", ")}`);

  const corte = s.corteOficial?.vigente === true;
  if (s.corteOficial) { fuentes.push(s.corteOficial.fuente); if (corte) razones.unshift(`Corte oficial: ${s.corteOficial.descripcion}`); }

  const hayDatoFresco = [s.sequia?.fuente, s.cutzamala?.fuente, s.lluvia?.fuente].some((f) => fresca(f, s.hoy));

  let nivel: Nivel;
  if (corte) nivel = "rojo";
  else if (!hayDatoFresco && c === 0) nivel = "gris";
  else if (c >= 5 && (s1 + s2 >= 2 || c >= 15)) nivel = "rojo";
  else if (c >= 2 || total >= 3) nivel = "ambar";
  else nivel = "verde";
  if (alerta_calidad && (nivel === "verde" || nivel === "gris")) nivel = "ambar";
  if (nivel === "gris") razones.unshift("Datos desactualizados o insuficientes");

  const confianza: Confianza =
    corte || c >= 5 ? "alta" : hayDatoFresco && (c >= 1 || total > 0 || !!s.cutzamala) ? "media" : "baja";

  return { nivel, razones, fuentes: dedupe(fuentes), confianza, alerta_calidad, puntaje: { s1, s2, s3, s4, total, c } };
}

function dedupe(f: Fuente[]): Fuente[] {
  const seen = new Set<string>();
  return f.filter((x) => (seen.has(x.nombre + x.fecha) ? false : (seen.add(x.nombre + x.fecha), true)));
}
