import { describe, test, expect, vi, beforeEach } from "vitest";
import { locate, evaluar } from "@/lib/brain";
import { buildVoiceVars, isCritical, momentoHablado } from "@/lib/voice/vars";

const NOW = "2026-10-29T09:00-06:00";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.VOICE_DRY_RUN;
  delete process.env.VOICE_LIVE;
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("elevenlabs")) return new Response(JSON.stringify({ success: true, conversation_id: "conv_x", callSid: "CA123" }));
    return new Response("[]");
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("variables de voz", () => {
  test("CTM El Risco @ DEMO_NOW → oficial, 27 horas, fuente SEGIAGUA/adn40", () => {
    const e = evaluar(locate(19.50941, -99.09519)!, { now: NOW });
    expect(isCritical(e)).toBe(true);
    const v = buildVoiceVars(e, { demo: true });
    expect(v.tipo_dias).toBe("oficial");
    expect(v.motivo).toBe("corte programado");
    expect(v.nivel).toBe("rojo");
    expect(v.dias_estimados).toMatch(/27 horas/);
    expect(v.dias_estimados).toMatch(/viernes 30 de octubre a las 12 del día/);
    expect(v.fuente).toBe("SEGIAGUA, aviso difundido por adn40");
    expect(v.fecha_fuente).toBe("27 de octubre");
    for (const x of Object.values(v)) expect(typeof x).toBe("string");
  });
  test("[DEMO] azufre → alerta de calidad, es_demo true", () => {
    const e = evaluar(locate(19.39568, -99.07105)!, { now: NOW, demo: true });
    const v = buildVoiceVars(e);
    expect(v.motivo).toBe("alerta de calidad");
    expect(v.es_demo).toBe("true");
    expect(v.aviso_calidad).toMatch(/azufre.*caso de demostración/);
    expect(v.fuente).toMatch(/demostración/);
  });
  test("verde no es crítico", () => {
    expect(isCritical(evaluar(locate(19.386, -99.143)!, { now: NOW }))).toBe(false);
  });
  test("momento hablado", () => {
    expect(momentoHablado("2026-10-30T12:00-06:00")).toBe("el viernes 30 de octubre a las 12 del día");
    expect(momentoHablado("2026-10-31T08:30-06:00")).toBe("el sábado 31 de octubre a las 8:30 de la mañana");
  });
});

describe("triggerVoiceAlert (guardas)", async () => {
  const { triggerVoiceAlert } = await import("@/lib/voice/call");
  const e = evaluar(locate(19.50941, -99.09519)!, { now: NOW });
  const vars = buildVoiceVars(e, { demo: true });
  const verde = buildVoiceVars({ ...evaluar(locate(19.386, -99.143)!, { now: NOW }) }, {});
  let n = 0;
  const tel = () => ({ to: `whatsapp:+52155990000${n}`, phone_hash: `h${n++}` });

  test("sin opt-in → 403", async () => {
    expect((await triggerVoiceAlert({ ...tel(), vars, optIn: false })).status).toBe(403);
  });
  test("verde → 422", async () => {
    expect((await triggerVoiceAlert({ ...tel(), vars: verde, optIn: true })).status).toBe(422);
  });
  test("texto inseguro → 422", async () => {
    const r = await triggerVoiceAlert({ ...tel(), vars: { ...vars, aviso_calidad: "el agua es potable" }, optIn: true });
    expect(r.status).toBe(422);
  });
  test("dry-run por defecto: no llama a ElevenLabs", async () => {
    const r = await triggerVoiceAlert({ ...tel(), vars, optIn: true });
    expect(r.ok && r.dry_run).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("llamada real (mock) y segunda en < 1 h → 429", async () => {
    process.env.VOICE_DRY_RUN = "0";
    process.env.ELEVENLABS_API_KEY = "test";
    const t = tel();
    const r1 = await triggerVoiceAlert({ ...t, vars, optIn: true });
    expect(r1.ok && !r1.dry_run).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.agent_id).toBe("agent_9501m674z09mfptt3z954cmmfrbg");
    expect(body.agent_phone_number_id).toBe("phnum_5701m4vx6vvsfz1bn8bz4nzn4320");
    expect(body.to_number).toBe(t.to.replace("whatsapp:", ""));
    expect(body.conversation_initiation_client_data.dynamic_variables.tipo_dias).toBe("oficial");
    expect((await triggerVoiceAlert({ ...t, vars, optIn: true })).status).toBe(429);
  });
});

describe("flujo WhatsApp: oferta y SÍ/NO", async () => {
  const { handleIncoming, MSG } = await import("@/lib/bot");
  const opts = { canal: "dev" as const, now: NOW };

  test("zona crítica → respuesta ≤4 líneas + oferta aparte; SÍ → llamada (dry-run)", async () => {
    const from = "whatsapp:+5215511100001";
    const r = await handleIncoming({ From: from, Latitude: "19.50941", Longitude: "-99.09519" }, opts);
    expect(r.reply.split("\n").length).toBeLessThanOrEqual(4);
    expect(r.extra).toEqual([MSG.ofertaLlamada]);
    const si = await handleIncoming({ From: from, Body: "Sí" }, opts);
    expect(si.reply).toBe(MSG.llamadaDry);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("verde → sin oferta", async () => {
    const r = await handleIncoming({ From: "whatsapp:+5215511100002", Latitude: "19.386", Longitude: "-99.143" }, opts);
    expect(r.extra).toBeUndefined();
  });
  test("NO → no se vuelve a ofrecer en 24 h; NO LLAMES → nunca", async () => {
    const from = "whatsapp:+5215511100003";
    await handleIncoming({ From: from, Latitude: "19.50941", Longitude: "-99.09519" }, opts);
    expect((await handleIncoming({ From: from, Body: "NO" }, opts)).reply).toBe(MSG.noLlamo);
    expect((await handleIncoming({ From: from, Latitude: "19.50941", Longitude: "-99.09519" }, opts)).extra).toBeUndefined();
    const from2 = "whatsapp:+5215511100004";
    await handleIncoming({ From: from2, Latitude: "19.50941", Longitude: "-99.09519" }, opts);
    expect((await handleIncoming({ From: from2, Body: "NO LLAMES" }, opts)).reply).toBe(MSG.noLlamesNunca);
    const si = await handleIncoming({ From: from2, Body: "SÍ" }, opts); // ya no hay oferta: "sí" se aclara, no llama
    expect(si.kind).not.toBe("voz");
    expect(si.reply).toBe(MSG.siSinPregunta("CTM El Risco, GAM"));
  });
  test("SÍ sin oferta previa → no llama", async () => {
    expect((await handleIncoming({ From: "whatsapp:+5215511100005", Body: "si" }, opts)).reply).toBe(MSG.sinOferta);
  });
});

describe("número para llamar", async () => {
  const { numeroParaLlamar } = await import("@/lib/voice/call");
  test("WhatsApp MX +521 → +52", () => {
    expect(numeroParaLlamar("whatsapp:+5215512345678")).toBe("+525512345678");
    expect(numeroParaLlamar("whatsapp:+525512345678")).toBe("+525512345678");
    expect(numeroParaLlamar("whatsapp:+14155550100")).toBe("+14155550100");
  });
});
