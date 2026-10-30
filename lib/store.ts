// Persistencia + bus. Con Supabase (service role) escribe en Postgres y el OS escucha Realtime.
// Sin Supabase: todo en memoria (globalThis, sobrevive HMR) y el OS escucha /api/stream (SSE). La app SIEMPRE arranca.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import type { ConsultaPublica } from "@/lib/types";
import { redondea } from "@/lib/types";
import type { Evaluacion, Loc, Reportes24h } from "@/lib/brain";

export type { TipoReporte } from "@/lib/intent";
import type { TipoReporte } from "@/lib/intent";
export type EstadoSesion = "idle" | "esperando_direccion" | "esperando_tipo_reporte";
export interface VozEstado {
  pending?: { to: string; vars: import("@/lib/voice/vars").VoiceVars; exp: number; consulta_id?: string } | null; // oferta "¿Te llamo?" (10 min)
  declined_at?: number | null; // "NO": no se vuelve a ofrecer en 24 h
  opt_out?: boolean;           // "NO LLAMES": nunca
  last_inbound_at?: number;
}
/** Lo último que el bot preguntó: "sí"/"no"/"1"/"2" responden a esto. */
export interface Pregunta {
  tipo: "llamada" | "confirmar_reporte" | "opciones" | "tipo_reporte" | "nueva_direccion" | "te_llega" | "misma_zona" | "elegir_colonia";
  tipo_reporte?: TipoReporte; at: number;
  opciones?: { lat: number; lon: number; nombre: string }[]; // elegir_colonia
  intent?: string;                                            // misma_zona: qué quería hacer
}
/** Memoria por número (jsonb sesiones.ctx): última ubicación y resultado, qué se preguntó, reporte en curso. */
export interface SesionCtx {
  lat?: number; lon?: number; cve_mun?: string; cve_col?: string | null;
  lugar?: string; nivel?: string; consulta_id?: string; consulta_texto?: string | null; ultimo_reply?: string; at?: number;
  pregunta?: Pregunta | null;
  reporte_pendiente?: TipoReporte | "menu" | null; // pidió REPORTAR sin ubicación → al llegar la dirección se retoma
  hist?: { r: "u" | "b"; t: string }[];             // últimos ~10 turnos (solo para interpretar con el LLM)
  folios?: string[];                                 // reportes abiertos
  foco_pendiente?: "resumen" | "calidad" | "cuando" | null; // preguntó "¿y la calidad?" sin dirección → se responde al llegar
}
export interface Sesion { phone_hash: string; estado: EstadoSesion; ultima_consulta_id?: string | null; ctx?: SesionCtx | null; voz?: VozEstado | null; updated_at?: string }
export interface VoiceCall { at: string; phone_hash: string; to_masked: string; colonia: string; nivel: string; motivo: string; es_demo: boolean; ok: boolean; dry_run: boolean; conversation_id: string | null; call_sid: string | null; error: string | null; consulta_id?: string | null }
export interface Reporte {
  id?: string; created_at: string; phone_hash: string; tipo: TipoReporte | "turbia" | "fuga"; lat: number; lon: number; cve_mun: string; cve_col: string | null;
  alcaldia?: string | null; colonia?: string | null; folio?: string | null; contacto?: string | null; avisado?: boolean; demo?: boolean;
}
/** Lo que el OS recibe de un reporte (sin teléfono, hash, folio ni texto; coords ~110 m). */
export interface ReportePublico { id: string; created_at: string; lat: number; lon: number; cve_mun: string; alcaldia: string | null; cve_col: string | null; colonia: string | null; tipo: TipoReporte; demo: boolean }
export type Atencion = "nuevo" | "en_revision" | "atendido";
export interface CasoAtencion {
  id: string; created_at: string; updated_at: string; zona_key: string;
  cve_mun: string; alcaldia: string | null; cve_col: string | null; colonia: string | null; lat: number; lon: number;
  estado: string; severidad: number; n: number; ventana_min: number; primero: string | null; ultimo: string | null;
  razones: string[]; fuentes: { nombre: string; fecha: string; url?: string }[]; oficial: string; discrepancia: boolean;
  atencion: Atencion; historial: { at: string; atencion?: Atencion; estado?: string; nota?: string }[];
  atendido_at: string | null; archivado: boolean; archivado_at: string | null; archivado_motivo: string | null; demo: boolean;
}
export type BusEvent = { type: "reporte"; data: ReportePublico } | { type: "caso"; data: CasoAtencion };

