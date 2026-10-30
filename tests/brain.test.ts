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
    expect(e.reply).toMatch(/Corte programado hasta 30 oct 12:00/);
    expect(e.reply).toMatch(/Fuente: SEGIAGUA vía adn40 \(2026-10-27\)/);
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
    expect(demo.reply).toMatch(/\*426/);
  });
  test("Escenario B (fuga sin fin Sta. Úrsula) → [DEMO] ESTIMADO 2–3 días", () => {
    const e = evaluar(locate(19.31088, -99.15403)!, { now: DEMO_NOW, demo: true });
    expect(e.llegada.tipo).toBe("estimado");
    expect(e.llegada_demo).toBe(true);
    expect(e.reply).toMatch(/\[DEMO\] ESTIMADO \(no oficial\).*2–3 días/);
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
