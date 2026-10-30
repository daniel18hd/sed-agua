// Intención del mensaje, pensada para cómo escribe la gente de verdad: sin acentos, sin autocorrector, fonético
// ("ke", "xq", "ai agua", "aguaaa", "rprtar", "colonya"). Reglas + distancia de edición primero; el LLM (opcional)
// solo clasifica en esta lista cerrada y nunca genera datos ni texto para el usuario.
export type TipoReporte = "sin_agua" | "baja_presion" | "mala_calidad";

export type Intent =
  | "consultar"          // consultar_zona: "hay agua?", "dime si hay agua"
  | "reportar"           // reportar_sin_agua / reportar_mala_calidad / baja presión
  | "calidad"            // preguntar_calidad: "y está buena?", "ke calidad tiene"
  | "cuando"             // preguntar_cuando_llega
  | "cambiar_direccion" | "repetir" | "ayuda" | "llamada"
  | "si" | "no" | "no_llames" | "saludo" | "gracias" | "opcion"
  | "otro"               // insulto, broma, fuera de tema → respuesta amable que redirige
  | "direccion";         // no es intención conocida → se intenta como dirección

/** Nombre del intent como lo pide el PRD (para /dev y la evaluación). */
export const INTENT_PRD: Record<Intent, string> = {
  consultar: "consultar_zona", reportar: "reportar", calidad: "preguntar_calidad", cuando: "preguntar_cuando_llega",
  cambiar_direccion: "cambiar_direccion", repetir: "repetir", ayuda: "ayuda", llamada: "llamada", si: "si", no: "no",
  no_llames: "llamada_no", saludo: "saludo", gracias: "gracias", opcion: "opcion", otro: "otro", direccion: "consultar_zona",
};

export interface IntentHit {
  intent: Intent;
  tipo?: TipoReporte;      // si el texto ya dice qué reporta
  opcion?: number;         // respuesta numérica 1–9
  seguro: boolean;         // false = coincidencia aproximada (typo fuerte) → se confirma antes de actuar
  lugar?: string;          // parte del texto que parece dirección ("mi colonya es agricola oriental" → "agricola oriental")
  texto: string;           // texto normalizado
}

// Escritura fonética / abreviaturas comunes → forma estándar (palabra completa).
const SUST: Record<string, string> = {
  ke: "que", k: "que", q: "que", qe: "que", xq: "porque", pq: "porque", porq: "porque", xk: "porque", pk: "porque",
  ai: "hay", ay: "hay", ahy: "hay", aiga: "haya", nmas: "nomas", ps: "pues", pss: "pues", pz: "pues", tmb: "tambien", tb: "tambien",
  dnd: "donde", kiero: "quiero", kieres: "quieres", aki: "aqui", toy: "estoy", sta: "esta", ta: "esta", bn: "bien",
  x: "por", d: "de", kuando: "cuando", kando: "cuando", cuado: "cuando", yega: "llega", yego: "llego", yegado: "llegado",
  colonya: "colonia", kolonia: "colonia", colnia: "colonia", clonia: "colonia", col: "colonia", awa: "agua", aguita: "agua", agia: "agua", aqua: "agua",
  kalidad: "calidad", calida: "calidad", calidaz: "calidad", vien: "bien", porfa: "por favor", xfa: "por favor", plis: "por favor",
  ola: "hola", wenas: "buenas", grax: "gracias", grasias: "gracias", gracia: "gracias", grcias: "gracias", thx: "gracias",
  orita: "ahora", ahorita: "ahora", hoi: "hoy", oy: "hoy", nel: "no", simon: "si", sip: "si", nop: "no", nope: "no",
};

export function norm(raw: string): string {
  let t = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\*/g, "");
  t = t.replace(/[^a-z0-9ñ\s]/g, " ").replace(/(.)\1{2,}/g, "$1").replace(/([aeiou])\1/g, "$1").replace(/\s+/g, " ").trim();
  return t.split(" ").map((w) => SUST[w] ?? w).join(" ");
}

