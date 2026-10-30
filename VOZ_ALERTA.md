# Sed · Llamada de alerta (ElevenLabs)

Complemento del bot de WhatsApp. Si la consulta cae en **zona crítica**, Sed ofrece una llamada de voz que explica qué pasa y qué hacer. Se mantiene la respuesta por texto: la llamada es adicional y **solo ocurre con opt‑in**.

## 1. Agente (ya creado, verificado con `agents_get` el 30 oct 2026)
| Campo | Valor |
|---|---|
| Nombre | `[Sed] Alerta de agua (outbound)` |
| **agent_id** | `agent_9501m674z09mfptt3z954cmmfrbg` |
| Voz | Sofía `JYyJjNPfmNJdaby8LdZs` · TTS `eleven_v4_turbo` · idioma `es` |
| LLM | `claude-sonnet-5-5`, temp 0.3, backup `claude-haiku-5-5` → `gemini-2.5-flash`, zona `America/Mexico_City` |
| Duración máx. | 90 s (objetivo < 60 s) + mensaje de cierre al límite |
| Herramientas | `end_call` (cuelga tras despedida, rechazo o buzón) |
| Analítica | Criterios `llamada_completada`, `recomendacion_entendida` · datos `resultado_llamada` (completada/colgo_antes/rechazo_llamada/buzon_de_voz), `entendio_recomendacion`, `pidio_repetir` · resumen en español |
| Prompt | `voz/prompt_alerta.md` (copia exacta del que está en el agente) |

Primer mensaje: *"Hola, te habla Sed, el asistente de agua. Te llamo como pediste: en {{colonia}}, {{alcaldia}}, hay una alerta de agua."*

Reglas del prompt: se presenta como Sed y dice que es un asistente automático si se lo preguntan · siempre dice fuente y fecha · distingue **oficial** ("según SEGIAGUA…") de **estimado** ("estimamos… no es aviso oficial") · solo recomendaciones precautorias (guardar agua X días, hervir/no beber si hay aviso de calidad, pipa \*426, reportar a Locatel 0311 o WhatsApp) · nunca "apta para beber", "potable" ni "agua segura" · sin diagnósticos médicos · no inventa fechas · ofrece repetir · si `es_demo=true` dice "esta llamada fue una demostración" · si piden no ser llamados, se disculpa y cuelga.

### Variables dinámicas (todas como string)
| Variable | Ejemplo | Default en el agente |
|---|---|---|
| `nombre` | `"Daniel"` o `""` | `""` |
| `colonia`, `alcaldia` | `"CTM El Risco"`, `"Gustavo A. Madero"` | "tu colonia", "tu alcaldía" |
| `nivel` | `rojo` \| `ambar` | `rojo` |
| `motivo` | `corte programado` \| `fuga` \| `sin dato` \| `alerta de calidad` | `sin dato` |
| `dias_estimados` | texto hablado: `"unas 27 horas, hasta el viernes 30 de octubre a las 12 del día"`, `"2 a 3 días"` | `""` |
| `tipo_dias` | `oficial` \| `estimado` \| `sin_dato` (de `llegada.ts`) | `sin_dato` |
| `fuente`, `fecha_fuente` | `"SEGIAGUA, difundido por adn40"`, `"27 de octubre"` | "Sed", "hoy" |
| `aviso_calidad` | texto de `calidad.ts` o `""` | `""` |
| `es_demo` | `"true"` \| `"false"` | `"true"` (seguro por defecto) |

## 2. Número a usar
- **Usar `phnum_8701m5gat1j3f38s59jpfmdg2145` (+1 832 905 1749, "Sofía Outbound Neolabs")** como `agent_phone_number_id`. Es el número outbound; la API recibe `agent_id` en cada llamada, así que **no se reasignó nada** (sigue asignado a Sofía Devoluciones inbound).
- **No tocar** `phnum_5701m4vx6vvsfz1bn8bz4nzn4320` (+1 832 346 6398, "Demo KL Residences"): lo usa Sed para WhatsApp y está asignado al agente de Karl Lagerfeld Residences. Ni asignación ni webhook.
- ⚠️ Por validar: los docs no dicen si el número tiene que estar asignado al agente. Si la primera prueba falla por eso, **no reasignes sin el OK de Daniel** (rompería el inbound de Sofía Devoluciones). En ese caso, la alternativa es comprar o importar un número nuevo, con su aprobación.

