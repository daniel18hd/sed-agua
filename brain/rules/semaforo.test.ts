import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type Signals } from "./semaforo.ts";
import { buildReply, assertSafe } from "./whatsapp.ts";
import { estimarLlegada } from "./llegada.ts";
import { avisoCalidad } from "./calidad.ts";

const loc = { lat: 19.36, lon: -99.16, cve_mun: "014", alcaldia: "Benito Juárez" };
const F = (n: string, fecha = "2026-10-26") => ({ nombre: n, fecha });
const base: Signals = {
  hoy: "2026-10-30",
  sequia: { categoria: null, fuente: F("Monitor de Sequía SMN", "2026-10-15") },
  cutzamala: { pct: 95.12, aplica: true, fuente: F("CONAGUA Cutzamala") },
  lluvia: { mm_7d: 5.8, fuente: F("Open-Meteo", "2026-10-29") },
};

test("verde: presas llenas, sin reportes", () => {
  const r = evaluate(loc, base);
  assert.equal(r.nivel, "verde");                       // s3=1 (poca lluvia en oct) total=1
  assert.equal(r.puntaje.total, 1);
});

test("ámbar: 3 reportes vecinales", () => {
  assert.equal(evaluate(loc, { ...base, reportes24h: { sin_agua: 3, calidad: 0 } }).nivel, "ambar");
});

test("ámbar: vulnerabilidad estructural alta sin reportes", () => {
  const r = evaluate(loc, { ...base, vulnerabilidad: { colonia_tandeo_2019: true, pct_sin_agua_entubada: 6.7, reportes_hist_sobre_p75: false, fuentes: [F("INEGI 2020", "2020-03-15")] } });
  assert.equal(r.nivel, "ambar");
});

test("rojo: muchos reportes (C≥15)", () => {
  assert.equal(evaluate(loc, { ...base, reportes24h: { sin_agua: 16, calidad: 0 } }).nivel, "rojo");
});

test("no rojo con 5 reportes si presas llenas y sin sequía", () => {
  assert.equal(evaluate(loc, { ...base, reportes24h: { sin_agua: 5, calidad: 0 } }).nivel, "ambar");
});

test("rojo: corte oficial vigente, confianza alta", () => {
  const r = evaluate(loc, { ...base, corteOficial: { vigente: true, descripcion: "obra 8:00–12:00", fuente: F("SEGIAGUA", "2026-10-29") } });
  assert.equal(r.nivel, "rojo"); assert.equal(r.confianza, "alta");
});

test("gris: datos viejos y sin reportes", () => {
  const r = evaluate(loc, { hoy: "2026-10-30", sequia: { categoria: null, fuente: F("SMN", "2026-08-01") } });
  assert.equal(r.nivel, "gris"); assert.equal(r.confianza, "baja");
});

test("Cutzamala bajo no penaliza alcaldía que no depende de él", () => {
  const r = evaluate({ ...loc, cve_mun: "009" }, { ...base, cutzamala: { pct: 30, aplica: false, fuente: F("CONAGUA") } });
  assert.equal(r.puntaje.s2, 0);
});

test("calidad: 3 vecinos reportan agua turbia eleva a ámbar", () => {
  const r = evaluate(loc, { ...base, reportes24h: { sin_agua: 0, calidad: 3 } });
  assert.equal(r.nivel, "ambar"); assert.ok(r.alerta_calidad);
});

test("respuesta WhatsApp: ≤4 líneas, emoji, fuente, nunca 'apta para beber'", () => {
  const txt = buildReply(evaluate(loc, base), { lugar: "Niños Héroes, BJ" });
  const lines = txt.split("\n");
  assert.ok(lines.length <= 4); assert.ok(txt.startsWith("🟢")); assert.match(txt, /Fuente: .+, \d{1,2} [a-z]{3}/);
  assert.doesNotMatch(txt, /apta para beber/i);
  assert.throws(() => assertSafe("El agua es apta para beber"));
});

const AHORA = "2026-10-29T09:00-06:00";
const SEG = F("SEGIAGUA vía adn40", "2026-10-27");
const chk = (t: string) => { assert.ok(t.split("\n").length <= 4); assert.doesNotMatch(t, /apta|potable|se puede beber/i); return t; };

test("respuesta: aviso oficial con fecha fin → 'Corte programado hasta', fuente oficial", () => {
  const ll = estimarLlegada({ ahora: AHORA, avisoOficial: { fin: "2026-10-30T12:00-06:00", descripcion: "obra 08:00–12:00", fuente: SEG } });
  assert.equal(ll.tipo, "oficial");
  const r = evaluate(loc, { ...base, corteOficial: { vigente: true, descripcion: "obra 08:00–12:00", fuente: SEG } });
  const t = chk(buildReply(r, { lugar: "CTM El Risco, GAM", llegada: ll }));
  assert.match(t, /corte programado hasta el 30 oct, 12:00/); assert.match(t, /Fuente: SEGIAGUA vía adn40, 27 oct/);
  assert.doesNotMatch(t, /ESTIMADO/);
});

test("respuesta: corte sin fecha fin → rango ESTIMADO (no oficial), nunca 'programado'", () => {
  const ll = estimarLlegada({ ahora: AHORA, eventoSinFin: { inicio: "2026-10-29T06:00-06:00", tipo: "fuga", fuente: F("demo") } });
  assert.equal(ll.tipo, "estimado");
  const t = chk(buildReply(evaluate(loc, { ...base, reportes24h: { sin_agua: 3, calidad: 0 } }), { lugar: "Pedregal de Sta. Úrsula", llegada: ll }));
  assert.match(t, /ESTIMADO \(no oficial\).*2–3 días/); assert.doesNotMatch(t, /programado/);
});

test("respuesta: alerta de calidad demo → marcada [DEMO], recomendación precautoria, fuente 'caso de demostración'", () => {
  const cal = avisoCalidad({ demo: { parametro: "posible exceso de azufre (olor a huevo)", tipo: "quimico", etiqueta: "caso de demostración" } })!;
  const r = evaluate(loc, { ...base, reportes24h: { sin_agua: 0, calidad: 3 } });
  const t = chk(buildReply(r, { lugar: "Agrícola Oriental", llegada: estimarLlegada({ ahora: AHORA }), calidad: cal }));
  assert.match(t, /\[DEMO\]/); assert.match(t, /No la tomes/); assert.match(t, /REPORTAR/); assert.match(t, /caso de demostración/);
});

test("respuesta: sin datos → 'Sin dato oficial', sin inventar días", () => {
  const ll = estimarLlegada({ ahora: AHORA });
  assert.equal(ll.tipo, "sin_dato");
  const t = chk(buildReply(evaluate(loc, { hoy: "2026-10-30" }), { lugar: "Colonia X", llegada: ll }));
  assert.ok(t.startsWith("⚪")); assert.match(t, /Aún no tengo avisos oficiales/); assert.doesNotMatch(t, /\d+ días|ESTIMADO/);
});

test("aviso oficial vencido no se presenta como vigente", () => {
  const ll = estimarLlegada({ ahora: "2026-10-31T09:00-06:00", avisoOficial: { fin: "2026-10-30T12:00-06:00", descripcion: "obra", fuente: SEG } });
  assert.equal(ll.tipo, "sin_dato");
});

test("calidad planta dentro de norma (dato real 2026-10-26) → sin aviso", () => {
  assert.equal(avisoCalidad({ planta: { fuera_de_norma: [], fuente: F("CONAGUA Los Berros") } }), null);
});
