// "¿De dónde viene mi agua?" – función PURA. Fuente: abastecimiento_alcaldia.json (curado de prensa, POR VALIDAR).
// Siempre es aproximado: no hay dataset oficial de sistema por colonia. El OS lo etiqueta "ruta aproximada".

export interface OrigenAgua {
  sistema: string;          // "Cutzamala", "Chalmita", "La Caldera", "pozos locales"
  nodo: string | null;      // id del nodo en ruta_agua.geojson donde inicia la ruta (null = pozos locales, sin ruta)
  nombre: string;           // lo que se ilumina en el mapa: "Presa Valle de Bravo"
  planta?: string;          // planta potabilizadora con medición pública (solo Cutzamala → Los Berros)
  texto: string;            // para WhatsApp: "Viene del Cutzamala · planta Los Berros"
  aproximado: true;
}

export interface AbastAlcaldia { cutzamala: boolean; sistemas: string[] }

export function origenDe(a: AbastAlcaldia | undefined): OrigenAgua {
  const s = (a?.sistemas ?? []).join(" | ");
  if (a?.cutzamala)
    return { sistema: "Cutzamala", nodo: "presa_valle_de_bravo", nombre: "Presa Valle de Bravo", planta: "Los Berros", texto: "Viene del Cutzamala · planta Los Berros", aproximado: true };
  if (/chalmita/i.test(s))
    return { sistema: "Chalmita", nodo: "norte_chalmita", nombre: "Tanques Chalmita", texto: "Viene de pozos locales y tanques Chalmita", aproximado: true };
  if (/caldera/i.test(s))
    return { sistema: "La Caldera", nodo: "oriente_la_caldera", nombre: "Acueducto La Caldera", texto: "Viene de pozos locales y acueducto La Caldera", aproximado: true };
  if (/manantial/i.test(s))
    return { sistema: "pozos locales", nodo: null, nombre: "Pozos y manantiales locales", texto: "Viene de pozos y manantiales locales", aproximado: true };
  return { sistema: "pozos locales", nodo: null, nombre: "Pozos locales", texto: "Viene de pozos locales", aproximado: true };
}