/** Damerau-Levenshtein (transposiciones cuentan 1). */
export function dist(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const tol = (w: string) => (w.length <= 3 ? 0 : w.length <= 5 ? 1 : 2);
function fuzzy(words: string[], keys: string[]): number {
  let best = Infinity;
  for (const w of words) {
    if (w.length < 4) continue;
    for (const k of keys) { const d = dist(w, k); if (d <= tol(k) && d < best) best = d; }
  }
  return best;
}

const K_REPORTAR = ["reportar", "reporte", "reporta", "reportarlo", "denunciar", "queja", "reportando"];
const K_LLAMADA = ["llamame", "llamar", "llamada", "marcame", "hablame", "telefono"];
const K_AYUDA = ["ayuda", "ayudame", "help", "opciones", "instrucciones"];
const K_REPETIR = ["repetir", "repite", "repiteme", "resultado"];
const K_CALIDAD = ["calidad", "contaminada", "potable"];

const SI = new Set(["si", "claro", "ok", "okay", "va", "vale", "dale", "sale", "correcto", "afirmativo", "yes", "aja", "esa", "esa misma", "la misma", "esa mera", "ahi mismo", "misma",
  "si esa", "si por favor", "por favor", "andale", "si gracias", "exacto", "confirmo", "si es", "asi es", "si ahi", "si ahi mismo", "si sigo", "si sigo ahi", "sigo ahi", "la misma zona", "si llega", "si me llega", "si hay", "si tengo", "si es asi"]);
const NO = new Set(["no", "negativo", "cancelar", "cancela", "no gracias", "ninguno", "ninguna", "mejor no", "nada", "no llega", "no me llega", "no hay", "no tengo", "tampoco", "no es", "no es asi"]);
const SALUDO = /^(hola|holi|buen[oa]s?( dias| tardes| noches)?|hey|hi|hello|que onda|que tal|inicio|menu)( .{0,20})?$/;
const GRACIAS = /^(ok |va |listo |muy amable |muchas |mil )?(gracias|thanks|gracias por (todo|la info|tu ayuda))( .{0,25})?$/;
const INSULTO = /\b(pendej\w*|idiota|estupid\w*|chinga\w*|pinche|verga|mamad\w*|culer\w*|inutil|tont[oa]|no sirves|mierda|put[oa]|baboso)\b/;
const BROMA = /^(ja(ja)+|je(je)+|lol|xd+|jsjs\w*|v|na+h|cuentame un chiste|eres real|te quiero)$/;

// Prefijos que anuncian una dirección dentro de frases ("mi colonia es…", "vivo en…").
const PREF_LUGAR = /^(.*?\b)?(mi colonia es( la)?|vivo en( la)?|estoy en( la)?|soy de( la)?|en la colonia|colonia|en)\s+(.{4,})$/;

export function detectIntent(raw: string): IntentHit {
  const t = norm(raw);
  const out = (intent: Intent, x: Partial<IntentHit> = {}): IntentHit => ({ intent, seguro: true, texto: t, ...x });
  if (!t) return out("saludo");
  const words = t.split(" ");
  const l0 = t.match(PREF_LUGAR)?.[7]?.replace(/^(la|el|mi) /, "");
  const lugar = l0 && !/^(casa|mi casa|la casa|el trabajo|trabajo|chamba|zona|mi zona|la zona|el depa|depa|mi colonia|la colonia|colonia|ayer|la manana|la noche|todo el dia)\b/.test(l0) ? l0 : undefined;

  if (/^([1-9])$/.test(t) || /^(opcion|la|el|numero) ([1-9])$/.test(t)) return out("opcion", { opcion: Number(t.slice(-1)) });
  if (/^no (me )?(llames|marques|hables)( nunca| mas)?$/.test(t)) return out("no_llames");
  if (SI.has(t) || /^si( si)+$/.test(t)) return out("si");
  if (NO.has(t) || /^no( no)+$/.test(t)) return out("no");
  if (GRACIAS.test(t)) return out("gracias");
  if (SALUDO.test(t) && !/agua|reporta|calidad|cuando|colonia/.test(t)) return out("saludo");
  if (INSULTO.test(t) || BROMA.test(t)) return out("otro");
  if (/^(que (puedes hacer|haces|eres|es esto)|como funciona(s)?|como (te uso|se usa)|para que sirves)$/.test(t)) return out("ayuda");

  const corto = words.length <= 30; // audios transcritos y mensajes largos también cuentan
  if (/\b(otra|otro|nueva|cambiar( de)?|cambia)\s+(casa|direccion|colonia|lugar|ubicacion|domicilio|depa|departamento|oficina|trabajo|zona)\b/.test(t)
    || /^y (en )?(mi|la|el) (casa|oficina|trabajo|chamba|depa)\b/.test(t)) return out("cambiar_direccion");

  // Preguntas antes que reportes
  if (corto && (/\b(calidad|esta (buena|limpia|bien|contaminada)|es (buena|limpia|potable)|se puede (tomar|beber)|sale (limpia|bien)|potable|contaminad\w*|(la )?(puedo|podemos) (tomar|beber)|como (esta|sale|viene) el agua)\b/.test(t)
    || fuzzy(words, K_CALIDAD) <= 1)) return out("calidad", { lugar });
  if (corto && (/\bcuando\b.*\b(llega|regresa|vuelve|cae|hay|ponen|sale|mandan|termina|acaba)\b/.test(t) || /^(y )?(para )?cuando( llega| regresa| vuelve)?( el agua)?$/.test(t) || /\b(a que hora|que dia)\b.*\b(llega|regresa|vuelve|cae|ponen)\b/.test(t)))
    return out("cuando", { lugar });

  // Reportes con el tipo en la frase
  if (corto && /\b(poca presion|baja presion|sin presion|sale (muy )?poquit\w*|apenas (sale|cae)|chorrito|delgadito|no sube( al tinaco)?)\b/.test(t)) return out("reportar", { tipo: "baja_presion", lugar });
  if (corto && /\b(turbia|sucia|cafe|amarilla|negra|huele|olor|apesta|lodo|tierra|sabe (raro|feo|mal)|sale fea)\b/.test(t)) return out("reportar", { tipo: "mala_calidad", lugar });
  if (corto && /\b(no (hay|tengo|tenemos|llega|cae|sale|ha llegado|me llega|nos llega)( nada de| ni gota de)?( el)? agua|sin agua|se fue el agua|no (ha )?(llegado|caido) (el )?agua|llevamos .* sin|no tengo desde|no hay desde)\b/.test(t))
    return out("reportar", { tipo: "sin_agua", lugar });

  // Consultar abasto
  if (corto && /\b(hay agua|tienen agua|habra agua|si hay|dime si|como esta (mi zona|la zona|el servicio)|que onda con el agua|va a haber agua|hay servicio|hoy hay)\b/.test(t)) return out("consultar", { lugar });
  if (corto && /^(y )?((el|la) )?agua$/.test(t)) return out("consultar");

  if (/^(otra vez|de nuevo|como (quedo|salio)|que me dijiste|repite( por favor)?)$/.test(t)) return out("repetir");
  if (!corto) return out("direccion", { lugar });

  const dR = fuzzy(words, K_REPORTAR);
  // Exacto, o 1 typo en ≤2 palabras → seguro. Typo fuerte ("rprtar") o frase larga → se confirma (y antes se intenta geocodificar).
  if (dR === 0 || (dR === 1 && words.length <= 2)) return out("reportar");
  if (dR <= 2) return out("reportar", { seguro: false });
  if (fuzzy(words, K_LLAMADA) <= 1) return out("llamada");
  if (fuzzy(words, K_AYUDA) <= 1) return out("ayuda");
  if (words.length <= 3 && fuzzy(words, K_REPETIR) <= 1) return out("repetir");
  return out("direccion", { lugar });
}

const INTENTS: Intent[] = ["consultar", "reportar", "calidad", "cuando", "cambiar_direccion", "repetir", "ayuda", "llamada", "si", "no", "gracias", "otro", "direccion"];

/** Respaldo con LLM (INTENT_LLM=1 + OPENAI_API_KEY): solo devuelve una etiqueta de la lista; nunca texto para el usuario. */
export async function intentLLM(raw: string, contexto: string): Promise<Intent | null> {
  if (process.env.INTENT_LLM !== "1" || !process.env.OPENAI_API_KEY) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1200);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 6,
        messages: [
          { role: "system", content: `Clasifica el último mensaje de WhatsApp (español de México, con faltas de ortografía o transcrito de audio) en UNA etiqueta: ${INTENTS.join(", ")}. "direccion" = trae una dirección, colonia, CP o lugar. Usa el contexto de la conversación. Responde solo la etiqueta.\nContexto:\n${contexto}` },
          { role: "user", content: raw.slice(0, 400) },
        ],
      }),
    });
    const j = await r.json();
    const out = String(j?.choices?.[0]?.message?.content ?? "").trim().toLowerCase() as Intent;
    return INTENTS.includes(out) ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
