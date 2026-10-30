// Router del bot de WhatsApp (lo usan /api/twilio/webhook y /api/dev/simulate).
// Conversación con hilo: memoria por número (última ubicación y resultado, pregunta pendiente, reportes abiertos, últimos turnos).
// Interpreta con reglas tolerantes a typos (+ LLM opcional que solo clasifica). Los DATOS salen siempre del brain.
import { locate, evaluar, data, abreviaAlcaldia, colonyByName, colonyCandidates, alcaldiaFuzzy, type Loc } from "@/lib/brain";
import { geocode, esCP } from "@/lib/geocode";
import { countReportes24h, getSesion, setSesion, insertConsulta, phoneHash, toPublica, type TipoReporte, type Sesion, type SesionCtx, type Pregunta, type VozEstado } from "@/lib/store";
import { detectIntent, intentLLM, INTENT_PRD, type Intent, type IntentHit } from "@/lib/intent";
import { registrarReporte } from "@/lib/atencion";
import { maybeLLM } from "@/lib/llm";
import { esAudio, transcribir } from "@/lib/stt";
import type { Foco } from "@/brain/rules/whatsapp.ts";
import { accionDe } from "@/brain/rules/whatsapp.ts";
import type { ConsultaPublica } from "@/lib/types";
import { buildVoiceVars, isCritical } from "@/lib/voice/vars";
import { triggerVoiceAlert } from "@/lib/voice/call";

const QUE: Record<TipoReporte, string> = { sin_agua: "falta de agua", baja_presion: "poca presión", mala_calidad: "agua turbia o con olor" };
const REGISTRE: Record<TipoReporte, string> = { sin_agua: "hoy no te llega agua", baja_presion: "el agua te llega con poca presión", mala_calidad: "el agua te sale turbia o con olor" };

export const MSG = {
  hola: "Hola 👋 Soy Sed. Te digo si hay agua en tu zona y de dónde viene. Mándame tu colonia y alcaldía, tu código postal o tu ubicación 📍",
  media: "Por ahora leo texto, notas de voz y ubicación 📍. Mándame tu colonia o tu ubicación",
  audioNo: "No pude escuchar tu nota de voz 🙏. ¿Me escribes tu colonia o me mandas tu ubicación 📍?",
  fueraCDMX: "Por ahora solo cubro la Ciudad de México. ¿Me pasas una dirección de CDMX?",
  noEncontre: "No encontré esa dirección. ¿Me pasas tu colonia y alcaldía? Por ejemplo: Agrícola Oriental, Iztacalco. O comparte tu ubicación 📍",
  menuReporte: "Responde 1 No llega agua · 2 Llega con poca presión · 3 Sale turbia o con olor",
  reporteSinUbicacion: "Va. ¿Dónde? Mándame tu colonia o tu ubicación 📍 y lo registro ahí",
  espera: "Dame un segundo… 🔎",
  ofertaLlamada: "Tu zona está en alerta. ¿Quieres que te llame para explicarte? Responde SÍ",
  llamando: "Te llamo en unos segundos 📞 (te marcará un número +1)",
  llamadaDry: "Te llamo en unos segundos 📞 [modo prueba: la llamada no se marca]",
  llamadaError: "No pude llamarte ahora 😓. Tu respuesta por texto sigue arriba; si necesitas pipa, pide al *426",
  llamadaLimite: "Ya te llamé hace poco; puedo volver a llamarte en una hora 🙏",
  llamadaSoloCritica: "Solo llamo cuando tu zona está en alerta 📞. Mándame tu colonia y, si aplica, te ofrezco la llamada",
  noLlamo: "Va, no te llamo. Si cambias de opinión, vuelve a mandar tu colonia",
  noLlamesNunca: "Listo, no te volveremos a llamar. Seguimos por aquí por texto 🙌",
  sinOferta: "La oferta de llamada ya venció. Mándame tu colonia otra vez y te la vuelvo a ofrecer",
  otraDireccion: "Va 👍 Mándame la otra dirección (colonia y alcaldía, o CP) o comparte la ubicación 📍",
  noReporto: "Va, no lo reporto. Si quieres consultar otra dirección, mándamela",
  noVa: "Va 👍 Cuando quieras, mándame tu colonia o escribe AYUDA",
  queBueno: "¡Qué bueno! 🙌 Si algo cambia, escríbeme REPORTAR",
  amable: "Aquí sigo para ayudarte 🙂 Mándame tu colonia y te digo si hay agua y de dónde viene",
  ayuda: "Te digo si hay agua en tu zona, de dónde viene y qué hacer. Mándame tu colonia o ubicación 📍. Si no te llega agua, escribe REPORTAR",
  pideDireccion: "¿De qué colonia? Mándame colonia y alcaldía (o tu ubicación 📍) y te digo",
  reporteOk: (tipo: TipoReporte, lugar: string, folio: string) => `Gracias, ya registré que ${REGISTRE[tipo]} en ${lugar}. Si más vecinos reportan, el gobierno lo ve en su panel. Folio ${folio}.`,
  menuReporteEn: (lugar: string) => `¿Qué pasa en ${lugar}? Responde 1 No llega agua · 2 Llega con poca presión · 3 Sale turbia o con olor`,
  confirmaReporte: (tipo: TipoReporte, lugar: string) => `Creo que quieres reportar ${QUE[tipo]} en ${lugar}. ¿Es así? Responde SÍ o NO`,
  noEntendi: (lugar: string) => `Creo que quieres reportar falta de agua en ${lugar}. ¿Es así? Responde SÍ o NO (o mándame otra dirección)`,
  siSinPregunta: (lugar: string) => `¿Te refieres a ${lugar}? Responde 1 para reportar que no te llega agua o 2 para consultar otra dirección`,
  mismaZona: (lugar: string) => `¡Hola de nuevo! ¿Sigues en ${lugar}? Responde SÍ o mándame tu nueva dirección`,
  elegir: (ops: string[]) => `¿Te refieres a: ${ops.map((o, i) => `${i + 1}) ${o}`).join(" ")}? Responde con el número`,
  pideColonia: (alc: string) => `¿En qué colonia de ${alc}? Así te digo lo de tu zona`,
};