## 3. Cómo dispara la llamada el backend
Endpoint (confirmado en los docs oficiales, `elevenlabs.io/docs/api-reference/twilio/outbound-call`):
```
POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
Headers: xi-api-key: $ELEVENLABS_API_KEY · Content-Type: application/json
Body: {
  "agent_id": "...", "agent_phone_number_id": "...", "to_number": "+52...",
  "conversation_initiation_client_data": { "dynamic_variables": { ... } },
  "telephony_call_config": { "ringing_timeout_secs": 30 }
}
→ 200 { success, message, conversation_id, callSid }
```

`.env`:
```
ELEVENLABS_API_KEY=            # backend only, never on the client
ELEVENLABS_AGENT_ID=agent_9501m674z09mfptt3z954cmmfrbg
ELEVENLABS_PHONE_NUMBER_ID=phnum_8701m5gat1j3f38s59jpfmdg2145
```

`app/api/voice-alert/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db"; // tables: whatsapp_contacts, voice_calls

type Vars = {
  nombre?: string; colonia: string; alcaldia: string; nivel: "rojo" | "ambar";
  motivo: "corte programado" | "fuga" | "sin dato" | "alerta de calidad";
  dias_estimados: string; tipo_dias: "oficial" | "estimado" | "sin_dato";
  fuente: string; fecha_fuente: string; aviso_calidad?: string; es_demo: boolean;
};

const BANNED = /apta para (beber|consumo)|agua (segura|potable)|es potable/i;

export async function POST(req: NextRequest) {
  // Internal only: called by the Twilio webhook after the user replies "SÍ".
  if (req.headers.get("x-internal-key") !== process.env.INTERNAL_KEY)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { to, vars } = (await req.json()) as { to: string; vars: Vars };

  // 1) Only numbers that wrote in before and accepted (opt-in).
  const c = await db.contact(to);
  if (!c?.lastInboundAt || !c.voiceOptIn) return NextResponse.json({ error: "no_opt_in" }, { status: 403 });
  // 2) Critical zone only.
  const critical = vars.nivel === "rojo" || vars.motivo === "corte programado" || vars.motivo === "alerta de calidad";
  if (!critical) return NextResponse.json({ error: "not_critical" }, { status: 422 });
  // 3) At most 1 call per number per hour.
  if (await db.callsSince(to, Date.now() - 3600_000) > 0)
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  // 4) Safety: never send potability claims to the voice.
  if (BANNED.test(JSON.stringify(vars))) return NextResponse.json({ error: "unsafe_text" }, { status: 422 });

  const dynamic_variables = {
    ...vars, nombre: vars.nombre ?? "", aviso_calidad: vars.aviso_calidad ?? "",
    es_demo: String(vars.es_demo),
  };
  const r = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: to,
      conversation_initiation_client_data: { dynamic_variables },
      telephony_call_config: { ringing_timeout_secs: 30 },
    }),
  });
  const data = await r.json().catch(() => ({}));
  // 5) Log every attempt.
  await db.logCall({ to, colonia: vars.colonia, nivel: vars.nivel, motivo: vars.motivo,
    es_demo: vars.es_demo, ok: r.ok && data.success, conversation_id: data.conversation_id ?? null,
    call_sid: data.callSid ?? null, error: r.ok ? null : JSON.stringify(data), at: new Date() });
  return NextResponse.json(data, { status: r.ok ? 200 : 502 });
}
```
Mock in tests (`vi.mock` of `fetch`): **no real calls in CI**.

## 4. Reglas de disparo
1. **Crítico** = semáforo rojo, **o** corte programado vigente, **o** alerta de calidad (incluye `[DEMO]`).
2. **Opt‑in por WhatsApp**: además de la respuesta normal, Sed agrega *"Zona crítica. ¿Te llamo para explicarte? Responde SÍ"*. Solo con "SÍ"/"SI" (≤10 min después) se llama. "NO" cancela y no se vuelve a ofrecer en 24 h. "NO LLAMES" lo bloquea para siempre (`voiceOptIn=false`).
3. **Máx. 1 llamada por número por hora**.
4. **Solo a números que escribieron antes** (`From` del webhook de Twilio). Nunca a listas ni a números tecleados a mano.
5. **Bitácora** `voice_calls(id, to, colonia, nivel, motivo, es_demo, ok, conversation_id, call_sid, error, at)`. Los resultados de la analítica se ven en ElevenLabs → Conversations.

