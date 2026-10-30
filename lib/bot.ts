// Router del bot de WhatsApp. Lo usan /api/twilio/webhook y /api/dev/simulate. Solo texto o ubicación: nunca descarga media.
import { locate, evaluar, data, type Loc } from "@/lib/brain";
import { geocode, esCP } from "@/lib/geocode";
import { countReportes24h, getSesion, setSesion, insertConsulta, insertReporte, phoneHash, toPublica, type TipoReporte } from "@/lib/store";
import { maybeLLM } from "@/lib/llm";
import type { ConsultaPublica } from "@/lib/types";
import { buildVoiceVars, isCritical } from "@/lib/voice/vars";
import { triggerVoiceAlert } from "@/lib/voice/call";

export const MSG = {
  hola: "Hola 👋 Mándame tu dirección (calle, colonia, alcaldía), tu código postal o comparte tu ubicación 📍",
  media: "Por ahora solo leo texto o ubicación 📍",
  fueraCDMX: "Por ahora solo cubro CDMX. ¿Me pasas otra dirección?",
  noEncontre: "No encontré esa dirección 🤔. Mándame colonia y alcaldía (p. ej. \"Agrícola Oriental, Iztacalco\") o comparte tu ubicación 📍",
  menuReporte: "Responde 1 Sin agua · 2 Agua turbia/olor · 3 Fuga",
  gracias: "Gracias, quedó registrado 🙌. Cada reporte hace más inteligente el mapa",
  reporteSinUbicacion: "Primero mándame tu dirección o ubicación 📍 para ubicar tu reporte. Luego escribe REPORTAR",
  espera: "Dame un segundo… 🔎",
  ofertaLlamada: "Zona crítica. ¿Te llamo para explicarte? Responde SÍ",
  llamando: "Te llamo en unos segundos 📞 (te marcará un número +1)",
  llamadaDry: "Te llamo en unos segundos 📞 [modo prueba: la llamada no se marca]",
  llamadaError: "No pude llamarte ahora 😓. Tu respuesta por texto sigue arriba; pide pipa al *426 si la necesitas",
  llamadaLimite: "Ya te llamé hace poco; puedo volver a llamarte en una hora 🙏",
  noLlamo: "Va, no te llamo. Si cambias de opinión, vuelve a mandar tu colonia",
  noLlamesNunca: "Listo, no te volveremos a llamar. Seguimos por aquí por texto 🙌",
  sinOferta: "La oferta de llamada ya venció. Mándame tu colonia otra vez y te la vuelvo a ofrecer",
};

const OFERTA_TTL = 10 * 60_000;
const NO_OFRECER = 24 * 3_600_000;

export interface Entrada { Body?: string; From?: string; Latitude?: string | number; Longitude?: string | number; NumMedia?: string | number }
export interface Salida { reply: string; extra?: string[]; consulta?: ConsultaPublica; kind: "hola" | "media" | "fuera" | "no_encontre" | "menu" | "reporte" | "consulta" | "voz" | "error"; voz?: unknown }
export interface BotOpts { canal: ConsultaPublica["canal"]; demo?: boolean; now?: string }

const SALUDO = /^(hola|holi|buen[oa]s?( d[ií]as| tardes| noches)?|hey|hi|hello|qu[eé] onda|inicio|menu|men[uú]|ayuda|\?)[\s!.¡¿?]*$/i;
const TIPOS: Record<string, TipoReporte> = { "1": "sin_agua", "2": "turbia", "3": "fuga" };