const OFERTA_TTL = 10 * 60_000;
const NO_OFRECER = 24 * 3_600_000;
const PREGUNTA_TTL = 30 * 60_000;
const DIA = 24 * 3_600_000;
const TIPOS: Record<number, TipoReporte> = { 1: "sin_agua", 2: "baja_presion", 3: "mala_calidad" };

export interface Entrada { Body?: string; From?: string; Latitude?: string | number; Longitude?: string | number; NumMedia?: string | number; MediaUrl0?: string; MediaContentType0?: string }
export interface Salida {
  reply: string; extra?: string[]; consulta?: ConsultaPublica;
  kind: "hola" | "media" | "fuera" | "no_encontre" | "menu" | "reporte" | "consulta" | "voz" | "error" | "gracias" | "pregunta";
  voz?: unknown; intent?: Intent;
  avisos?: { to: string; body: string }[];   // avisos a OTROS vecinos (zona marcada en el panel)
  folio?: string;
  debug?: { intent: string; intent_prd: string; seguro?: boolean; transcrito?: string; estado: string; pregunta: string | null; ctx: Partial<SesionCtx> };
}
export interface BotOpts { canal: ConsultaPublica["canal"]; demo?: boolean; now?: string }

const tieneLoc = (c?: SesionCtx | null): c is SesionCtx & { lat: number; lon: number; cve_mun: string } => c?.lat != null && c?.lon != null && !!c?.cve_mun;
const lugarDe = (loc: Loc) => [loc.colonia, abreviaAlcaldia(loc.alcaldia)].filter(Boolean).join(", ");
const locDeCtx = (c: SesionCtx & { lat: number; lon: number; cve_mun: string }): Loc => {
  const l = locate(c.lat, c.lon);
  return l ?? { lat: c.lat, lon: c.lon, cve_mun: c.cve_mun, alcaldia: "", cve_col: c.cve_col ?? undefined };
};

type Lugar = { loc: Loc; fuente: ConsultaPublica["geo_fuente"] } | { opciones: { loc: Loc; nombre: string }[] } | { alcaldia: string } | { fuera: true } | null;

