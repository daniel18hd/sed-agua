// Discrepancia entre lo que dicen los VECINOS (reportes por WhatsApp) y lo que dicen los DATOS OFICIALES. Función PURA.
// Herramienta de visibilidad para gobierno: nunca afirma causa ("hay una fuga"); solo describe la diferencia y cita fuentes.
// Umbrales = hipótesis de demo, configurables.
import type { Fuente, CategoriaSequia } from "./semaforo.ts";

export interface ZonaRef { cve_mun: string; cve_col?: string | null; lat: number; lon: number; nombre?: string }
export interface ReporteRef { uid: string; lat: number; lon: number; cve_col?: string | null; created_at: string; tipo: string }
export interface SenalesOficiales {
  corte?: { descripcion: string; fuente: Fuente } | null;                   // aviso oficial vigente
  sequia?: { categoria: CategoriaSequia; fuente: Fuente } | null;
  sistema?: { nombre: string; pct?: number; aplica: boolean; fuente: Fuente } | null; // Cutzamala (si la alcaldía depende de él)
}
export interface OpcionesDiscrepancia {
  ahora: string;
  ventanaMin?: number;       // ventana móvil (default 60)
  umbralPosible?: number;    // reportes únicos para "posible problema no reportado" (default 3)
  umbralAlerta?: number;     // reportes únicos para "requiere atención" (default 5)
  radioKm?: number;          // misma colonia o ≤ radio (default 1)
  pctSistemaNormal?: number; // Cutzamala ≥ este % = normal (default 50)
}

export type EstadoDiscrepancia = "sin_reportes" | "aislado" | "posible_problema" | "alerta" | "explicado";
export type EstadoOficial = "normal" | "corte" | "riesgo";

export interface Discrepancia {
  estado: EstadoDiscrepancia;
  severidad: number;              // 0–100
  razones: string[];
  n: number;                      // reportes únicos (1 por número) en la ventana
  n_colonia: number;
  primero?: string;
  ultimo?: string;
  oficial: EstadoOficial;
  discrepancia: boolean;          // oficial "normal" y ≥ umbral de posible problema
  fuentes: Fuente[];
  ventana_min: number;
  tipo_dominante?: string;
}

export const DEFAULTS = { ventanaMin: 60, umbralPosible: 3, umbralAlerta: 5, radioKm: 1, pctSistemaNormal: 50 } as const;

export const distKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dx = (a.lon - b.lon) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), dy = (a.lat - b.lat) * 110.57;
  return Math.hypot(dx, dy);
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false });
const QUE: Record<string, string> = { sin_agua: "falta de agua", baja_presion: "baja presión", mala_calidad: "agua turbia o con olor" };

export function estadoOficial(s: SenalesOficiales, pctNormal: number = DEFAULTS.pctSistemaNormal): { estado: EstadoOficial; motivos: string[]; fuentes: Fuente[] } {
  const fuentes: Fuente[] = [];
  if (s.corte) return { estado: "corte", motivos: [`corte oficial vigente (${s.corte.descripcion})`], fuentes: [s.corte.fuente] };
  const motivos: string[] = [];
  if (s.sequia) { fuentes.push(s.sequia.fuente); if (s.sequia.categoria && ["D2", "D3", "D4"].includes(s.sequia.categoria)) motivos.push(`sequía ${s.sequia.categoria}`); }
  if (s.sistema) { fuentes.push(s.sistema.fuente); if (s.sistema.aplica && s.sistema.pct != null && s.sistema.pct < pctNormal) motivos.push(`${s.sistema.nombre} al ${s.sistema.pct.toFixed(0)}%`); }
  return { estado: motivos.length ? "riesgo" : "normal", motivos, fuentes };
}

