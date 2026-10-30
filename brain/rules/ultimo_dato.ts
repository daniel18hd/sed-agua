// "Último dato" – función PURA. Cuando no hay aviso vigente no decimos "sin dato": mostramos el último dato conocido,
// con su fecha, fuente, tipo (oficial / prensa / histórico), antigüedad y a qué nivel aplica (zona, alcaldía o sistema).
export type TipoUD = "oficial" | "prensa" | "historico";
export type NivelUD = "zona" | "alcaldia" | "sistema";
export type CampoUD = "llegada" | "calidad";
export interface UltimoDato { valor: string; fecha: string; fuente: string; url?: string; tipo: TipoUD; nivel: NivelUD; nota?: string }
export interface UDData {
  _meta?: Record<string, unknown>;
  zona: Record<string, Partial<Record<CampoUD, UltimoDato>>>;
  alcaldia: Record<string, Partial<Record<CampoUD, UltimoDato>>>;
  sistema: Partial<Record<CampoUD, UltimoDato>>;
}

/** Resuelve zona → alcaldía → sistema. */
export function ultimoDato(ud: UDData | null | undefined, campo: CampoUD, cve_col?: string | null, cve_mun?: string | null): UltimoDato | null {
  if (!ud) return null;
  return (cve_col && ud.zona[cve_col]?.[campo]) || (cve_mun && ud.alcaldia[cve_mun]?.[campo]) || ud.sistema[campo] || null;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "1 feb 2024" (con año si no es el año de `now`). */
export function fechaUD(iso: string, now: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MES[m - 1]}${String(y) !== now.slice(0, 4) ? ` ${y}` : ""}`;
}

/** Antigüedad legible: "hoy", "hace 3 días", "hace 5 meses", "hace 2 años 8 meses". */
export function antiguedad(fecha: string, now: string): { dias: number; etiqueta: string } {
  const a = new Date(fecha.slice(0, 10) + "T12:00:00Z"), b = new Date(now.slice(0, 10) + "T12:00:00Z");
  const dias = Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
  let meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) meses--;
  const anos = Math.floor(meses / 12), m = meses % 12;
  const etiqueta = dias === 0 ? "hoy" : dias === 1 ? "ayer" : dias < 31 ? `hace ${dias} días`
    : anos === 0 ? `hace ${meses} ${meses === 1 ? "mes" : "meses"}`
    : `hace ${anos} ${anos === 1 ? "año" : "años"}${m ? ` ${m} ${m === 1 ? "mes" : "meses"}` : ""}`;
  return { dias, etiqueta };
}

export const textoUltimoDato = (u: UltimoDato, now: string) => `Último dato: ${u.valor} · ${fechaUD(u.fecha, now)} · ${u.fuente}`;

/** Para WhatsApp (≤160 caracteres en la línea): " Último dato: 1 feb 2024, SACMEX". */
export const sufijoUltimoDato = (u: UltimoDato, now: string) => ` Último dato: ${fechaUD(u.fecha, now)}, ${u.fuente.split(/[ (·]/)[0]}.`;
