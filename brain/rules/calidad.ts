// Aviso de calidad – función PURA. Fuentes verificadas: salida de planta Los Berros (turbiedad, color, pH, cloro, dureza, olor, sabor)
// y reportes vecinales. NO hay dato público de azufre/sulfatos por colonia (Datos CDMX: solo "Mala calidad" sin parámetro).
// Recomendaciones = precaución. Nunca se afirma potabilidad.
import type { Fuente } from "./semaforo.ts";

export type Origen = "planta" | "vecinos" | "prensa" | "demo";
export interface AvisoCalidad { origen: Origen; es_demo: boolean; texto: string; recomendacion: string; fuente?: Fuente }

export interface CalidadInput {
  planta?: { fuera_de_norma: string[]; fuente: Fuente };       // Los Berros (salida de planta ≠ grifo)
  reportesCalidad24h?: number;                                  // vecinos únicos que reportan turbia/olor/color
  demo?: { parametro: string; tipo: "quimico" | "microbiologico"; etiqueta: string }; // demo-cases.json → escenarios_demo
  prensa?: { fecha: string; fuente: Fuente };                   // nota de prensa reciente (≤7 d) sobre calidad en la colonia
}

export const RECOMENDACION = {
  quimico: "No la bebas ni cocines con ella (hervir no quita químicos). Pide pipa *426 y repórtala",
  microbiologico: "No la bebas sin hervir (1 min). Si sigue turbia, pide pipa *426 y repórtala",
  general: "Si sale turbia o con olor, no la bebas y repórtala al *426",
} as const;

export function avisoCalidad(i: CalidadInput): AvisoCalidad | null {
  if (i.demo) return { origen: "demo", es_demo: true, texto: `[DEMO] Alerta de calidad: ${i.demo.parametro}`, recomendacion: RECOMENDACION[i.demo.tipo] };
  if (i.planta?.fuera_de_norma.length)
    return { origen: "planta", es_demo: false, texto: `Planta Los Berros fuera de norma en ${i.planta.fuera_de_norma.join(", ")} (salida de planta, no tu llave)`, recomendacion: RECOMENDACION.general, fuente: i.planta.fuente };
  if ((i.reportesCalidad24h ?? 0) >= 3)
    return { origen: "vecinos", es_demo: false, texto: `${i.reportesCalidad24h} vecinos reportan agua turbia o con olor`, recomendacion: RECOMENDACION.general };
  if (i.prensa)
    return { origen: "prensa", es_demo: false, texto: `Reportado en prensa el ${i.prensa.fecha}: agua turbia o con mal olor en tu zona`, recomendacion: RECOMENDACION.general, fuente: i.prensa.fuente };
  return null;
}

// Zonas en ROJO (sin aviso de calidad): precauciones en casa. Son recomendaciones generales de precaución;
// Sed no mide el agua de la llave.
export const FUENTES_HOGAR = {
  segiagua: { nombre: "SEGIAGUA", url: "https://segiagua.cdmx.gob.mx/" },
  salud: { nombre: "Secretaría de Salud / COFEPRIS", url: "https://www.gob.mx/cofepris" },
  oms: { nombre: "OMS", url: "https://www.who.int/es/news-room/fact-sheets/detail/drinking-water" },
} as const;
export type FuenteHogar = keyof typeof FUENTES_HOGAR;
export const RECOMENDACIONES_HOGAR_ROJO: { id: string; texto: string; fuente: FuenteHogar }[] = [
  { id: "tapar", texto: "Tapa bien cubetas, tambos y tinacos donde guardes agua", fuente: "segiagua" },
  { id: "hervir", texto: "Para tomar o cocinar, hiérvela 5 min o usa garrafón", fuente: "salud" },
  { id: "turbia", texto: "Si sale turbia o huele raro, déjala correr y no la tomes", fuente: "salud" },
  { id: "clorar", texto: "Para desinfectar: 2 gotas de cloro por litro y espera 30 min", fuente: "salud" },
  { id: "tinaco", texto: "Cuando regrese, lava tinaco y cisterna antes de llenarlos", fuente: "segiagua" },
  { id: "manos", texto: "Aparta agua limpia para lavarte las manos con jabón", fuente: "oms" },
];
export const RECOMENDACION_ROJO_CORTA = "Si guardas agua, tápala; para tomarla hiérvela 5 min o usa garrafón";
