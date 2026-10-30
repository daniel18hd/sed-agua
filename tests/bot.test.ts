import { describe, test, expect, vi, beforeEach } from "vitest";

// Nunca mandar mensajes reales: twilio mockeado (validateRequest real para probar la firma).
const create = vi.fn();
vi.mock("twilio", async (orig) => {
  const real: any = await orig();
  const fn: any = () => ({ messages: { create } });
  fn.validateRequest = real.default.validateRequest;
  fn.getExpectedTwilioSignature = real.default.getExpectedTwilioSignature;
  return { default: fn };
});

const NOW = "2026-10-29T09:00-06:00";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.GOOGLE_GEOCODING_API_KEY;
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("nominatim") && u.includes("postalcode=03100")) return new Response(JSON.stringify([{ lat: "19.3862", lon: "-99.1432" }]));
    if (u.includes("nominatim") && /Guadalajara/i.test(decodeURIComponent(u))) return new Response(JSON.stringify([{ lat: "20.6597", lon: "-103.3496" }]));
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("handleIncoming", async () => {
  const { handleIncoming, MSG } = await import("@/lib/bot");
  const opts = { canal: "dev" as const, now: NOW };
  let n = 0;
  const from = () => `whatsapp:+52155000000${n++}`;

  test("Hola → pide dirección", async () => {
    expect((await handleIncoming({ From: from(), Body: "Hola" }, opts)).reply).toBe(MSG.hola);
    expect((await handleIncoming({ From: from(), Body: "" }, opts)).reply).toBe(MSG.hola);
  });
  test("imagen/audio → solo texto o ubicación, sin descargar media", async () => {
    const r = await handleIncoming({ From: from(), Body: "", NumMedia: "1" }, opts);
    expect(r.reply).toBe(MSG.media);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("ubicación → respuesta ≤4 líneas sin geocodificar", async () => {
    const r = await handleIncoming({ From: from(), Latitude: "19.50941", Longitude: "-99.09519" }, opts);
    expect(r.kind).toBe("consulta");
    expect(r.reply.split("\n").length).toBeLessThanOrEqual(4);
    expect(r.reply).toMatch(/Corte programado hasta 30 oct 12:00/);
    expect(r.consulta?.geo_fuente).toBe("ubicacion");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("colonia + alcaldía en texto → catálogo local, sin red", async () => {
    const r = await handleIncoming({ From: from(), Body: "Niños Héroes, Benito Juárez" }, opts);
    expect(r.kind).toBe("consulta");
    expect(r.consulta?.cve_col).toBe("014-034");
    expect(r.reply).toMatch(/Fuente: .+\(\d{4}-\d{2}-\d{2}\)/);
  });
  test("CP → geocode postal_code", async () => {
    const r = await handleIncoming({ From: from(), Body: "03100" }, opts);
    expect(r.kind).toBe("consulta");
    expect(r.consulta?.geo_fuente).toBe("cp");
    expect(r.consulta?.cve_mun).toBe("014");
  });
  test("fuera de CDMX", async () => {
    expect((await handleIncoming({ From: from(), Latitude: "20.6597", Longitude: "-103.3496" }, opts)).reply).toBe(MSG.fueraCDMX);
    expect((await handleIncoming({ From: from(), Body: "Av. Chapultepec 100, Guadalajara" }, opts)).reply).toBe(MSG.fueraCDMX);
  });
  test("dirección inexistente → pide colonia y alcaldía", async () => {
    expect((await handleIncoming({ From: from(), Body: "asdkjh qwe" }, opts)).kind).toBe("no_encontre");
  });
  test("REPORTAR → menú → 1 → registrado, y cuenta en el semáforo", async () => {
    const tel = from();
    expect((await handleIncoming({ From: tel, Body: "REPORTAR" }, opts)).reply).toBe(MSG.reporteSinUbicacion);
    await handleIncoming({ From: tel, Latitude: "19.38632", Longitude: "-99.14318" }, opts);
    expect((await handleIncoming({ From: tel, Body: "reportar" }, opts)).reply).toBe(MSG.menuReporte);
    expect((await handleIncoming({ From: tel, Body: "1" }, opts)).reply).toBe(MSG.gracias);
    const after = await handleIncoming({ From: from(), Latitude: "19.38632", Longitude: "-99.14318" }, opts);
    expect(after.consulta?.resultado.resultado.puntaje.c).toBe(1);
  });
  test("mismo vecino reportando 2 veces cuenta 1 (únicos por phone_hash)", async () => {
    const tel = from();
    await handleIncoming({ From: tel, Latitude: "19.31341", Longitude: "-99.06557" }, opts);
    for (let i = 0; i < 2; i++) { await handleIncoming({ From: tel, Body: "REPORTAR" }, opts); await handleIncoming({ From: tel, Body: "2" }, opts); }
    const r = await handleIncoming({ From: from(), Latitude: "19.31341", Longitude: "-99.06557" }, opts);
    expect(r.consulta?.resultado.signals.reportes24h?.calidad).toBe(1);
  });
  test("consulta pública sin phone_hash ni texto, coords redondeadas", async () => {
    const r = await handleIncoming({ From: from(), Latitude: "19.386321", Longitude: "-99.143187" }, opts);
    const c: any = r.consulta;
    expect(c.phone_hash).toBeUndefined();
    expect(c.texto).toBeUndefined();
    expect(c.lat).toBe(19.386);
  });
});

describe("webhook Twilio", async () => {
  const twilio = (await import("twilio")).default as any;
  const { POST } = await import("@/app/api/twilio/webhook/route");
  const URL_ = "https://sed.example.com/api/twilio/webhook";
  const params = { From: "whatsapp:+5215511111111", Body: "Hola", NumMedia: "0" };
  const req = (sig: string) =>
    new Request(URL_, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() });

  test("firma inválida → 403", async () => {
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.PUBLIC_BASE_URL = "https://sed.example.com";
    expect((await POST(req("mala"))).status).toBe(403);
  });
  test("firma válida → TwiML con saludo, sin REST", async () => {
    const sig = twilio.getExpectedTwilioSignature("tok", URL_, params);
    const r = await POST(req(sig));
    expect(r.status).toBe(200);
    const xml = await r.text();
    expect(xml).toMatch(/<Response><Message>Hola 👋/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("alias /api/whatsapp", async () => {
  const twilio = (await import("twilio")).default as any;
  const { POST } = await import("@/app/api/whatsapp/route");
  test("firma calculada sobre /api/whatsapp → TwiML", async () => {
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.PUBLIC_BASE_URL = "https://hackathon-clara.neolabs.art";
    const url = "https://hackathon-clara.neolabs.art/api/whatsapp";
    const params = { From: "whatsapp:+5215522222222", Body: "Hola", NumMedia: "0" };
    const sig = twilio.getExpectedTwilioSignature("tok", url, params);
    const r = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params).toString() }));
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/Hola 👋/);
  });
});
