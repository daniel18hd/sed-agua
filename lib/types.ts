// Tipos compartidos cliente/servidor (sin imports de node).
import type { Resultado, Signals, Nivel } from "@/brain/rules/semaforo.ts";
import type { Llegada } from "@/brain/rules/llegada.ts";
import type { AvisoCalidad } from "@/brain/rules/calidad.ts";

export type { Resultado, Signals, Nivel, Llegada, AvisoCalidad };

export interface CasoInfoPub {
  id: string;
  tipo: "reportado en prensa" | "inferido por base histórica";
  frase: string;
  descripcion: string;
  fecha: string;
  nota_fecha?: string;
  fuentes: { medio: string; url: string }[];
}

/** Lo que el OS recibe por Realtime/SSE. Sin phone_hash ni texto. lat/lon redondeados (~110 m). */
export interface ConsultaPublica {
  id: string;
  created_at: string;
  canal: "whatsapp" | "dev" | "mock" | "api";
  lat: number;
  lon: number;
  geo_fuente: "ubicacion" | "direccion" | "cp" | "colonia" | "demo";
  cve_mun: string;
  alcaldia: string;
  cve_col: string | null;
  colonia: string | null;
  nivel: Nivel;
  demo: boolean;
  resultado: {
    resultado: Resultado;
    llegada: Llegada;
    llegada_demo: boolean;
    calidad: AvisoCalidad | null;
    reply: string;
    signals: Signals;
    caso?: CasoInfoPub;
    escenarios?: { id: string; etiqueta: string; por_que: string }[];
    ahora: string;
    coord_nota?: string;
  };
}

export const redondea = (x: number) => Math.round(x * 1000) / 1000;
