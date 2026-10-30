import { describe, test, expect } from "vitest";
import { locate, evaluar, data, colonyByName } from "@/lib/brain";

const DEMO_NOW = "2026-10-29T09:00-06:00";
const lines = (t: string) => t.split("\n");
const PROHIBIDO = /apta para|es potable|se puede beber|segura para beber|agua segura/i;

describe("locate", () => {
  test("Niños Héroes (BJ)", () => {
    const l = locate(19.38632, -99.14318)!;
    expect(l.cve_mun).toBe("014");
    expect(l.cve_col).toBe("014-034");
  });
  test("fuera de CDMX → null", () => {
    expect(locate(20.6597, -103.3496)).toBeNull(); // Guadalajara
    expect(locate(19.60, -99.0)).toBeNull(); // Edomex
  });
  test("todos los demo-cases con coordenadas caen en su colonia de catálogo", () => {
    for (const c of data().demo.casos) {
      if (c.lat == null || c.lon == null) continue;
      const l = locate(c.lat, c.lon)!;
      expect(l, c.id).not.toBeNull();
      expect(l.cve_mun, c.id).toBe(c.cve_mun);
      expect(l.cve_col, c.id).toBe(c.cve_col);
    }
  });
  test("match por nombre de colonia", () => {
    const l = colonyByName("Agrícola Oriental, Iztacalco")!;
    expect(l.cve_col).toBe("006-001");
  });
});

describe("evaluar con demo-cases", () => {
  test("CTM El Risco con DEMO_NOW → rojo, corte programado hasta 30 oct 12:00, fuente SEGIAGUA", () => {
    const e = evaluar(locate(19.50941, -99.09519)!, { now: DEMO_NOW });
    expect(e.resultado.nivel).toBe("rojo");
    expect(e.llegada.tipo).toBe("oficial");
    expect(e.reply).toMatch(/corte programado hasta el 30 oct, 12:00/);
    expect(e.reply).toMatch(/Fuente: SEGIAGUA vía adn40, 27 oct/);
    expect(lines(e.reply).length).toBeLessThanOrEqual(4);
  });
  test("CTM El Risco con hora real posterior → aviso vencido, no rojo por corte", () => {
    const e = evaluar(locate(19.50941, -99.09519)!, { now: "2026-10-31T09:00-06:00" });
    expect(e.llegada.tipo).toBe("sin_dato");
    expect(e.reply).toMatch(/terminó/);
    expect(e.reply).not.toMatch(/Corte programado/);
  });
  test("Escenario A (azufre Agrícola Oriental) solo con flag demo", () => {
    const loc = locate(19.39568, -99.07105)!;
    const real = evaluar(loc, { now: DEMO_NOW });
    expect(real.reply).not.toMatch(/DEMO/);
    const demo = evaluar(loc, { now: DEMO_NOW, demo: true });
    expect(demo.calidad?.es_demo).toBe(true);
    expect(demo.resultado.nivel).toBe("ambar");
    expect(demo.reply).toMatch(/\[DEMO\]/);
    expect(demo.reply).toMatch(/Fuente: caso de demostración/);
    expect(demo.reply).toMatch(/No la tomes/);
  });
  test("Escenario B (fuga sin fin Sta. Úrsula) → [DEMO] ESTIMADO 2–3 días", () => {
    const e = evaluar(locate(19.31088, -99.15403)!, { now: DEMO_NOW, demo: true });
    expect(e.llegada.tipo).toBe("estimado");
    expect(e.llegada_demo).toBe(true);
    expect(e.reply).toMatch(/\[DEMO\] .*ESTIMADO \(no oficial\).*2–3 días/);
    expect(e.reply).toMatch(/Fuente: caso de demostración/);
  });
  test("todas las respuestas: ≤4 líneas, sin potabilidad, estimado siempre etiquetado", () => {
    for (const c of data().demo.casos) {
      if (c.lat == null || c.lon == null) continue;
      for (const demo of [false, true]) {
        const e = evaluar(locate(c.lat, c.lon)!, { now: DEMO_NOW, demo });
        expect(lines(e.reply).length, c.id).toBeLessThanOrEqual(4);
        expect(e.reply, c.id).not.toMatch(PROHIBIDO);
        if (e.llegada.tipo === "estimado") expect(e.reply).toMatch(/ESTIMADO \(no oficial\)/);
        expect(e.reply).toMatch(/Fuente: /);
      }
    }
  });
  test("cada fuente del resultado trae fecha", () => {
    const e = evaluar(locate(19.38632, -99.14318)!, { now: DEMO_NOW });
    for (const f of e.resultado.fuentes) expect(f.fecha, f.nombre).toBeTruthy();
  });
});

