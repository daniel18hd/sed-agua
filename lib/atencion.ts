// Panel de atención: registra reportes, cruza con datos oficiales (detectarDiscrepancia) y mantiene "casos que requieren atención".
// Nunca afirma causa. El estado de atención (nuevo → en revisión → atendido) lo cambia el funcionario desde el OS y queda en el historial.
import crypto from "node:crypto";
import { detectarDiscrepancia, zonaKey, type SenalesOficiales, type Discrepancia } from "@/brain/rules/discrepancia.ts";
import { signalsFor, data, type Loc } from "@/lib/brain";
import {
  insertReporte, reportesCerca, marcarAvisados, casoActivo, guardarCaso, listarCasos, getCaso, reportesPublicosDesde,
  type CasoAtencion, type Atencion, type TipoReporte,
} from "@/lib/store";
const nowISO = () => new Date().toISOString(); // reloj REAL: las ventanas de reportes no usan DEMO_NOW

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const CONFIG = {
  ventanaMin: num(process.env.DISCREPANCIA_VENTANA_MIN, 60),
  umbralPosible: num(process.env.DISCREPANCIA_UMBRAL_POSIBLE, 3),
  umbralAlerta: num(process.env.DISCREPANCIA_UMBRAL_ALERTA, 5),
  radioKm: num(process.env.DISCREPANCIA_RADIO_KM, 1),
};
const TIPOS = ["sin_agua", "baja_presion", "mala_calidad"];
const RANK: Record<string, number> = { sin_reportes: 0, aislado: 1, explicado: 1, posible_problema: 2, alerta: 3 };

export const AVISO_ALERTA = "Ya hay varios reportes en tu zona; lo enviamos al panel de atención. Gracias por avisar 🙌";

/** Folio corto para el ciudadano: SED-1234. */
export const folioDe = (id: string) => `SED-${(parseInt(crypto.createHash("sha256").update(id).digest("hex").slice(0, 8), 16) % 9000 + 1000)}`;

/** Señales oficiales de la zona (las mismas que usa el semáforo). DEMO_NOW fija el "hoy" de los avisos en la demo. */
export function oficialPara(loc: Loc): SenalesOficiales {
  const s = signalsFor(loc, process.env.DEMO_NOW || nowISO());
  return {
    corte: s.corteOficial?.vigente ? { descripcion: s.corteOficial.descripcion, fuente: s.corteOficial.fuente } : null,
    sequia: s.sequia ? { categoria: s.sequia.categoria, fuente: s.sequia.fuente } : null,
    sistema: s.cutzamala ? { nombre: "Cutzamala", pct: s.cutzamala.pct, aplica: s.cutzamala.aplica, fuente: s.cutzamala.fuente } : null,
  };
}

export interface ResultadoZona { disc: Discrepancia; caso: CasoAtencion | null; escalo: boolean; avisos: { to: string; body: string }[] }

/** Recalcula la discrepancia de la zona de `loc`, crea/actualiza el caso y prepara los avisos (máx. 1 por persona). */
export async function evaluarZona(loc: Loc, o: { demo?: boolean } = {}): Promise<ResultadoZona> {
  const ahora = nowISO();
  const desde = new Date(Date.now() - CONFIG.ventanaMin * 60_000).toISOString();
  const rows = (await reportesCerca(loc, desde)).filter((r) => TIPOS.includes(r.tipo));
  const disc = detectarDiscrepancia(
    { cve_mun: loc.cve_mun, cve_col: loc.cve_col, lat: loc.lat, lon: loc.lon },
    rows.map((r) => ({ uid: r.phone_hash, lat: r.lat, lon: r.lon, cve_col: r.cve_col, created_at: r.created_at, tipo: r.tipo })),
    oficialPara(loc),
    { ahora, ...CONFIG },
  );
  const key = zonaKey(loc);
  let caso = await casoActivo(key);
  const prev = caso?.estado ?? "sin_reportes";
  let escalo = false;
  if (disc.n >= CONFIG.umbralPosible || caso) {
    const enZona = rows.filter((r) => (loc.cve_col && r.cve_col === loc.cve_col) || Math.hypot((r.lat - loc.lat) * 110.57, (r.lon - loc.lon) * 105) <= CONFIG.radioKm);
    const lat = enZona.length ? enZona.reduce((s, r) => s + r.lat, 0) / enZona.length : loc.lat;
    const lon = enZona.length ? enZona.reduce((s, r) => s + r.lon, 0) / enZona.length : loc.lon;
    const cambio = prev !== disc.estado;
    caso = await guardarCaso({
      zona_key: key, cve_mun: loc.cve_mun, alcaldia: loc.alcaldia, cve_col: loc.cve_col ?? null, colonia: loc.colonia ?? null,
      lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000,
      estado: disc.estado, severidad: disc.severidad, n: disc.n, ventana_min: disc.ventana_min, primero: disc.primero ?? null, ultimo: disc.ultimo ?? null,
      razones: disc.razones, fuentes: disc.fuentes, oficial: disc.oficial, discrepancia: disc.discrepancia,
      demo: (caso?.demo ?? false) || (!!o.demo && enZona.every((r) => r.demo)),
      historial: cambio ? [...(caso?.historial ?? []), { at: ahora, estado: disc.estado }] : caso?.historial ?? [],
    }, caso?.id);
    escalo = (RANK[disc.estado] ?? 0) > (RANK[prev] ?? 0) && RANK[disc.estado] >= 2;
  }
  // Aviso a quienes reportaron cuando la zona entra al panel (≥ posible problema). Máx. 1 por persona; no promete fecha.
  const avisos: { to: string; body: string }[] = [];
  if (caso && RANK[disc.estado] >= 2) {
    const ya = new Set(rows.filter((r) => r.avisado).map((r) => r.phone_hash));
    const ids: string[] = [];
    for (const r of rows) {
      if (r.avisado || !r.contacto || ya.has(r.phone_hash)) continue;
      ya.add(r.phone_hash);
      ids.push(...rows.filter((x) => x.phone_hash === r.phone_hash).map((x) => x.id));
      avisos.push({ to: r.contacto, body: AVISO_ALERTA });
    }
    await marcarAvisados(ids);
  }
  return { disc, caso, escalo, avisos };
}

