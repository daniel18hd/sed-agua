// Persistencia + bus. Con Supabase (service role) escribe en Postgres y el OS escucha Realtime.
// Sin Supabase: todo en memoria (globalThis, sobrevive HMR) y el OS escucha /api/stream (SSE). La app SIEMPRE arranca.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import type { ConsultaPublica } from "@/lib/types";
import { redondea } from "@/lib/types";
import type { Evaluacion, Loc, Reportes24h } from "@/lib/brain";

export type TipoReporte = "sin_agua" | "turbia" | "fuga";
export type EstadoSesion = "idle" | "esperando_direccion" | "esperando_tipo_reporte";
export interface Sesion { phone_hash: string; estado: EstadoSesion; ultima_consulta_id?: string | null; ctx?: { lat: number; lon: number; cve_mun: string; cve_col?: string | null } | null; updated_at?: string }
interface Reporte { created_at: string; phone_hash: string; tipo: TipoReporte; lat: number; lon: number; cve_mun: string; cve_col: string | null }

type Listener = (c: ConsultaPublica) => void;
interface Mem { consultas: ConsultaPublica[]; reportes: Reporte[]; sesiones: Map<string, Sesion>; listeners: Set<Listener> }
const g = globalThis as unknown as { __sedMem?: Mem; __sedSb?: SupabaseClient | null };
export const mem: Mem = (g.__sedMem ??= { consultas: [], reportes: [], sesiones: new Map(), listeners: new Set() });

export function sb(): SupabaseClient | null {
  if (g.__sedSb !== undefined) return g.__sedSb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__sedSb = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return g.__sedSb;
}
export const usingSupabase = () => !!sb();

export const phoneHash = (from: string) =>
  crypto.createHash("sha256").update(from + (process.env.PHONE_HASH_SALT ?? "sed-dev-salt")).digest("hex");

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
export async function insertReporte(r: Omit<Reporte, "created_at">) {
  const client = sb();
  if (client) {
    const { error } = await client.from("reportes").insert(r);
    if (!error) return;
    console.error("[store] insert reportes falló, uso memoria:", error.message);
  }
  mem.reportes.push({ ...r, created_at: new Date().toISOString() });
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
  return { sin_agua: uniq("sin_agua"), calidad: uniq("turbia") };
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
