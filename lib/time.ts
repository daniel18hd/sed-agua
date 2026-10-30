// Reloj de la app: DEMO_NOW (si existe) o la hora real. Siempre en zona CDMX para fechas "hoy".
export const TZ = "America/Mexico_City";

export function nowISO(override?: string | null): string {
  const v = override || process.env.DEMO_NOW;
  if (v && !isNaN(Date.parse(v))) return v;
  return new Date().toISOString();
}

/** "YYYY-MM-DD" en hora de CDMX */
export function fechaCDMX(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