export async function registrarReporte(i: { phone_hash: string; contacto?: string | null; tipo: TipoReporte; loc: Loc; demo?: boolean }) {
  const id = crypto.randomUUID();
  const folio = folioDe(id + i.phone_hash);
  const reporte = await insertReporte({
    phone_hash: i.phone_hash, tipo: i.tipo, lat: i.loc.lat, lon: i.loc.lon, cve_mun: i.loc.cve_mun, cve_col: i.loc.cve_col ?? null,
    alcaldia: i.loc.alcaldia, colonia: i.loc.colonia ?? null, folio, contacto: i.contacto ?? null, avisado: false, demo: !!i.demo,
  });
  const zona = await evaluarZona(i.loc, { demo: i.demo });
  return { folio, reporte, ...zona };
}

/** Archiva casos sin reportes nuevos en la ventana (el contorno regresa al semáforo; el historial se conserva). */
export async function barrer(): Promise<number> {
  const casos = await listarCasos(new Date(Date.now() - 86_400_000).toISOString());
  const limite = Date.now() - CONFIG.ventanaMin * 60_000;
  let n = 0;
  for (const c of casos) {
    if (c.archivado || !c.ultimo || Date.parse(c.ultimo) >= limite) continue;
    const at = nowISO();
    await guardarCaso({ zona_key: c.zona_key, archivado: true, archivado_at: at, archivado_motivo: `sin reportes nuevos en ${CONFIG.ventanaMin} min`, historial: [...c.historial, { at, nota: "archivado: volvió a normal" }] }, c.id);
    n++;
  }
  return n;
}

const SIGUIENTE: Record<Atencion, Atencion[]> = { nuevo: ["en_revision", "atendido"], en_revision: ["atendido", "nuevo"], atendido: [] };
export async function cambiarAtencion(id: string, atencion: Atencion, nota?: string): Promise<CasoAtencion | { error: string }> {
  const c = await getCaso(id);
  if (!c) return { error: "caso no encontrado" };
  if (!SIGUIENTE[c.atencion]?.includes(atencion)) return { error: `transición no permitida: ${c.atencion} → ${atencion}` };
  const at = nowISO();
  const patch: Partial<CasoAtencion> & { zona_key: string } = { zona_key: c.zona_key, atencion, historial: [...c.historial, { at, atencion, nota }] };
  if (atencion === "atendido") Object.assign(patch, { atendido_at: at, archivado: true, archivado_at: at, archivado_motivo: "marcado atendido" });
  return guardarCaso(patch, id);
}

export async function panel() {
  await barrer();
  const casos = await listarCasos(new Date(Date.now() - 86_400_000).toISOString());
  const desde = new Date(Date.now() - CONFIG.ventanaMin * 60_000).toISOString();
  const reportes = await reportesPublicosDesde(desde);
  const atendidos = casos.filter((c) => c.atendido_at);
  const promedio = atendidos.length ? atendidos.reduce((s, c) => s + (Date.parse(c.atendido_at!) - Date.parse(c.created_at)), 0) / atendidos.length / 60_000 : null;
  return {
    config: CONFIG,
    casos,
    reportes,
    stats: {
      reportes_activos: reportes.length,
      zonas_discrepancia: casos.filter((c) => !c.archivado && (c.estado === "posible_problema" || c.estado === "alerta")).length,
      promedio_atencion_min: promedio == null ? null : Math.round(promedio * 10) / 10,
    },
  };
}

/** Colonia de la demo de discrepancias (estado oficial normal: sin corte, Cutzamala alto, sin sequía). */
export function zonaDemo(): Loc {
  const f = data().colonias.find((c) => c.properties.cve_col === "006-001")!;
  const [lon, lat] = f._c!;
  return { lat, lon, cve_mun: "006", alcaldia: f.properties.alcaldia, cve_col: "006-001", colonia: "Agricola Oriental" };
}
