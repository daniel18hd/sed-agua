import { describe, test, expect } from "vitest";
import { detectarDiscrepancia, estadoOficial, zonaKey, type ReporteRef, type SenalesOficiales } from "../brain/rules/discrepancia.ts";

const AHORA = "2026-10-30T15:00:00-06:00";
const F = (nombre: string, fecha: string) => ({ nombre, fecha });
const NORMAL: SenalesOficiales = {
  corte: null,
  sequia: { categoria: null, fuente: F("Monitor de Sequía SMN", "2026-10-15") },
  sistema: { nombre: "Cutzamala", pct: 95.1, aplica: true, fuente: F("CONAGUA Cutzamala", "2026-10-26") },
};
const ZONA = { cve_mun: "006", cve_col: "006-001", lat: 19.39, lon: -99.075 };
const hace = (min: number) => new Date(Date.parse(AHORA) - min * 60_000).toISOString();
let k = 0;
const rep = (min: number, o: Partial<ReporteRef> = {}): ReporteRef => ({ uid: `u${k++}`, lat: ZONA.lat, lon: ZONA.lon, cve_col: "006-001", created_at: hace(min), tipo: "sin_agua", ...o });
const run = (rs: ReporteRef[], of: SenalesOficiales = NORMAL, opt = {}) => detectarDiscrepancia(ZONA, rs, of, { ahora: AHORA, ...opt });

describe("detectarDiscrepancia", () => {
  test("sin reportes → sin_reportes", () => expect(run([]).estado).toBe("sin_reportes"));
  test("1–2 reportes = aislado (no alerta)", () => {
    expect(run([rep(5)]).estado).toBe("aislado");
    const d = run([rep(5), rep(10)]);
    expect(d.estado).toBe("aislado");
    expect(d.discrepancia).toBe(false);
  });
  test("3 únicos en la colonia = posible problema no reportado (discrepancia con oficial normal)", () => {
    const d = run([rep(5), rep(10), rep(20)]);
    expect(d.estado).toBe("posible_problema");
    expect(d.discrepancia).toBe(true);
    expect(d.oficial).toBe("normal");
    expect(d.razones[0]).toBe("Discrepancia: datos oficiales normales, vecinos reportan falta de agua");
    expect(d.razones.join(" ")).toMatch(/Sistema normal según Monitor de Sequía SMN, 2026-10-15; CONAGUA Cutzamala, 2026-10-26 vs 3 reporte\(s\) de vecinos \(falta de agua\) en 60 min/);
  });
  test("5 únicos = alerta (requiere atención)", () => {
    expect(run([1, 2, 3, 4, 5].map((m) => rep(m))).estado).toBe("alerta");
  });
  test("corte oficial vigente → 'explicado por aviso oficial', no alerta", () => {
    const d = run([1, 2, 3, 4, 5, 6].map((m) => rep(m)), { ...NORMAL, corte: { descripcion: "obra 08:00–20:00", fuente: F("SEGIAGUA", "2026-10-27") } });
    expect(d.estado).toBe("explicado");
    expect(d.discrepancia).toBe(false);
    expect(d.severidad).toBeLessThanOrEqual(20);
    expect(d.razones[0]).toMatch(/^Explicado por aviso oficial: corte oficial vigente \(obra 08:00–20:00\) \(SEGIAGUA, 2026-10-27\)/);
  });
  test("ventana de tiempo: reportes de hace >60 min no cuentan; ventana configurable", () => {
    const rs = [rep(5), rep(30), rep(90), rep(120)];
    expect(run(rs).n).toBe(2);
    expect(run(rs, NORMAL, { ventanaMin: 180 }).n).toBe(4);
    expect(run(rs, NORMAL, { ventanaMin: 180 }).estado).toBe("posible_problema");
  });
  test("usuarios duplicados: el mismo número cuenta 1", () => {
    const d = run([rep(5, { uid: "x" }), rep(6, { uid: "x" }), rep(7, { uid: "x" }), rep(8, { uid: "y" })]);
    expect(d.n).toBe(2);
    expect(d.estado).toBe("aislado");
  });
  test("zona vecina: otra colonia a ≤1 km cuenta; a >1 km no", () => {
    const cerca = rep(5, { cve_col: "006-999", lat: ZONA.lat + 0.006 }); // ~660 m
    const lejos = rep(5, { cve_col: "006-998", lat: ZONA.lat + 0.02 });  // ~2.2 km
    const d = run([rep(1), rep(2), cerca, lejos]);
    expect(d.n).toBe(3);
    expect(d.n_colonia).toBe(2);
    expect(d.estado).toBe("posible_problema");
  });
  test("umbrales configurables", () => {
    expect(run([rep(1), rep(2)], NORMAL, { umbralPosible: 2 }).estado).toBe("posible_problema");
    expect(run([1, 2, 3].map((m) => rep(m)), NORMAL, { umbralAlerta: 3 }).estado).toBe("alerta");
  });
  test("severidad sube con número de reportes y con duración", () => {
    const a = run([1, 2, 3].map((m) => rep(m)));
    const b = run([1, 2, 3, 4, 5].map((m) => rep(m)));
    const c = run([1, 2, 3, 4, 5, 6, 7, 8].map((m) => rep(m)));
    const larga = run([1, 25, 55].map((m) => rep(m)));
    expect(b.severidad).toBeGreaterThan(a.severidad);
    expect(c.severidad).toBeGreaterThan(b.severidad);
    expect(larga.severidad).toBeGreaterThan(a.severidad);
  });
  test("riesgo oficial (sequía D2 o Cutzamala bajo): no es discrepancia aunque haya alerta", () => {
    const d = run([1, 2, 3, 4, 5].map((m) => rep(m)), { ...NORMAL, sistema: { ...NORMAL.sistema!, pct: 38 } });
    expect(d.oficial).toBe("riesgo");
    expect(d.estado).toBe("alerta");
    expect(d.discrepancia).toBe(false);
    expect(estadoOficial({ ...NORMAL, sequia: { categoria: "D2", fuente: F("SMN", "2026-10-15") } }).estado).toBe("riesgo");
  });
  test("nunca afirma causa", () => {
    const txt = run([1, 2, 3, 4, 5].map((m) => rep(m))).razones.join(" ");
    expect(txt).not.toMatch(/fuga|tuber[ií]a rota|robo|huachicol/i);
  });
  test("clave de zona: colonia o celda de ~1 km", () => {
    expect(zonaKey({ cve_col: "006-001", cve_mun: "006", lat: 0, lon: 0 })).toBe("col:006-001");
    expect(zonaKey({ cve_col: null, cve_mun: "006", lat: 19.3912, lon: -99.0751 })).toBe("cel:006:19.39,-99.08");
  });
});
