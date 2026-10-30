// Suite de conversaciones simuladas (≥30) + evaluación automática.
// Cada respuesta debe: ≤4 líneas, citar fuente con fecha cuando hay dato, no afirmar potabilidad, no inventar datos
// (las cifras salen del brain) y responder al intent correcto. Se reporta el % de aciertos.
import { describe, test, expect, vi, beforeAll, afterAll } from "vitest";

const NOW = "2026-10-29T09:00-06:00";
const PROHIBIDO = /apta para|es potable|se puede beber|segura para beber|agua segura/i;

let audioTexto = "hola quiero saber si hay agua en agricola oriental";
beforeAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.GOOGLE_GEOCODING_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://api.twilio.com/")) return new Response(null, { status: 302, headers: { location: "https://media.example/nota.ogg" } });
    if (u.startsWith("https://media.example/")) return new Response(new Blob([new Uint8Array(2048)], { type: "audio/ogg" }));
    if (u.includes("elevenlabs.io/v1/speech-to-text")) return new Response(JSON.stringify({ text: audioTexto }));
    if (u.includes("nominatim") && u.includes("postalcode=03100")) return new Response(JSON.stringify([{ lat: "19.3862", lon: "-99.1432" }]));
    if (u.includes("nominatim") && /Guadalajara/i.test(decodeURIComponent(u))) return new Response(JSON.stringify([{ lat: "20.6597", lon: "-103.3496" }]));
    return new Response("[]");
  }));
});
afterAll(() => { delete process.env.ELEVENLABS_API_KEY; vi.unstubAllGlobals(); });

type Turno = { in: string | { lat: number; lon: number } | { audio: string } | { imagen: true }; intent?: string; kind?: string; re?: RegExp; vacio?: boolean };
interface Resultado { conv: string; turno: string; ok: boolean; fallas: string[] }
const resultados: Resultado[] = [];

const BJ = { lat: 19.38632, lon: -99.14318 };   // Niños Héroes, BJ (verde, Cutzamala)
const GAM = { lat: 19.50941, lon: -99.09519 };  // CTM El Risco (corte oficial con DEMO_NOW)