/** Dirección del texto: catálogo exacto → (si trae número) geocoder → colonias parecidas → geocoder. */
async function resolverLugar(texto: string, red = true): Promise<Lugar> {
  const t = texto.trim();
  if (!t) return null;
  if (esCP(t)) { const g = red ? await geocode(t) : null; return g ? lugarDePunto(g.lat, g.lon, "cp") : null; }
  const exacto = colonyByName(t);
  if (exacto?.fuerza === "alta") return { loc: exacto, fuente: "colonia" };
  const conNumero = /\d/.test(t);
  if (conNumero && red) { const g = await geocode(t); if (g) return lugarDePunto(g.lat, g.lon, g.fuente); }
  const c = colonyCandidates(t);
  if (c.length && c[0].score >= 0.6 && (c.length === 1 || c[0].score - c[1].score >= 0.1)) return { loc: c[0].loc, fuente: "colonia" };
  const cerca = c.filter((x) => x.score >= c[0]?.score - 0.12 && x.score >= 0.5);
  if (cerca.length >= 2) return { opciones: cerca.slice(0, 3) };
  if (!conNumero && red) { const g = await geocode(t); if (g) return lugarDePunto(g.lat, g.lon, g.fuente); }
  if (c.length === 1 && c[0].score >= 0.5) return { loc: c[0].loc, fuente: "colonia" };
  const alc = alcaldiaFuzzy(t);
  if (alc) return { alcaldia: alc.properties.nombre };
  return null;
}
function lugarDePunto(lat: number, lon: number, fuente: ConsultaPublica["geo_fuente"]): Lugar {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const loc = locate(lat, lon);
  return loc ? { loc, fuente } : { fuera: true };
}