## 5. Número para el demo
La llamada va al teléfono **del jurado o de Daniel que escribió al WhatsApp en vivo**: se usa su `From`. No se inventa ni se hardcodea ningún número. Plan B: Daniel escribe desde su celular y la llamada le entra a él, en altavoz.

## 6. Limitaciones
- El número es de EE. UU. (+1 832). Llamar a un celular de México **cuesta más** (tarifa internacional de Twilio) y puede aparecer como **desconocido o spam**, así que conviene avisar "te va a llamar un +1".
- Hay que **probarlo antes del demo** con el celular de Daniel. Revisa que Twilio tenga habilitados los permisos geográficos para México (Voice Geo Permissions) y que haya saldo. Ninguna de las dos cosas está verificada.
- El buzón de voz lo maneja el prompt (deja un mensaje de una frase). La detección de buzón por Twilio no está activada.
- La calidad del agua siempre se trata como precaución: la calidad de planta no es la calidad de la llave.

## 7. Ejemplo completo — CTM El Risco, GAM (corte oficial, caso real de `demo-cases.json`)
Reloj `DEMO_NOW = 2026-10-29 09:00 (CDMX)`. El aviso dice que el corte termina el 30 oct a las 12:00, o sea en ≈27 h.
```json
{
  "nombre": "", "colonia": "CTM El Risco", "alcaldia": "Gustavo A. Madero",
  "nivel": "rojo", "motivo": "corte programado",
  "dias_estimados": "unas 27 horas, hasta el viernes 30 de octubre a las 12 del día",
  "tipo_dias": "oficial",
  "fuente": "SEGIAGUA, aviso difundido por adn40",
  "fecha_fuente": "27 de octubre",
  "aviso_calidad": "", "es_demo": "true"
}
```
**Lo que se espera que diga** (≈40 s):
> "Hola, te habla Sed, el asistente de agua. Te llamo como pediste: en CTM El Risco, Gustavo A. Madero, hay una alerta de agua. Hay un corte programado por obras de rehabilitación, de 8 a 12 del día. Según SEGIAGUA, en un aviso difundido por adn40 el 27 de octubre, el corte termina en unas 27 horas, el viernes 30 a las 12 del día. Guarda agua limpia en recipientes tapados hasta entonces. Si necesitas, pide una pipa gratis al asterisco cuatro dos seis, y si sigues sin agua repórtalo a Locatel al cero tres uno uno. ¿Quieres que te lo repita? … Te mando el resumen por WhatsApp. Por cierto, esta llamada fue una demostración de Sed. ¡Cuídate!"

### Ejemplo B — `[DEMO]` Agrícola Oriental, Iztacalco (alerta de calidad, escenario ficticio)
```json
{ "nombre": "", "colonia": "Agrícola Oriental", "alcaldia": "Iztacalco", "nivel": "rojo",
  "motivo": "alerta de calidad", "dias_estimados": "", "tipo_dias": "sin_dato",
  "fuente": "escenario de demostración de Sed (no es un dato real)", "fecha_fuente": "hoy",
  "aviso_calidad": "posible exceso de azufre, olor a huevo; caso de demostración", "es_demo": "true" }
```
> "…En tu colonia hay un aviso de posible exceso de azufre, con olor a huevo. Es un escenario de demostración de Sed, no un dato real. No la bebas ni cocines con ella sin hervirla, y si huele a huevo o a químico, no la uses para beber aunque la hiervas. Repórtalo a Locatel al cero tres uno uno o respóndenos REPORTAR por WhatsApp. … Esta llamada fue una demostración de Sed."

## 8. Lo que Daniel tiene que confirmar
1. Poner `ELEVENLABS_API_KEY` en el backend (Vercel env). Nunca en el cliente ni en el repo.
2. Aceptar el texto del opt‑in y la regla de 1 llamada por hora.
3. El número de prueba: su celular, con una prueba real antes del demo, que la tiene que autorizar él. Revisar saldo de Twilio y Geo Permissions para México.
4. Que usar `+1 832 905 1749` (el outbound de Sofía) para Sed está bien.
