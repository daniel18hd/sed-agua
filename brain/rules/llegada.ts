// "¿Cuándo llega el agua?" – función PURA. NO existe dato público en tiempo real por colonia (verificado 2026-10-30).
// Regla: aviso oficial con fecha fin > estimado con base explícita > "sin dato oficial". Un estimado NUNCA se presenta como oficial.
import type { Fuente } from "./semaforo.ts";

export type Llegada =
  | { tipo: "oficial"; hasta: string; dias: number; horas: number; descripcion: string; fuente: Fuente }
  | { tipo: "estimado"; min_dias: number; max_dias: number; base: string; fuente?: Fuente }
  | { tipo: "sin_dato"; nota: string };

export interface LlegadaInput {
  ahora: string;                                                      // ISO datetime con zona, p. ej. "2026-10-29T09:00-06:00"
  avisoOficial?: { fin: string; descripcion: string; fuente: Fuente }; // aviso SEGIAGUA/alcaldía con fecha de fin
  eventoSinFin?: { inicio: string; tipo: "fuga" | "obra"; fuente: Fuente }; // corte anunciado SIN fecha de fin
  horarioTandeo?: { dias_semana: number[]; fuente: Fuente };          // 0=dom…6=sáb; solo si hay horario publicado (Agua en tu colonia) o caso demo
  tandeo2019?: boolean;
}

// Base del estimado por fuga/obra sin fecha fin: caso documentado en demo-cases.json (La Caldera, oct-2026: ~39 h de corte
// + restablecimiento gradual). Puede alargarse mucho (Tlalpan, jun-2026: 15 días). Convención de demo, NO estadística: ajustar con datos.
export const ESTIMADO_EVENTO = { min_dias: 2, max_dias: 3, base: "corte por fuga similar documentado (La Caldera, oct-2026: ~39 h + restablecimiento gradual)" };

const DIA = 86_400_000;
const fmt = (iso: string) => {
  const d = new Date(iso);
  const m = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const hh = iso.match(/T(\d{2}:\d{2})/)?.[1];
  return `${Number(iso.slice(8, 10))} ${m[Number(iso.slice(5, 7)) - 1]}${hh ? ` ${hh}` : ""}`;
};

export function estimarLlegada(i: LlegadaInput): Llegada {
  const now = Date.parse(i.ahora);
  if (i.avisoOficial) {
    const fin = Date.parse(i.avisoOficial.fin);
    if (fin > now) return { tipo: "oficial", hasta: fmt(i.avisoOficial.fin), dias: Math.ceil((fin - now) / DIA), horas: Math.round((fin - now) / 3_600_000), descripcion: i.avisoOficial.descripcion, fuente: i.avisoOficial.fuente };
    // aviso vencido: no inventamos; pedimos reporte
    return { tipo: "sin_dato", nota: `El aviso oficial terminó el ${fmt(i.avisoOficial.fin)}; si sigues sin agua, repórtalo` };
  }
  if (i.horarioTandeo?.dias_semana.length) {
    const hoy = new Date(now).getUTCDay();
    const faltan = Math.min(...i.horarioTandeo.dias_semana.map((d) => (d - hoy + 7) % 7));
    return { tipo: "estimado", min_dias: faltan, max_dias: faltan, base: "horario de tandeo publicado (puede variar)", fuente: i.horarioTandeo.fuente };
  }
  if (i.eventoSinFin) return { tipo: "estimado", ...ESTIMADO_EVENTO, fuente: i.eventoSinFin.fuente };
  return { tipo: "sin_dato", nota: i.tandeo2019 ? "Tu colonia tenía tandeo (2019); no hay horario oficial cargado" : "No hay aviso oficial de corte para tu colonia" };
}

export function textoLlegada(l: Llegada): string {
  if (l.tipo === "oficial") return `⏱ Corte programado hasta ${l.hasta} (faltan ${l.horas < 48 ? `≈${l.horas} h` : `≈${l.dias} días`})`;
  if (l.tipo === "estimado") {
    const r = l.min_dias === l.max_dias ? (l.min_dias === 0 ? "hoy" : `en ${l.min_dias} día(s)`) : `en ${l.min_dias}–${l.max_dias} días`;
    return `⏱ ESTIMADO (no oficial): el agua podría llegar ${r}`;
  }
  return `⏱ Sin dato oficial de cuándo llega. ${l.nota}`;
}