export async function handleIncoming(e: Entrada, opts: BotOpts): Promise<Salida> {
  const from = e.From || "anon";
  const ph = phoneHash(from);
  let body = (e.Body ?? "").trim();
  const ses = await getSesion(ph);
  const voz: VozEstado = { ...(ses.voz ?? {}), last_inbound_at: Date.now() };
  ses.voz = voz;
  const ctx: SesionCtx = { ...(ses.ctx ?? {}) };
  const preg = ctx.pregunta && Date.now() - ctx.pregunta.at < PREGUNTA_TTL ? ctx.pregunta : null;
  const lugar = ctx.lugar ?? "tu última dirección";
  let transcrito: string | undefined;
  let hit: IntentHit = detectIntent(body);

  // Nota de voz → texto (si se puede); imágenes/otros → pedir texto
  if (Number(e.NumMedia ?? 0) > 0 && e.Latitude == null) {
    if (!esAudio(e)) return fin({ reply: MSG.media, kind: "media" });
    const txt = await transcribir(e);
    if (!txt) return fin({ reply: MSG.audioNo, kind: "media" });
    body = txt;
    transcrito = txt;
  }
  ctx.hist = [...(ctx.hist ?? []), { r: "u" as const, t: body.slice(0, 160) }].slice(-10);

  const pregunta = (tipo: Pregunta["tipo"], x: Partial<Pregunta> = {}): Pregunta => ({ tipo, at: Date.now(), ...x });
  const guarda = (patch: Partial<SesionCtx>, estado: Sesion["estado"] = ses.estado, vz: VozEstado = voz) => {
    Object.assign(ctx, patch);
    return setSesion({ ...ses, estado, ctx, voz: vz });
  };
  hit = detectIntent(body);
  function dbg(estado: string): Salida["debug"] { return { intent: hit.intent, intent_prd: INTENT_PRD[hit.intent], seguro: hit.seguro, transcrito, estado, pregunta: ctx.pregunta?.tipo ?? null, ctx: { lugar: ctx.lugar, nivel: ctx.nivel, cve_col: ctx.cve_col, reporte_pendiente: ctx.reporte_pendiente, folios: ctx.folios, foco_pendiente: ctx.foco_pendiente } }; }
  async function fin(s: Salida): Promise<Salida> {
    if (s.reply) ctx.hist = [...(ctx.hist ?? []), { r: "b" as const, t: s.reply.slice(0, 160) }].slice(-10);
    const cur = await getSesion(ph);
    await setSesion({ ...cur, ctx: { ...(cur.ctx ?? {}), hist: ctx.hist } });
    return { ...s, intent: s.intent ?? hit.intent, debug: dbg(cur.estado) };
  }

  const registrar = async (tipo: TipoReporte, loc?: Loc): Promise<Salida> => {
    const l = loc ?? (tieneLoc(ctx) ? locDeCtx(ctx) : null);
    if (!l) { await guarda({ reporte_pendiente: tipo, pregunta: null }, "esperando_direccion"); return { reply: MSG.reporteSinUbicacion, kind: "menu" }; }
    const r = await registrarReporte({ phone_hash: ph, contacto: from.startsWith("whatsapp:") ? from : null, tipo, loc: l, demo: opts.demo });
    const lg = loc ? lugarDe(loc) : lugar;
    await guarda({ pregunta: null, reporte_pendiente: null, folios: [...(ctx.folios ?? []), r.folio].slice(-5) }, "idle");
    // Quien reporta no recibe además el aviso de alerta en este mismo mensaje (ya sabe que hay reportes): solo los demás.
    const avisos = r.avisos.filter((a) => a.to !== from);
    return { reply: MSG.reporteOk(tipo, lg, r.folio), kind: "reporte", folio: r.folio, avisos: avisos.length ? avisos : undefined };
  };
  const llamar = async (): Promise<Salida> => {
    const p = voz.pending;
    if (!p || p.exp < Date.now() || voz.opt_out) { await guarda({ pregunta: null }, ses.estado, { ...voz, pending: null }); return { reply: MSG.sinOferta, kind: "voz" }; }
    await guarda({ pregunta: null }, ses.estado, { ...voz, pending: null });
    const r = await triggerVoiceAlert({ to: from, phone_hash: ph, vars: p.vars, optIn: true, consulta_id: p.consulta_id });
    const reply = r.ok ? (r.dry_run ? MSG.llamadaDry : MSG.llamando) : r.status === 429 ? MSG.llamadaLimite : MSG.llamadaError;
    return { reply, kind: "voz", voz: r };
  };
  const menuReporte = async (): Promise<Salida> => {
    if (!tieneLoc(ctx)) { await guarda({ reporte_pendiente: "menu", pregunta: null }, "esperando_direccion"); return { reply: MSG.reporteSinUbicacion, kind: "menu" }; }
    await guarda({ pregunta: pregunta("tipo_reporte") }, "esperando_tipo_reporte");
    return { reply: MSG.menuReporteEn(lugar), kind: "menu" };
  };
  const consultarLoc = (loc: Loc, geo_fuente: ConsultaPublica["geo_fuente"], foco?: Foco, publicar = true) =>
    responder(loc, { ...opts, phone_hash: ph, texto: body || null, geo_fuente, sesion: { ...ses, ctx }, from, foco, publicar });
  /** Respuesta con foco (calidad / cuándo / abasto) usando la dirección del mensaje o la última. */
  const conFoco = async (foco: Foco | undefined): Promise<Salida> => {
    if (hit.lugar || body.split(/\s+/).length > 3) {
      const l = await resolverLugar(hit.lugar ?? body, false);
      if (l && "loc" in l) return consultarLoc(l.loc, l.fuente, foco);
    }
    if (tieneLoc(ctx)) {
      if (ctx.at && Date.now() - ctx.at > DIA) { await guarda({ pregunta: pregunta("misma_zona", { intent: foco ?? "consultar" }) }); return { reply: MSG.mismaZona(lugar), kind: "pregunta" }; }
      return consultarLoc(locDeCtx(ctx), "ubicacion", foco, false);
    }
    await guarda({ foco_pendiente: foco ?? "resumen", pregunta: null }, "esperando_direccion");
    return { reply: MSG.pideDireccion, kind: "pregunta" };
  };
  /** Texto que puede ser dirección. */
  const comoDireccion = async (texto: string): Promise<Salida | null> => {
    const l = await resolverLugar(texto);
    if (!l) return null;
    if ("fuera" in l) return { reply: MSG.fueraCDMX, kind: "fuera" };
    if ("alcaldia" in l) { await guarda({ pregunta: null }, "esperando_direccion"); return { reply: MSG.pideColonia(l.alcaldia), kind: "pregunta" }; }
    if ("opciones" in l) {
      await guarda({ pregunta: pregunta("elegir_colonia", { opciones: l.opciones.map((o) => ({ lat: o.loc.lat, lon: o.loc.lon, nombre: o.nombre })) }) });
      return { reply: MSG.elegir(l.opciones.map((o) => o.nombre)), kind: "pregunta" };
    }
    const foco = (ctx.foco_pendiente ?? undefined) as Foco | undefined;
    return consultarLoc(l.loc, l.fuente, foco);
  };

  // ---- 1) Ubicación compartida: siempre consulta ----
  if (e.Latitude != null && e.Longitude != null && e.Latitude !== "" && e.Longitude !== "") {
    const l = lugarDePunto(Number(e.Latitude), Number(e.Longitude), "ubicacion");
    if (!l) return fin({ reply: MSG.noEncontre, kind: "no_encontre" });
    if ("fuera" in l) return fin({ reply: MSG.fueraCDMX, kind: "fuera" });
    return fin(await consultarLoc((l as any).loc, "ubicacion", (ctx.foco_pendiente ?? undefined) as Foco | undefined));
  }

  // ---- 2) Intención ----
  const dispatch = async (h: IntentHit): Promise<Salida | null> => {
    switch (h.intent) {
      case "no_llames":
        await guarda({ pregunta: null }, ses.estado, { ...voz, opt_out: true, pending: null });
        return { reply: MSG.noLlamesNunca, kind: "voz" };
      case "si": {
        if (preg?.tipo === "llamada" || (!preg && voz.pending)) return llamar();
        if (preg?.tipo === "confirmar_reporte" || preg?.tipo === "opciones") return registrar(preg.tipo_reporte ?? "sin_agua");
        if (preg?.tipo === "te_llega") { await guarda({ pregunta: null }); return { reply: MSG.queBueno, kind: "menu" }; }
        if (preg?.tipo === "tipo_reporte") return { reply: MSG.menuReporteEn(lugar), kind: "menu" };
        if (preg?.tipo === "nueva_direccion") return { reply: MSG.otraDireccion, kind: "menu" };
        if (preg?.tipo === "elegir_colonia") return { reply: MSG.elegir(preg.opciones!.map((o) => o.nombre)), kind: "pregunta" };
        if (preg?.tipo === "misma_zona" && tieneLoc(ctx)) {
          ctx.at = Date.now();
          if (preg.intent === "reportar") return registrar(preg.tipo_reporte ?? "sin_agua");
          return consultarLoc(locDeCtx(ctx), "ubicacion", preg.intent === "consultar" ? undefined : (preg.intent as Foco), false);
        }
        if (tieneLoc(ctx)) { await guarda({ pregunta: pregunta("opciones", { tipo_reporte: "sin_agua" }) }); return { reply: MSG.siSinPregunta(lugar), kind: "pregunta" }; }
        return { reply: MSG.sinOferta, kind: "voz" };
      }
      case "no": {
        if (preg?.tipo === "llamada" || (!preg && voz.pending)) {
          await guarda({ pregunta: null }, ses.estado, { ...voz, pending: null, declined_at: Date.now() });
          return { reply: MSG.noLlamo, kind: "voz" };
        }
        if (preg?.tipo === "te_llega") return registrar("sin_agua");
        if (preg?.tipo === "misma_zona") { await guarda({ pregunta: pregunta("nueva_direccion") }, "esperando_direccion"); return { reply: MSG.otraDireccion, kind: "menu" }; }
        if (preg?.tipo === "confirmar_reporte" || preg?.tipo === "tipo_reporte" || preg?.tipo === "opciones") { await guarda({ pregunta: null, reporte_pendiente: null }, "idle"); return { reply: MSG.noReporto, kind: "menu" }; }
        await guarda({ pregunta: null });
        return { reply: MSG.noVa, kind: "menu" };
      }
      case "opcion": {
        const n = h.opcion!;
        if (preg?.tipo === "elegir_colonia" && preg.opciones?.[n - 1]) {
          const o = preg.opciones[n - 1];
          const l = lugarDePunto(o.lat, o.lon, "colonia");
          if (l && "loc" in l) return consultarLoc({ ...l.loc, colonia: o.nombre.split(", ")[0] }, "colonia", (ctx.foco_pendiente ?? undefined) as Foco | undefined);
        }
        if ((ses.estado === "esperando_tipo_reporte" || preg?.tipo === "tipo_reporte") && TIPOS[n]) return registrar(TIPOS[n]);
        if (preg?.tipo === "opciones" || preg?.tipo === "confirmar_reporte") {
          if (n === 1) return registrar(preg.tipo_reporte ?? "sin_agua");
          await guarda({ pregunta: pregunta("nueva_direccion") }, "esperando_direccion");
          return { reply: MSG.otraDireccion, kind: "menu" };
        }
        return { reply: MSG.ayuda, kind: "menu" };
      }
      case "reportar": {
        // "no tengo agua en Agrícola Oriental": trae tipo Y dirección → se registra ahí directo.
        if (h.lugar || (h.tipo && body.split(/\s+/).length > 3)) {
          const l = await resolverLugar(h.lugar ?? body, false);
          if (l && "loc" in l) return h.tipo ? registrar(h.tipo, l.loc) : (await guarda({ lat: l.loc.lat, lon: l.loc.lon, cve_mun: l.loc.cve_mun, cve_col: l.loc.cve_col ?? null, lugar: lugarDe(l.loc), at: Date.now() }), menuReporte());
        }
        if (!tieneLoc(ctx)) return h.tipo ? registrar(h.tipo) : menuReporte();
        if (ctx.at && Date.now() - ctx.at > DIA) { await guarda({ pregunta: pregunta("misma_zona", { intent: "reportar", tipo_reporte: h.tipo ?? "sin_agua" }) }); return { reply: MSG.mismaZona(lugar), kind: "pregunta" }; }
        if (h.tipo && h.seguro) return registrar(h.tipo);
        if (!h.seguro) {
          await guarda({ pregunta: pregunta("confirmar_reporte", { tipo_reporte: h.tipo ?? "sin_agua" }) });
          return { reply: MSG.confirmaReporte(h.tipo ?? "sin_agua", lugar), kind: "pregunta" };
        }
        return menuReporte();
      }
      case "consultar": return conFoco(undefined);
      case "calidad": return conFoco("calidad");
      case "cuando": return conFoco("cuando");
      case "cambiar_direccion":
        await guarda({ pregunta: pregunta("nueva_direccion") }, "esperando_direccion");
        return { reply: MSG.otraDireccion, kind: "menu" };
      case "repetir":
        return ctx.ultimo_reply ? { reply: ctx.ultimo_reply, kind: "consulta" } : { reply: MSG.hola, kind: "hola" };
      case "llamada":
        return voz.pending && voz.pending.exp > Date.now() && !voz.opt_out ? llamar() : { reply: MSG.llamadaSoloCritica, kind: "voz" };
      case "ayuda":
        return { reply: MSG.ayuda, kind: "menu" };
      case "gracias":
        await guarda({ pregunta: null });
        return { reply: "", kind: "gracias" }; // cierra sin mandar más
      case "otro":
        return { reply: MSG.amable, kind: "menu" };
      case "saludo":
        if (tieneLoc(ctx) && ctx.at && Date.now() - ctx.at > DIA) { await guarda({ pregunta: pregunta("misma_zona", { intent: "consultar" }) }); return { reply: MSG.mismaZona(lugar), kind: "pregunta" }; }
        await guarda({ pregunta: null }, "esperando_direccion");
        return { reply: MSG.hola, kind: "hola" };
      default:
        return null;
    }
  };

  // Typo fuerte de "reportar" en un texto que también podría ser dirección ("Reforma 222"): primero se intenta como dirección.
  if (!(hit.intent === "reportar" && !hit.seguro && !hit.tipo)) {
    const r = await dispatch(hit);
    if (r) return fin(r);
  }

  // ---- 3) Dirección ----
  const d = await comoDireccion(hit.lugar ?? body);
  if (d) { hit = { ...hit, intent: "direccion" }; return fin(d); }
  if (hit.intent === "reportar") { const r = await dispatch(hit); if (r) return fin(r); }

  // ---- 4) LLM (opcional) solo para clasificar con el contexto de la conversación ----
  const llm = await intentLLM(body, (ctx.hist ?? []).map((x) => `${x.r === "u" ? "Vecino" : "Sed"}: ${x.t}`).join("\n") + `\nPregunta pendiente: ${preg?.tipo ?? "ninguna"}`);
  if (llm && llm !== "direccion") {
    hit = { intent: llm, seguro: false, texto: hit.texto, tipo: llm === "reportar" ? "sin_agua" : undefined };
    const r = await dispatch(hit);
    if (r) return fin(r);
  }
  // No entendí: confirmo lo que creo y ofrezco opciones (nunca un "no entendí" seco).
  if (tieneLoc(ctx) && ses.estado !== "esperando_direccion") {
    await guarda({ pregunta: pregunta("opciones", { tipo_reporte: "sin_agua" }) });
    return fin({ reply: MSG.noEntendi(lugar), kind: "pregunta" });
  }
  return fin({ reply: MSG.noEncontre, kind: "no_encontre" });
}