type Listener = (c: ConsultaPublica) => void;
interface Mem { consultas: ConsultaPublica[]; reportes: Reporte[]; sesiones: Map<string, Sesion>; listeners: Set<Listener>; calls: VoiceCall[]; reportesPub: ReportePublico[]; casos: CasoAtencion[]; bus: Set<(e: BusEvent) => void> }
const g = globalThis as unknown as { __sedMem?: Mem; __sedSb?: SupabaseClient | null };
export const mem: Mem = (g.__sedMem ??= { consultas: [], reportes: [], sesiones: new Map(), listeners: new Set(), calls: [], reportesPub: [], casos: [], bus: new Set() });
mem.calls ??= [];
mem.reportesPub ??= [];
mem.casos ??= [];
mem.bus ??= new Set();
export function emitBus(e: BusEvent) { for (const l of mem.bus) try { l(e); } catch {} }
export function subscribeBus(l: (e: BusEvent) => void) { mem.bus.add(l); return () => mem.bus.delete(l); }

export function sb(): SupabaseClient | null {
  if (g.__sedSb !== undefined) return g.__sedSb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__sedSb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return g.__sedSb;
}
export const usingSupabase = () => !!sb();

// Sal: PHONE_HASH_SALT si existe; si no, se deriva de un secreto que ya está en el servidor (nunca sale del backend).
const salt = () =>
  process.env.PHONE_HASH_SALT ||
  crypto.createHash("sha256").update("sed-salt:" + (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN || "sed-dev-salt")).digest("hex");
export const phoneHash = (from: string) => crypto.createHash("sha256").update(from + salt()).digest("hex");

// ---------- consultas ----------
export function toPublica(e: Evaluacion, extra: { canal: ConsultaPublica["canal"]; geo_fuente: ConsultaPublica["geo_fuente"]; demo: boolean; coord_nota?: string; id?: string; created_at?: string }): ConsultaPublica {
  return {
    id: extra.id ?? crypto.randomUUID(),
    created_at: extra.created_at ?? new Date().toISOString(),
    canal: extra.canal,
    lat: redondea(e.loc.lat),
    lon: redondea(e.loc.lon),
    geo_fuente: extra.geo_fuente,
    cve_mun: e.loc.cve_mun,
    alcaldia: e.loc.alcaldia,
    cve_col: e.loc.cve_col ?? null,
    colonia: e.loc.colonia ?? null,
    nivel: e.resultado.nivel,
    demo: extra.demo,
    resultado: {
      resultado: e.resultado, llegada: e.llegada, llegada_demo: e.llegada_demo, calidad: e.calidad, reply: e.reply,
      signals: e.signals, caso: e.caso, escenarios: e.escenarios, ahora: e.ahora, coord_nota: extra.coord_nota,
      origen: e.origen, planta: e.planta,
    },
  };
}

export async function insertConsulta(pub: ConsultaPublica, priv: { phone_hash?: string; texto?: string }): Promise<string> {
  const client = sb();
  if (client) {
    const { data, error } = await client
      .from("consultas")
      .insert({
        phone_hash: priv.phone_hash ?? null, canal: pub.canal, texto: priv.texto ?? null, lat: pub.lat, lon: pub.lon, geo_fuente: pub.geo_fuente,
        cve_mun: pub.cve_mun, alcaldia: pub.alcaldia, cve_col: pub.cve_col, colonia: pub.colonia, nivel: pub.nivel, resultado: pub.resultado, demo: pub.demo,
      })
      .select("id")
      .single();
    if (!error && data) return data.id as string;
    console.error("[store] insert consultas falló, uso bus en memoria:", error?.message);
  }
  publishMem(pub);
  return pub.id;
}

export function publishMem(pub: ConsultaPublica) {
  mem.consultas.push(pub);
  if (mem.consultas.length > 200) mem.consultas.splice(0, mem.consultas.length - 200);
  for (const l of mem.listeners) try { l(pub); } catch {}
}

export function subscribeMem(l: Listener) { mem.listeners.add(l); return () => mem.listeners.delete(l); }
export const backfillMem = (ms = 120_000) => mem.consultas.filter((c) => Date.now() - Date.parse(c.created_at) <= ms);