export function detectarDiscrepancia(zona: ZonaRef, reportes: ReporteRef[], oficial: SenalesOficiales, opt: OpcionesDiscrepancia): Discrepancia {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v != null)) } as Required<OpcionesDiscrepancia>;
  const ahora = Date.parse(o.ahora);
  const desde = ahora - o.ventanaMin * 60_000;
  // 1 reporte por número (el más reciente), dentro de la ventana y de la zona (misma colonia o ≤ radio)
  const porUid = new Map<string, ReporteRef & { mismaCol: boolean; d: number }>();
  for (const r of reportes) {
    const t = Date.parse(r.created_at);
    if (!(t >= desde && t <= ahora + 60_000)) continue;
    const d = distKm(zona, r);
    const mismaCol = !!zona.cve_col && r.cve_col === zona.cve_col;
    if (!mismaCol && d > o.radioKm) continue;
    const prev = porUid.get(r.uid);
    if (!prev || Date.parse(prev.created_at) < t) porUid.set(r.uid, { ...r, mismaCol, d });
  }
  const rs = [...porUid.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const n = rs.length;
  const of = estadoOficial(oficial, o.pctSistemaNormal);
  const base: Discrepancia = { estado: "sin_reportes", severidad: 0, razones: [], n, n_colonia: rs.filter((r) => r.mismaCol).length, oficial: of.estado, discrepancia: false, fuentes: of.fuentes, ventana_min: o.ventanaMin };
  if (!n) return base;

  const conteo = new Map<string, number>();
  for (const r of rs) conteo.set(r.tipo, (conteo.get(r.tipo) ?? 0) + 1);
  const tipo_dominante = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const que = QUE[tipo_dominante] ?? "problemas con el agua";
  const primero = rs[0].created_at, ultimo = rs[n - 1].created_at;
  const citas = of.fuentes.map((f) => `${f.nombre}, ${f.fecha}`).join("; ");

  const estado: EstadoDiscrepancia = of.estado === "corte" ? "explicado" : n >= o.umbralAlerta ? "alerta" : n >= o.umbralPosible ? "posible_problema" : "aislado";
  const razones: string[] = [];
  if (of.estado === "corte") razones.push(`Explicado por aviso oficial: ${of.motivos[0]} (${citas}) y ${n} reporte(s) de vecinos en ${o.ventanaMin} min`);
  else if (of.estado === "normal") razones.push(`Sistema normal según ${citas || "datos oficiales disponibles"} vs ${n} reporte(s) de vecinos (${que}) en ${o.ventanaMin} min`);
  else razones.push(`Datos oficiales ya muestran riesgo (${of.motivos.join(", ")}; ${citas}) y ${n} vecino(s) reportan ${que} en ${o.ventanaMin} min`);
  if (of.estado !== "corte") razones.push("Sin corte programado en avisos oficiales para esta zona");
  razones.push(`${base.n_colonia} en la colonia, ${n - base.n_colonia} a ≤${o.radioKm} km · primero ${hora(primero)}, último ${hora(ultimo)}`);
  if (estado === "posible_problema" || estado === "alerta")
    razones.unshift(of.estado === "normal" ? `Discrepancia: datos oficiales normales, vecinos reportan ${que}` : `Vecinos reportan ${que} en una zona con riesgo oficial`);

  // Severidad: número de reportes + cercanía + duración (no aplica si un aviso oficial lo explica)
  const durMin = (Date.parse(ultimo) - Date.parse(primero)) / 60_000;
  const dMedia = rs.reduce((s, r) => s + r.d, 0) / n;
  let sev = estado === "alerta" ? 60 : estado === "posible_problema" ? 35 : n * 8;
  sev += Math.min(15, Math.max(0, n - o.umbralPosible) * 3);
  sev += (1 - Math.min(1, dMedia / o.radioKm)) * 10;
  sev += Math.min(1, durMin / o.ventanaMin) * 15;
  if (estado === "explicado") sev = Math.min(20, n * 4);
  return {
    ...base, estado, razones, primero, ultimo, tipo_dominante,
    severidad: Math.round(Math.max(0, Math.min(100, sev))),
    discrepancia: of.estado === "normal" && (estado === "posible_problema" || estado === "alerta"),
  };
}

/** Clave de zona: la colonia del catálogo o una celda de ~1 km. */
export const zonaKey = (z: { cve_col?: string | null; cve_mun: string; lat: number; lon: number }) =>
  z.cve_col ? `col:${z.cve_col}` : `cel:${z.cve_mun}:${(Math.round(z.lat * 100) / 100).toFixed(2)},${(Math.round(z.lon * 100) / 100).toFixed(2)}`;