export async function responder(
  loc: Loc,
  o: BotOpts & { from?: string; casoId?: string; phone_hash?: string; texto?: string | null; geo_fuente: ConsultaPublica["geo_fuente"]; sesion?: Sesion; coord_nota?: string; foco?: Foco; publicar?: boolean },
): Promise<Salida> {
  const reportes24h = await countReportes24h(loc);
  const ev = evaluar(loc, { now: o.now, reportes24h, demo: o.demo, casoId: o.casoId, foco: o.foco });
  ev.reply = await maybeLLM(ev);
  const pub = toPublica(ev, { canal: o.canal, geo_fuente: o.geo_fuente, demo: !!o.demo || !!ev.calidad?.es_demo || ev.llegada_demo, coord_nota: o.coord_nota });
  if (o.publicar !== false) pub.id = await insertConsulta(pub, { phone_hash: o.phone_hash, texto: o.texto ?? undefined });
  const id = pub.id;
  let extra: string[] | undefined;
  let voz = o.sesion?.voz ?? null;
  const prev = o.sesion?.ctx ?? null;
  const lugar = lugarDe(loc);
  const pendiente = prev?.reporte_pendiente ?? null;
  let pregunta: Pregunta | null = accionDe(ev.resultado, { lugar, llegada: ev.llegada, calidad: ev.calidad, foco: o.foco }) === "te_llega" ? { tipo: "te_llega", at: Date.now() } : null;
  let estado: Sesion["estado"] = "idle";
  if (pendiente) {
    // Flujo de reporte multi-turno: pidió REPORTAR antes de dar la dirección → se retoma aquí.
    estado = "esperando_tipo_reporte";
    pregunta = pendiente === "menu" ? { tipo: "tipo_reporte", at: Date.now() } : { tipo: "confirmar_reporte", tipo_reporte: pendiente, at: Date.now() };
    extra = [pendiente === "menu" ? MSG.menuReporteEn(lugar) : MSG.confirmaReporte(pendiente, lugar).replace(/^Creo que quieres/, "¿Quieres").replace(/\. ¿Es así\?/, "?")];
  }
  // Zona crítica → ofrece llamada (segundo mensaje, para no romper el máximo de 4 líneas)
  const ofrecer = !pendiente && !!o.from && !!o.sesion && (o.canal === "whatsapp" || o.canal === "dev") && isCritical(ev)
    && !voz?.opt_out && !(voz?.declined_at && Date.now() - voz.declined_at < NO_OFRECER);
  if (ofrecer) {
    try {
      const vars = buildVoiceVars(ev, { demo: o.demo || process.env.DEMO_SCENARIOS === "1" });
      voz = { ...(voz ?? {}), pending: { to: o.from!, vars, exp: Date.now() + OFERTA_TTL, consulta_id: id } };
      extra = [MSG.ofertaLlamada];
      pregunta = { tipo: "llamada", at: Date.now() };
    } catch (e) {
      console.error("[voz] variables inseguras, no se ofrece llamada:", (e as Error).message);
    }
  }
  if (o.sesion) await setSesion({
    ...o.sesion, estado, ultima_consulta_id: id, voz,
    ctx: { ...(prev ?? {}), lat: loc.lat, lon: loc.lon, cve_mun: loc.cve_mun, cve_col: loc.cve_col ?? null, lugar, nivel: ev.resultado.nivel, consulta_id: id, consulta_texto: o.texto ?? null, ultimo_reply: ev.reply, at: Date.now(), pregunta, reporte_pendiente: null, foco_pendiente: null } as SesionCtx,
  });
  return { reply: ev.reply, extra, consulta: o.publicar === false ? undefined : pub, kind: "consulta" };
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