describe("nota de prensa de calidad", () => {
  test("Hacienda de las Flores (por casoId) → ámbar, aviso PRENSA, reportado el 2026-10-28", async () => {
    const { consultaDemo } = await import("@/lib/bot");
    const c = consultaDemo("izp-hacienda-flores", { now: DEMO_NOW })!;
    expect(c.nivel).toBe("ambar");
    expect(c.resultado.calidad?.origen).toBe("prensa");
    expect(c.resultado.reply).toMatch(/en las noticias reportaron agua turbia o con mal olor en tu zona \(28 oct\)/);
    expect(c.resultado.reply).toMatch(/Fuente: N\+, 28 oct/);
  });
  test("la nota caduca a los 7 días", async () => {
    const { consultaDemo } = await import("@/lib/bot");
    const c = consultaDemo("izp-hacienda-flores", { now: "2026-11-06T09:00-06:00" })!;
    expect(c.resultado.calidad).toBeNull();
    expect(c.nivel).toBe("verde");
  });
  test("una consulta a < 1 km de la coordenada del caso también la recibe", () => {
    const caso = data().demo.casos.find((x) => x.id === "izp-hacienda-flores")!;
    const prev = { lat: caso.lat, lon: caso.lon };
    caso.lat = 19.3561; caso.lon = -99.0187; // punto de prueba en Iztapalapa (no se escribe al archivo)
    try {
      const e = evaluar(locate(19.3565, -99.0190)!, { now: DEMO_NOW });
      expect(e.calidad?.origen).toBe("prensa");
      const lejos = evaluar(locate(19.386, -99.143)!, { now: DEMO_NOW });
      expect(lejos.calidad?.origen).not.toBe("prensa");
    } finally { caso.lat = prev.lat; caso.lon = prev.lon; }
  });
});

describe("presentación", () => {
  test("nombres de colonia legibles", async () => {
    const { bonito } = await import("@/lib/brain");
    expect(bonito("Pedregal De Santa Ursula")).toBe("Pedregal de Santa Ursula");
    expect(bonito("C T M El Risco")).toBe("CTM El Risco");
    expect(bonito("Del Valle Centro")).toBe("Del Valle Centro");
    expect(bonito("Lomas De La Era")).toBe("Lomas de la Era");
  });
});

describe("mensaje WhatsApp: abasto · origen y calidad de planta · tip · acción + fuente", () => {
  test("Cutzamala (BJ): 4 líneas, planta en palabras simples, no de la llave, 1 acción y fuente corta", () => {
    const e = evaluar(locate(19.38632, -99.14318)!, { now: DEMO_NOW });
    const [l1, l2, l3, l4] = lines(e.reply);
    expect(lines(e.reply)).toHaveLength(4);
    expect(l1).toBe("🟢 Tu zona (Niños Heroes, BJ) hoy sin avisos de corte.");
    expect(l2).toBe("El agua viene del Cutzamala y sale bien de la planta Los Berros (26 oct), pero no sabemos cómo llega a tu llave.");
    expect(l3).toBe("Tip: lava tu tinaco cada 6 meses.");
    expect(l4).toBe("¿Te llega agua hoy? Responde SÍ o NO. Fuente: CONAGUA Los Berros, 26 oct");
    expect((e.reply.match(/[🟢🟡🔴⚪]/gu) ?? []).length).toBe(1);
    expect(e.origen).toMatchObject({ sistema: "Cutzamala", nombre: "Presa Valle de Bravo", nodo: "presa_valle_de_bravo" });
  });
  test("GAM con corte: abasto primero, origen local sin medición pública, tip de almacenamiento, pipa *426", () => {
    const e = evaluar(locate(19.50941, -99.09519)!, { now: DEMO_NOW });
    const [l1, l2, l3, l4] = lines(e.reply);
    expect(l1).toMatch(/^🔴 En CTM El Risco, GAM hay corte programado hasta el 30 oct, 12:00/);
    expect(l2).toMatch(/viene de pozos locales y tanques Chalmita; no hay medición pública/);
    expect(l3).toMatch(/^💧 .*hiérvela 5 min/); // rojo sin aviso de calidad: recomendación en casa
    expect(l4).toBe("Pide pipa gratis al *426. Fuente: SEGIAGUA vía adn40, 27 oct");
  });
  test("foco calidad: responde calidad primero", () => {
    const e = evaluar(locate(19.38632, -99.14318)!, { now: DEMO_NOW, foco: "calidad" });
    expect(lines(e.reply)[0]).toMatch(/^🟢 Sobre la calidad en Niños Heroes, BJ: el agua viene del Cutzamala y sale bien de la planta/);
    expect(e.reply).toMatch(/no sabemos cómo llega a tu llave/);
  });
  test("foco cuándo: con corte da la hora de fin; sin corte lo dice sin inventar", () => {
    expect(evaluar(locate(19.50941, -99.09519)!, { now: DEMO_NOW, foco: "cuando" }).reply).toMatch(/hasta el 30 oct, 12:00/);
    const v = evaluar(locate(19.38632, -99.14318)!, { now: DEMO_NOW, foco: "cuando" }).reply;
    expect(v).toMatch(/no hay aviso de corte, así que no hay una fecha que esperar/);
    expect(v).not.toMatch(/\d+ días/);
  });
  test("Milpa Alta / Xochimilco: pozos y manantiales (sin ruta)", () => {
    const l = locate(19.19, -99.02)!;
    expect(l.cve_mun).toBe("009");
    expect(evaluar(l, { now: DEMO_NOW }).origen).toMatchObject({ nodo: null, nombre: "Pozos y manantiales locales" });
  });
});