describe("conversaciones simuladas", async () => {
  const { handleIncoming, MSG } = await import("@/lib/bot");
  const { mem } = await import("@/lib/store");
  let n = 0;
  const nuevo = () => `whatsapp:+5215590000${String(n++).padStart(3, "0")}`;

  async function conversa(nombre: string, turnos: Turno[], tel = nuevo()) {
    const salidas = [];
    for (const t of turnos) {
      const e: any = { From: tel };
      if (typeof t.in === "string") e.Body = t.in;
      else if ("lat" in t.in) { e.Latitude = t.in.lat; e.Longitude = t.in.lon; }
      else if ("audio" in t.in) { audioTexto = t.in.audio; e.NumMedia = "1"; e.MediaContentType0 = "audio/ogg"; e.MediaUrl0 = "https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME"; }
      else { e.NumMedia = "1"; e.MediaContentType0 = "image/jpeg"; e.MediaUrl0 = "https://api.twilio.com/x"; }
      const r = await handleIncoming(e, { canal: "dev", now: NOW });
      const fallas: string[] = [];
      const lineas = r.reply ? r.reply.split("\n").length : 0;
      if (lineas > 4) fallas.push(`${lineas} líneas`);
      if (PROHIBIDO.test(r.reply)) fallas.push("afirma potabilidad");
      if (r.kind === "consulta" && !/Fuente: (.+, \d{1,2} [a-z]{3}|caso de demostración)$/.test(r.reply)) fallas.push("sin fuente/fecha al final");
      if (r.kind === "consulta" && (r.reply.match(/[🟢🟡🔴⚪]/gu) ?? []).length !== 1) fallas.push("emoji de semáforo ≠ 1");
      if (t.intent && r.debug?.intent !== t.intent && r.intent !== t.intent) fallas.push(`intent ${r.debug?.intent} ≠ ${t.intent}`);
      if (t.kind && r.kind !== t.kind) fallas.push(`kind ${r.kind} ≠ ${t.kind}`);
      if (t.re && !t.re.test(r.reply)) fallas.push(`texto no coincide ${t.re}: «${r.reply.slice(0, 90)}»`);
      if (t.vacio && r.reply !== "") fallas.push("debía cerrar sin mensaje");
      resultados.push({ conv: nombre, turno: typeof t.in === "string" ? t.in : JSON.stringify(t.in), ok: !fallas.length, fallas });
      salidas.push(r);
    }
    return salidas;
  }

  test("30+ conversaciones", async () => {
    await conversa("repetir", [{ in: BJ }, { in: "repetir", intent: "repetir", re: /^🟢 Tu zona/ }]);
    await conversa("¿Te llega agua hoy? SÍ → cierra", [{ in: BJ }, { in: "sii", re: /Qué bueno/ }]);
    await conversa("¿Te llega agua hoy? NO → reporte", [{ in: BJ, re: /¿Te llega agua hoy\? Responde SÍ o NO/ }, { in: "no", kind: "reporte" }]);
    await conversa("saludo", [{ in: "Hola", intent: "saludo", re: /Soy Sed/ }]);
    await conversa("saludo sin acentos", [{ in: "ola buenas", intent: "saludo" }]);
    await conversa("dirección exacta", [{ in: "Niños Héroes, Benito Juárez", kind: "consulta", re: /^🟢 Tu zona \(Niños Heroes, BJ\)/ }]);
    await conversa("colonia con typo y frase", [{ in: "mi colonya es agricola oriental", kind: "consulta", re: /Agricola Oriental/ }]);
    await conversa("colonia mal escrita", [{ in: "agrikola oriental iztacalco", kind: "consulta", re: /Agricola Oriental/ }]);
    await conversa("MAYÚSCULAS", [{ in: "AGRICOLA ORIENTAL", kind: "consulta" }]);
    await conversa("dirección parcial ambigua → 1 pregunta numerada", [
      { in: "agricola", kind: "pregunta", re: /^¿Te refieres a: 1\) Agricola Oriental, Iztacalco 2\) Agricola Pantitlan/ },
      { in: "1", kind: "consulta", re: /Agricola Oriental/ },
    ]);
    await conversa("solo alcaldía mal escrita", [{ in: "istapalapa", kind: "pregunta", re: /¿En qué colonia de Iztapalapa\?/ }]);
    await conversa("CP", [{ in: "03100", kind: "consulta" }]);
    await conversa("fuera de CDMX (texto)", [{ in: "Av. Chapultepec 100, Guadalajara", kind: "fuera" }]);
    await conversa("fuera de CDMX (ubicación)", [{ in: { lat: 20.6597, lon: -103.3496 }, kind: "fuera" }]);
    await conversa("ai agua?", [{ in: BJ, kind: "consulta" }, { in: "ai agua?", intent: "consultar", re: /^🟢/ }]);
    await conversa("ps nomas dime si hay agua", [{ in: BJ }, { in: "ps nomas dime si hay agua", intent: "consultar", re: /sin avisos de corte/ }]);
    await conversa("ke calidad tiene", [{ in: BJ }, { in: "ke calidad tiene", intent: "calidad", re: /^🟢 Sobre la calidad en Niños Heroes, BJ/ }]);
    await conversa("y está buena?", [{ in: BJ }, { in: "y esta buena?", intent: "calidad", re: /no sabemos cómo llega a tu llave/ }]);
    await conversa("oye y cuándo llega?", [{ in: GAM }, { in: "NO" }, { in: "oye y cuando llega?", intent: "cuando", re: /hasta el 30 oct, 12:00/ }]);
    await conversa("rprtar (typo fuerte) → confirma con la última dirección", [
      { in: BJ }, { in: "rprtar", intent: "reportar", re: /^Creo que quieres reportar falta de agua en Niños Heroes, BJ\. ¿Es así\? Responde SÍ o NO$/ },
      { in: "si", kind: "reporte", re: /Folio SED-\d{4}/ },
    ]);
    await conversa("reportr → menú ligado → 2", [{ in: BJ }, { in: "reportr", intent: "reportar", re: /¿Qué pasa en Niños Heroes, BJ\?/ }, { in: "2", kind: "reporte", re: /poca presión/ }]);
    await conversa("REPORTARR", [{ in: BJ }, { in: "REPORTARR", intent: "reportar" }]);
    await conversa("no tengo agua desde ayer", [{ in: BJ }, { in: "no tengo agua desde ayer", intent: "reportar", kind: "reporte", re: /^Gracias, ya registré que hoy no te llega agua en Niños Heroes, BJ\. Si más vecinos reportan, el gobierno lo ve en su panel\. Folio SED-\d{4}\.$/ }]);
    await conversa("no tengo aguaa (sin dirección) → ¿dónde? → dirección → SÍ", [
      { in: "no tengo aguaa", intent: "reportar", re: /¿Dónde\?/ },
      { in: "Niños Heroes, Benito Juarez", kind: "consulta" },
      { in: "si", kind: "reporte" },
    ]);
    await conversa("sale turbia", [{ in: BJ }, { in: "sale turbia y huele feo", intent: "reportar", kind: "reporte", re: /turbia o con olor/ }]);
    await conversa("poca presión", [{ in: BJ }, { in: "llega con poca presion", kind: "reporte", re: /poca presión/ }]);
    await conversa("esa misma", [{ in: BJ }, { in: "no hay agua" }, { in: "esa misma" }]);
    await conversa("y mi otra casa?", [{ in: BJ }, { in: "y mi otra casa?", intent: "cambiar_direccion", re: /otra dirección/ }, { in: GAM, kind: "consulta", re: /CTM El Risco/ }]);
    await conversa("gracias cierra sin mandar más", [{ in: BJ }, { in: "gracias!!", intent: "gracias", vacio: true }]);
    await conversa("insulto → amable", [{ in: "eres un pendejo", intent: "otro", re: /Aquí sigo para ayudarte/ }]);
    await conversa("broma → amable", [{ in: "jajaja", intent: "otro" }]);
    await conversa("audio transcrito", [{ in: { audio: "hola quiero saber si hay agua en agricola oriental" }, kind: "consulta", re: /Agricola Oriental/ }]);
    await conversa("audio largo y desordenado", [{ in: BJ }, { in: { audio: "oye fíjate que pues ya llevamos desde ayer y no tengo agua en la casa" }, kind: "reporte" }]);
    await conversa("imagen → pide texto", [{ in: { imagen: true }, kind: "media" }]);
    await conversa("no entiende → confirma y ofrece opciones", [{ in: BJ }, { in: "qwe zxc asd", re: /^Creo que quieres reportar falta de agua en Niños Heroes, BJ\. ¿Es así\?/ }, { in: "si", kind: "reporte" }]);
    await conversa("Reforma 222 no es otra intención", [{ in: "Reforma 222", intent: "direccion" }]);
    await conversa("ayuda", [{ in: "ayudaa", intent: "ayuda", re: /REPORTAR/ }]);
    await conversa("hilo ≥5 turnos", [
      { in: BJ, kind: "consulta" },
      { in: "y la calidad?", intent: "calidad", re: /Sobre la calidad en Niños Heroes, BJ/ },
      { in: "y cuando llega?", intent: "cuando", re: /Niños Heroes, BJ/ },
      { in: "reportar", intent: "reportar", re: /¿Qué pasa en Niños Heroes, BJ\?/ },
      { in: "1", kind: "reporte", re: /Niños Heroes, BJ/ },
      { in: "gracias", vacio: true },
    ]);
  });

  test("ciclo completo: reporte → folio → aviso de alerta (máx. 1 por persona, sin prometer fecha)", async () => {
    process.env.DEMO_NOW = NOW; // en producción el "hoy" de los avisos es DEMO_NOW, pero la ventana de reportes usa el reloj real
    const tels = [0, 1, 2, 3, 4].map(() => nuevo());
    const salidas = [];
    for (const t of tels) { await handleIncoming({ From: t, Body: "Agricola Oriental, Iztacalco" }, { canal: "dev", now: NOW }); salidas.push(await handleIncoming({ From: t, Body: "no tengo agua" }, { canal: "dev", now: NOW })); }
    for (const s of salidas) expect(s.reply).toMatch(/Folio SED-\d{4}\.$/);
    expect(salidas[0].avisos).toBeUndefined();
    expect(salidas[1].avisos).toBeUndefined();
    // el 3er reporte marca la zona → avisa a los 2 anteriores
    expect(salidas[2].avisos?.map((a) => a.to).sort()).toEqual([tels[0], tels[1]].sort());
    expect(salidas[2].avisos?.[0].body).toBe("Ya hay varios reportes en tu zona; lo enviamos al panel de atención. Gracias por avisar 🙌");
    expect(salidas[2].avisos?.[0].body).not.toMatch(/\d+ (h|días|horas)|mañana|hoy se/);
    // 4º y 5º: no se repite aviso a nadie que ya lo recibió
    const despues = [...(salidas[3].avisos ?? []), ...(salidas[4].avisos ?? [])].map((a) => a.to);
    expect(despues).not.toContain(tels[0]);
    expect(despues).not.toContain(tels[1]);
    const caso = mem.casos.find((c) => c.cve_col === "006-001" && !c.archivado)!;
    expect(caso.estado).toBe("alerta");
    expect(caso.n).toBe(5);
    expect(mem.reportesPub.filter((r) => r.cve_col === "006-001").every((r) => !("phone_hash" in r) && !("contacto" in r))).toBe(true);
    delete process.env.DEMO_NOW;
  });

  test("más de 24 h: saluda y pregunta si sigue en la misma zona", async () => {
    const t = nuevo();
    await handleIncoming({ From: t, Latitude: BJ.lat, Longitude: BJ.lon }, { canal: "dev", now: NOW });
    const ph = (await import("@/lib/store")).phoneHash(t);
    const s = mem.sesiones.get(ph)!;
    s.ctx!.at = Date.now() - 25 * 3_600_000;
    s.ctx!.pregunta = null;
    const r = await handleIncoming({ From: t, Body: "reportar" }, { canal: "dev", now: NOW });
    expect(r.reply).toBe(MSG.mismaZona("Niños Heroes, BJ"));
    expect((await handleIncoming({ From: t, Body: "si sigo ahi" }, { canal: "dev", now: NOW })).kind).toBe("reporte");
  });

  test("evaluación automática: % de aciertos", () => {
    const ok = resultados.filter((r) => r.ok).length;
    const pct = Math.round((ok / resultados.length) * 1000) / 10;
    const convs = new Set(resultados.map((r) => r.conv)).size;
    console.log(`\n[conversaciones] ${convs} conversaciones · ${resultados.length} turnos · aciertos ${ok}/${resultados.length} = ${pct}%`);
    for (const r of resultados.filter((x) => !x.ok)) console.log(`  ✗ ${r.conv} · «${r.turno}»: ${r.fallas.join("; ")}`);
    expect(convs).toBeGreaterThanOrEqual(30);
    expect(resultados.filter((r) => r.fallas.some((f) => /líneas|potabilidad|fuente/.test(f)))).toEqual([]);
    expect(pct).toBeGreaterThanOrEqual(95);
  });
});