// ---------- reportes ----------
/** Inserta un reporte privado; el público (sin datos personales) lo copia el trigger (Supabase) o se emite al bus (memoria). */
export async function insertReporte(r: Omit<Reporte, "created_at" | "id">): Promise<Reporte & { id: string }> {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("reportes").insert(r).select("*").single();
    if (!error && data) return data as Reporte & { id: string };
    console.error("[store] insert reportes falló, uso memoria:", error?.message);
  }
  const row = { ...r, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  mem.reportes.push(row);
  if (["sin_agua", "baja_presion", "mala_calidad"].includes(r.tipo)) {
    const pub: ReportePublico = { id: row.id, created_at: row.created_at, lat: redondea(r.lat), lon: redondea(r.lon), cve_mun: r.cve_mun, alcaldia: r.alcaldia ?? null, cve_col: r.cve_col, colonia: r.colonia ?? null, tipo: r.tipo as TipoReporte, demo: !!r.demo };
    mem.reportesPub.push(pub);
    if (mem.reportesPub.length > 500) mem.reportesPub.splice(0, mem.reportesPub.length - 500);
    emitBus({ type: "reporte", data: pub });
  }
  return row;
}

/** Reportes (privados, con uid = phone_hash) desde `desde` en la colonia o en un cuadro de ~±1.3 km. */
export async function reportesCerca(z: { lat: number; lon: number; cve_col?: string | null }, desde: string): Promise<(Reporte & { id: string })[]> {
  const dLat = 0.012, dLon = 0.013;
  const client = sb();
  if (client) {
    const sel = "id,created_at,phone_hash,tipo,lat,lon,cve_mun,cve_col,contacto,avisado,demo";
    const [a, b] = await Promise.all([
      client.from("reportes").select(sel).gte("created_at", desde).gte("lat", z.lat - dLat).lte("lat", z.lat + dLat).gte("lon", z.lon - dLon).lte("lon", z.lon + dLon).limit(2000),
      z.cve_col ? client.from("reportes").select(sel).gte("created_at", desde).eq("cve_col", z.cve_col).limit(2000) : Promise.resolve({ data: [], error: null }),
    ]);
    if (!a.error) {
      const m = new Map<string, any>();
      for (const r of [...(a.data ?? []), ...((b as any).data ?? [])]) m.set(r.id, r);
      return [...m.values()];
    }
  }
  return mem.reportes.filter((r) => r.created_at >= desde && ((z.cve_col && r.cve_col === z.cve_col) || (Math.abs(r.lat - z.lat) <= dLat && Math.abs(r.lon - z.lon) <= dLon))) as (Reporte & { id: string })[];
}

export async function marcarAvisados(ids: string[]) {
  if (!ids.length) return;
  const client = sb();
  if (client) { await client.from("reportes").update({ avisado: true, contacto: null }).in("id", ids); return; }
  for (const r of mem.reportes) if (r.id && ids.includes(r.id)) { r.avisado = true; r.contacto = null; }
}

// ---------- casos de atención ----------
export async function casoActivo(zona_key: string): Promise<CasoAtencion | null> {
  const client = sb();
  if (client) {
    const { data } = await client.from("casos_atencion").select("*").eq("zona_key", zona_key).eq("archivado", false).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data as CasoAtencion) ?? null;
  }
  return mem.casos.find((c) => c.zona_key === zona_key && !c.archivado) ?? null;
}

export async function guardarCaso(c: Partial<CasoAtencion> & { zona_key: string }, id?: string): Promise<CasoAtencion> {
  const now = new Date().toISOString();
  const client = sb();
  if (client) {
    const q = id ? client.from("casos_atencion").update({ ...c, updated_at: now }).eq("id", id) : client.from("casos_atencion").insert({ ...c, updated_at: now });
    const { data, error } = await q.select("*").single();
    if (!error && data) return data as CasoAtencion;
    console.error("[store] casos_atencion falló, uso memoria:", error?.message);
  }
  let row = id ? mem.casos.find((x) => x.id === id) : undefined;
  if (row) Object.assign(row, c, { updated_at: now });
  else {
    row = { id: crypto.randomUUID(), created_at: now, updated_at: now, atencion: "nuevo", historial: [], archivado: false, archivado_at: null, archivado_motivo: null, atendido_at: null, demo: false, razones: [], fuentes: [], ...c } as CasoAtencion;
    mem.casos.push(row);
  }
  emitBus({ type: "caso", data: { ...row } });
  return row;
}

