// Genera brain/data/ultimo_dato_por_zona.json a partir de los datos ya empaquetados (sin red).
//   llegada: aviso oficial del caso (zona) > nota de prensa del caso (zona) > top de reportes SACMEX de la colonia (zona) > total de la alcaldía
//   calidad: nota de prensa de calidad (zona) > salida de planta Los Berros (alcaldías con Cutzamala, nivel sistema) > reportes "mala calidad" SACMEX (alcaldía)
import fs from "node:fs";
import path from "node:path";
import { data, normaliza, medio } from "../lib/brain.ts";
import type { UDData, UltimoDato } from "../brain/rules/ultimo_dato.ts";

const d = data();
const out: UDData = { _meta: { generado: new Date().toISOString().slice(0, 10), nota: "derivado de demo-cases.json, reportes_historicos_alcaldia.json, calidad_los_berros.json y abastecimiento_alcaldia.json" }, zona: {}, alcaldia: {}, sistema: {} };
const n = (x: number) => x.toLocaleString("en-US");
const rep = d.reportes._meta, ber = d.berros._meta;
const SAC = "SACMEX (Datos Abiertos CDMX)";
const zona = (cve: string) => (out.zona[cve] ??= {});

// llegada por zona: casos de prensa / aviso oficial
for (const c of d.demo.casos) {
  if (!c.cve_col) continue;
  const f = c.fuentes[0];
  if (c.ventana_oficial) {
    const fin = c.ventana_oficial.fin;
    zona(c.cve_col).llegada = { valor: `corte programado ${c.ventana_oficial.horario} hasta ${Number(fin.slice(8, 10))} ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][Number(fin.slice(5, 7)) - 1]}`, fecha: c.fecha_nota, fuente: `SEGIAGUA vía ${medio(f)}`, url: f, tipo: "oficial", nivel: "zona" };
  } else if (c.tipo === "reportado en prensa" && c.categoria !== "calidad") {
    zona(c.cve_col).llegada = { valor: c.frase.replace(/^.*?:\s*/, "").slice(0, 70) || "desabasto reportado", fecha: c.fecha_nota, fuente: medio(f), url: f, tipo: "prensa", nivel: "zona" };
  }
}
// top de reportes por colonia (SACMEX)
for (const [cve_mun, a] of Object.entries(d.reportes.por_cve_mun) as [string, any][]) {
  for (const t of a.top_colonias_falta_agua ?? []) {
    const col = d.colonias.find((c) => c.properties.cve_mun === cve_mun && normaliza(c.properties.colonia) === normaliza(t.colonia));
    if (!col || zona(col.properties.cve_col).llegada) continue;
    zona(col.properties.cve_col).llegada = { valor: `${n(t.n)} reportes de falta de agua (2022–24)`, fecha: rep.fecha_corte, fuente: SAC, url: rep.url ?? undefined, tipo: "historico", nivel: "zona" };
  }
  out.alcaldia[cve_mun] = {
    llegada: { valor: `${n(a.falta_de_agua)} reportes de falta de agua en la alcaldía (2022–24)`, fecha: rep.fecha_corte, fuente: SAC, url: rep.url ?? undefined, tipo: "historico", nivel: "alcaldia" },
  };
}
// calidad
const u = d.berros.ultimo;
const planta: UltimoDato = {
  valor: `Los Berros ${u.parametros_fuera_de_norma?.length ? `fuera de norma (${u.parametros_fuera_de_norma.join(", ")})` : `en norma (turbiedad ${u.turbiedad_unt} UNT, cloro ${u.cloro_residual_mg_l} mg/L)`}`,
  fecha: u.fecha, fuente: "CONAGUA", url: ber.url ?? undefined, tipo: "oficial", nivel: "sistema", nota: "salida de planta, no tu llave",
};
out.sistema.calidad = planta;
const cz = d.cutzamala;
out.sistema.llegada = { valor: `Sistema Cutzamala al ${cz.ultimo.total_pct.toFixed(1)}%`, fecha: cz.ultimo.fecha, fuente: "CONAGUA", url: cz._meta.url ?? undefined, tipo: "oficial", nivel: "sistema" };
for (const [cve_mun, ab] of Object.entries(d.abast.por_cve_mun)) {
  const a = d.reportes.por_cve_mun[cve_mun] as any;
  out.alcaldia[cve_mun] ??= {};
  if (!ab.cutzamala && a) out.alcaldia[cve_mun].calidad = { valor: `${n(a.mala_calidad)} reportes de mala calidad en la alcaldía (2022–24)`, fecha: rep.fecha_corte, fuente: SAC, url: rep.url ?? undefined, tipo: "historico", nivel: "alcaldia", nota: "no hay medición pública de la fuente local" };
}
for (const c of d.demo.casos) if (c.cve_col && c.categoria === "calidad") zona(c.cve_col).calidad = { valor: "agua turbia o con mal olor reportada", fecha: c.fecha_nota, fuente: medio(c.fuentes[0]), url: c.fuentes[0], tipo: "prensa", nivel: "zona" };

const file = path.join(process.cwd(), "brain", "data", "ultimo_dato_por_zona.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`ultimo_dato_por_zona.json: ${Object.keys(out.zona).length} zonas, ${Object.keys(out.alcaldia).length} alcaldías`);