export async function handleIncoming(e: Entrada, opts: BotOpts): Promise<Salida> {
  const from = e.From || "anon";
  const ph = phoneHash(from);
  const body = (e.Body ?? "").trim();
  const ses = await getSesion(ph);

  if (Number(e.NumMedia ?? 0) > 0 && e.Latitude == null) return { reply: MSG.media, kind: "media" };

  // ---- Fase 6: respuesta a la oferta de llamada (solo texto) ----
  const voz = { ...(ses.voz ?? {}), last_inbound_at: Date.now() };
  if (/^no\s+(me\s+)?llames[\s!.]*$/i.test(body)) {
    await setSesion({ ...ses, voz: { ...voz, opt_out: true, pending: null } });
    return { reply: MSG.noLlamesNunca, kind: "voz" };
  }
  if (/^s[ií][\s!.]*$/i.test(body)) {
    const p = voz.pending;
    if (!p || p.exp < Date.now() || voz.opt_out) {
      await setSesion({ ...ses, voz: { ...voz, pending: null } });
      return { reply: MSG.sinOferta, kind: "voz" };
    }
    await setSesion({ ...ses, voz: { ...voz, pending: null } });
    const r = await triggerVoiceAlert({ to: from, phone_hash: ph, vars: p.vars, optIn: true, consulta_id: p.consulta_id });
    const reply = r.ok ? (r.dry_run ? MSG.llamadaDry : MSG.llamando) : r.status === 429 ? MSG.llamadaLimite : MSG.llamadaError;
    return { reply, kind: "voz", voz: r };
  }
  if (/^no[\s!.]*$/i.test(body) && voz.pending) {
    await setSesion({ ...ses, voz: { ...voz, pending: null, declined_at: Date.now() } });
    return { reply: MSG.noLlamo, kind: "voz" };
  }
  ses.voz = voz;

  // Reporte: segundo paso (solo texto 1/2/3)
  if (ses.estado === "esperando_tipo_reporte" && /^[123]\b/.test(body)) {
    const tipo = TIPOS[body[0]];
    if (!ses.ctx) { await setSesion({ ...ses, estado: "esperando_direccion" }); return { reply: MSG.reporteSinUbicacion, kind: "menu" }; }
    await insertReporte({ phone_hash: ph, tipo, lat: ses.ctx.lat, lon: ses.ctx.lon, cve_mun: ses.ctx.cve_mun, cve_col: ses.ctx.cve_col ?? null });
    await setSesion({ ...ses, estado: "idle" });
    return { reply: MSG.gracias, kind: "reporte" };
  }
  if (/^\*?reportar\*?$/i.test(body)) {
    if (!ses.ctx) { await setSesion({ ...ses, estado: "esperando_direccion" }); return { reply: MSG.reporteSinUbicacion, kind: "menu" }; }
    await setSesion({ ...ses, estado: "esperando_tipo_reporte" });
    return { reply: MSG.menuReporte, kind: "menu" };
  }

  // Punto: ubicación directa o geocodificación
  let lat: number | undefined, lon: number | undefined;
  let geo_fuente: ConsultaPublica["geo_fuente"] = "ubicacion";
  if (e.Latitude != null && e.Longitude != null && e.Latitude !== "" && e.Longitude !== "") {
    lat = Number(e.Latitude); lon = Number(e.Longitude);
  } else if (!body || SALUDO.test(body)) {
    await setSesion({ ...ses, estado: "esperando_direccion" });
    return { reply: MSG.hola, kind: "hola" };
  } else {
    const hit = await geocode(body);
    if (!hit) return { reply: MSG.noEncontre, kind: "no_encontre" };
    lat = hit.lat; lon = hit.lon; geo_fuente = esCP(body) ? "cp" : hit.fuente;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { reply: MSG.noEncontre, kind: "no_encontre" };

  const loc = locate(lat!, lon!);
  if (!loc) return { reply: MSG.fueraCDMX, kind: "fuera" };
  return responder(loc, { ...opts, phone_hash: ph, texto: body || null, geo_fuente, sesion: ses, from });
}

export async function responder(
  loc: Loc,
  o: BotOpts & { from?: string; casoId?: string; phone_hash?: string; texto?: string | null; geo_fuente: ConsultaPublica["geo_fuente"]; sesion?: Awaited<ReturnType<typeof getSesion>>; coord_nota?: string },
): Promise<Salida> {
  const reportes24h = await countReportes24h(loc);
  const ev = evaluar(loc, { now: o.now, reportes24h, demo: o.demo, casoId: o.casoId });
  ev.reply = await maybeLLM(ev);
  const pub = toPublica(ev, { canal: o.canal, geo_fuente: o.geo_fuente, demo: !!o.demo || !!ev.calidad?.es_demo || ev.llegada_demo, coord_nota: o.coord_nota });
  const id = await insertConsulta(pub, { phone_hash: o.phone_hash, texto: o.texto ?? undefined });
  pub.id = id;
  // Fase 6: zona crítica → ofrece llamada (segundo mensaje, para no romper el máximo de 4 líneas)
  let extra: string[] | undefined;
  let voz = o.sesion?.voz ?? null;
  const ofrecer = !!o.from && !!o.sesion && (o.canal === "whatsapp" || o.canal === "dev") && isCritical(ev)
    && !voz?.opt_out && !(voz?.declined_at && Date.now() - voz.declined_at < NO_OFRECER);
  if (ofrecer) {
    try {
      const vars = buildVoiceVars(ev, { demo: o.demo || process.env.DEMO_SCENARIOS === "1" });
      voz = { ...(voz ?? {}), pending: { to: o.from!, vars, exp: Date.now() + OFERTA_TTL, consulta_id: id } };
      extra = [MSG.ofertaLlamada];
    } catch (e) {
      console.error("[voz] variables inseguras, no se ofrece llamada:", (e as Error).message);
    }
  }
  if (o.sesion) await setSesion({ ...o.sesion, estado: "idle", ultima_consulta_id: id, ctx: { lat: loc.lat, lon: loc.lon, cve_mun: loc.cve_mun, cve_col: loc.cve_col ?? null }, voz });
  return { reply: ev.reply, extra, consulta: pub, kind: "consulta" };
}

/** Casos de demo (10 + 2 escenarios) como eventos listos para el OS/simulador. */
export function demoEntradas() {
  const d = data();
  const alc = (cve: string) => d.alcaldias.find((a) => a.properties.cve_mun === cve)!.properties;
  const casos = d.demo.casos.map((c) => {
    const sinCoord = c.lat == null || c.lon == null;
    const a = alc(c.cve_mun);
    return {
      id: c.id, label: c.colonia_reportada, alcaldia: c.alcaldia, tipo: c.tipo, demo: false,
      texto: c.texto_whatsapp_demo,
      lat: sinCoord ? a.label_lat : c.lat!, lon: sinCoord ? a.label_lon : c.lon!,
      coord_nota: sinCoord ? `Sin coordenada en el caso: punto de etiqueta de ${a.nombre} (pendiente geocodificar "${c.referencia}")` : undefined,
    };
  });
  const escenarios = d.demo.escenarios_demo.map((e) => {
    const c = d.demo.casos.find((x) => x.cve_col === e.cve_col)!;
    return { id: e.id, label: `${e.colonia} [DEMO]`, alcaldia: e.alcaldia, tipo: "caso de demostración", demo: true, texto: c.texto_whatsapp_demo, lat: c.lat!, lon: c.lon!, coord_nota: undefined as string | undefined };
  });
  return [...casos, ...escenarios];
}

/** Evalúa un demo-case/escenario sin insertarlo (para /os?mock=1 y para /api/dev/simulate con casoId). */
export function consultaDemo(id: string, o: { now?: string; canal?: ConsultaPublica["canal"] } = {}): ConsultaPublica | null {
  const e = demoEntradas().find((x) => x.id === id);
  if (!e) return null;
  let loc = locate(e.lat, e.lon)!;
  if (e.coord_nota) loc = { lat: e.lat, lon: e.lon, cve_mun: loc.cve_mun, alcaldia: loc.alcaldia, colonia: `${e.label} (ubicación aprox.)` };
  const now = o.now ?? process.env.DEMO_NOW ?? data().demo._meta.ahora_demo.valor;
  const ev = evaluar(loc, { now, demo: e.demo, casoId: e.demo ? undefined : e.id });
  return toPublica(ev, { canal: o.canal ?? "mock", geo_fuente: "demo", demo: e.demo, coord_nota: e.coord_nota, id: `${o.canal ?? "mock"}-${e.id}` });
}