export async function listarCasos(desde: string): Promise<CasoAtencion[]> {
  const client = sb();
  if (client) {
    const { data } = await client.from("casos_atencion").select("*").or(`archivado.eq.false,updated_at.gte.${desde}`).order("severidad", { ascending: false }).limit(200);
    return (data ?? []) as CasoAtencion[];
  }
  return mem.casos.filter((c) => !c.archivado || c.updated_at >= desde).sort((a, b) => b.severidad - a.severidad);
}
export async function getCaso(id: string): Promise<CasoAtencion | null> {
  const client = sb();
  if (client) { const { data } = await client.from("casos_atencion").select("*").eq("id", id).maybeSingle(); return (data as CasoAtencion) ?? null; }
  return mem.casos.find((c) => c.id === id) ?? null;
}
export async function reportesPublicosDesde(desde: string): Promise<ReportePublico[]> {
  const client = sb();
  if (client) { const { data } = await client.from("reportes_publicos").select("*").gte("created_at", desde).order("created_at", { ascending: true }).limit(500); return (data ?? []) as ReportePublico[]; }
  return mem.reportesPub.filter((r) => r.created_at >= desde);
}

/** Vecinos únicos (phone_hash) en 24 h: por colonia; si no hay, por alcaldía. sin_agua → C; turbia → calidad. */
export async function countReportes24h(loc: Loc): Promise<Reportes24h> {
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  let rows: Pick<Reporte, "phone_hash" | "tipo" | "cve_col" | "cve_mun">[] = [];
  const client = sb();
  if (client) {
    const { data, error } = await client.from("reportes").select("phone_hash,tipo,cve_col,cve_mun").eq("cve_mun", loc.cve_mun).gte("created_at", desde).limit(5000);
    if (!error && data) rows = data as typeof rows;
  } else rows = mem.reportes.filter((r) => r.cve_mun === loc.cve_mun && r.created_at >= desde);
  const col = loc.cve_col ? rows.filter((r) => r.cve_col === loc.cve_col) : [];
  const use = col.length ? col : rows;
  const uniq = (t: TipoReporte) => new Set(use.filter((r) => r.tipo === t).map((r) => r.phone_hash)).size;
  const uniq2 = (ts: string[]) => new Set(use.filter((r) => ts.includes(r.tipo)).map((r) => r.phone_hash)).size;
  return { sin_agua: uniq2(["sin_agua", "baja_presion"]), calidad: uniq2(["mala_calidad", "turbia"]) };
}

// ---------- sesiones ----------
export async function getSesion(phone_hash: string): Promise<Sesion> {
  const client = sb();
  if (client) {
    const { data } = await client.from("sesiones").select("*").eq("phone_hash", phone_hash).maybeSingle();
    if (data) return data as Sesion;
    return { phone_hash, estado: "esperando_direccion" };
  }
  return mem.sesiones.get(phone_hash) ?? { phone_hash, estado: "esperando_direccion" };
}

export async function setSesion(s: Sesion) {
  const row = { ...s, updated_at: new Date().toISOString() };
  const client = sb();
  if (client) {
    const { error } = await client.from("sesiones").upsert(row);
    if (!error) return;
    console.error("[store] upsert sesiones falló:", error.message);
  }
  mem.sesiones.set(s.phone_hash, row);
}

// ---------- llamadas de voz ----------
export const maskPhone = (to: string) => to.replace(/^whatsapp:/, "").replace(/^(\+\d{2})\d+(\d{4})$/, "$1******$2");

export async function logVoiceCall(c: Omit<VoiceCall, "at">) {
  const row = { ...c, at: new Date().toISOString() };
  const client = sb();
  if (client) {
    const { error } = await client.from("voice_calls").insert(row);
    if (!error) return;
    console.error("[store] insert voice_calls falló:", error.message);
  }
  mem.calls.push(row);
}

/** Llamadas reales (no dry-run, ok) a ese número desde `desde` (ms). */
export async function callsSince(phone_hash: string, desde: number): Promise<number> {
  const iso = new Date(desde).toISOString();
  const client = sb();
  if (client) {
    const { count } = await client.from("voice_calls").select("id", { count: "exact", head: true }).eq("phone_hash", phone_hash).eq("dry_run", false).gte("at", iso);
    return count ?? 0;
  }
  return mem.calls.filter((c) => c.phone_hash === phone_hash && !c.dry_run && c.at >= iso).length;
}

/** Marca en el OS que se disparó una llamada para esa consulta (badge 📞). */
export async function marcarLlamada(consulta_id: string | undefined, info: { estado: "llamando" | "dry_run" | "error" }) {
  if (!consulta_id) return;
  const client = sb();
  if (client) {
    const { data } = await client.from("consultas_publicas").select("resultado").eq("id", consulta_id).maybeSingle();
    if (data) await client.from("consultas_publicas").update({ resultado: { ...(data.resultado as object), llamada: info } }).eq("id", consulta_id);
    return;
  }
  const c = mem.consultas.find((x) => x.id === consulta_id);
  if (c) { c.resultado.llamada = info; for (const l of mem.listeners) try { l({ ...c }); } catch {} }
}
