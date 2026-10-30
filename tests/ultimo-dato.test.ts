import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { antiguedad, ultimoDato, textoUltimoDato, sufijoUltimoDato } from "../brain/rules/ultimo_dato.ts";
import { RECOMENDACIONES_HOGAR_ROJO, RECOMENDACION_ROJO_CORTA } from "../brain/rules/calidad.ts";
import { assertSafe } from "../brain/rules/whatsapp.ts";
import { data, evaluar, locate, summary } from "@/lib/brain";
import { toPublica } from "@/lib/store";
import { Detail } from "@/components/os/Panel";

const NOW = "2026-10-29T09:00-06:00";
const centro = (cve: string) => { const f = data().colonias.find((c) => c.properties.cve_col === cve)!; return locate(f._c![1], f._c![0])!; };
const panel = (cve: string) => {
  const ev = evaluar(centro(cve), { now: NOW });
  const c = toPublica(ev, { canal: "dev", geo_fuente: "colonia", demo: false });
  return { ev, html: renderToStaticMarkup(createElement(Detail, { c, s: summary() })) };
};
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("último dato", () => {
  test("antigüedad legible", () => {
    expect(antiguedad("2024-02-01", NOW).etiqueta).toBe("hace 2 años 8 meses");
    expect(antiguedad("2026-10-27", NOW).etiqueta).toBe("hace 2 días");
    expect(antiguedad("2026-10-29", NOW).etiqueta).toBe("hoy");
    expect(antiguedad("2026-03-15", NOW).etiqueta).toBe("hace 7 meses");
  });
  test("resuelve zona → alcaldía → sistema y nunca es null con el JSON real", () => {
    const ud = data().ud;
    expect(ultimoDato(ud, "llegada", "005-036", "005")).toMatchObject({ nivel: "zona", tipo: "oficial" });
    expect(ultimoDato(ud, "llegada", "002-001", "002")).toMatchObject({ nivel: "alcaldia", tipo: "historico" });
    expect(ultimoDato(ud, "calidad", "014-034", "014")).toMatchObject({ nivel: "sistema", nota: "salida de planta, no tu llave" });
    for (const c of data().colonias) {
      expect(ultimoDato(ud, "llegada", c.properties.cve_col, c.properties.cve_mun), c.properties.cve_col).not.toBeNull();
      expect(ultimoDato(ud, "calidad", c.properties.cve_col, c.properties.cve_mun), c.properties.cve_col).not.toBeNull();
    }
  });
  test("formato visible y sufijo de WhatsApp", () => {
    const u = ultimoDato(data().ud, "llegada", "003-002", "003")!;
    expect(textoUltimoDato(u, NOW)).toBe("Último dato: 1,617 reportes de falta de agua (2022–24) · 1 feb 2024 · SACMEX (Datos Abiertos CDMX)");
    expect(sufijoUltimoDato(u, NOW)).toBe(" Último dato: 1 feb 2024, SACMEX.");
  });
  test("GET /api/brain/summary incluye ultimo_dato (005-036 zona oficial, 002-001 alcaldía)", async () => {
    const { GET } = await import("@/app/api/brain/summary/route");
    const j = await (await GET()).json();
    expect(ultimoDato(j.ultimo_dato, "llegada", "005-036", "005")).toMatchObject({ nivel: "zona", tipo: "oficial" });
    expect(ultimoDato(j.ultimo_dato, "llegada", "002-001", "002")).toMatchObject({ nivel: "alcaldia" });
  });
});

describe("panel", () => {
  test("Ajusco, Coyoacán @DEMO_NOW: ámbar, último dato con antigüedad, calidad de planta, sin 'sin dato'/'sin aviso'", () => {
    const { ev, html } = panel("003-002");
    const t = texto(html);
    expect(ev.loc.colonia).toBe("Ajusco");
    expect(ev.resultado.nivel).toBe("ambar");
    expect(t).toMatch(/Último dato: 1,617 reportes/);
    expect(t).toMatch(/hace 2 años 8 meses/);
    expect(t).toMatch(/Los Berros/);
    expect(t).toMatch(/no tu llave/);
    expect(t).not.toMatch(/sin dato|sin aviso/i);
  });
  test("CTM El Risco @DEMO_NOW: rojo, 'Qué hacer en casa' con 6 bullets y links; WhatsApp ≤4 líneas con 'hiérvela 5 min' y *426", () => {
    const { ev, html } = panel("005-036");
    expect(ev.resultado.nivel).toBe("rojo");
    const card = html.slice(html.indexOf('data-testid="que-hacer"'), html.indexOf("</ul>", html.indexOf('data-testid="que-hacer"')));
    expect((card.match(/<li/g) ?? []).length).toBe(6);
    expect((card.match(/<sup[^>]*><a href="https:\/\//g) ?? []).length).toBe(6);
    expect(ev.reply.split("\n").length).toBeLessThanOrEqual(4);
    expect(ev.reply).toMatch(/hiérvela 5 min/);
    expect(ev.reply).toMatch(/\*426/);
    expect(() => assertSafe(ev.reply)).not.toThrow();
    expect(RECOMENDACIONES_HOGAR_ROJO).toHaveLength(6);
    expect(RECOMENDACION_ROJO_CORTA.length).toBeLessThan(90);
  });
  test("aviso químico: 'hervir no quita químicos' prevalece (sin el bullet de hervir)", () => {
    const ev = evaluar(centro("005-036"), { now: NOW });
    const c = toPublica(ev, { canal: "dev", geo_fuente: "colonia", demo: false });
    c.resultado.calidad = { origen: "demo", es_demo: true, texto: "[DEMO] Alerta de calidad: x", recomendacion: "No la bebas ni cocines con ella (hervir no quita químicos). Pide pipa *426 y repórtala" };
    const html = renderToStaticMarkup(createElement(Detail, { c, s: summary() }));
    const card = html.slice(html.indexOf('data-testid="que-hacer"'), html.indexOf("</ul>", html.indexOf('data-testid="que-hacer"')));
    expect((card.match(/<li/g) ?? []).length).toBe(5);
    expect(card).toMatch(/hervir no quita químicos/);
  });
});

describe("lint de textos", () => {
  test("0 coincidencias de frases prohibidas en app/, brain/, components/, lib/ (fuera de las propias reglas)", () => {
    const re = /apta para (beber|consumo)|agua segura|\bpotable\b|se puede beber/i;
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { if (f.name !== "node_modules" && f.name !== "data") walk(p); continue; }
        if (!/\.(ts|tsx|md|json)$/.test(f.name) || /\.test\.ts$/.test(f.name)) continue;
        fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => {
          if (!re.test(l)) return;
          // definiciones de los filtros (regex/listas de prohibidas) y el prompt del LLM que las prohíbe
          if (/PROHIBIDAS|BANNED|\/[^/]*potable[^/]*\/|nunca|prohibid|K_CALIDAD|potabilidad/i.test(l)) return;
          hits.push(`${p}:${i + 1}: ${l.trim().slice(0, 100)}`);
        });
      }
    };
    for (const d of ["app", "brain", "components", "lib"]) walk(path.join(process.cwd(), d));
    expect(hits).toEqual([]);
  });
});
