# Sed — ¿hoy hay agua? (CDMX)

> Tu llave no avisa. Sed sí: por WhatsApp te dice en segundos si hay agua en tu colonia, cuándo llega y si hay un aviso de calidad.

Monorepo Next.js (App Router) + MapLibre GL v5 (globo) + deck.gl + Supabase Realtime + Twilio. Producto: [`PRD.md`](PRD.md). Datos y reglas: [`brain/README.md`](brain/README.md).

## Arranque rápido (sin cuentas)

```bash
pnpm install
cp .env.example .env.local     # todo opcional para arrancar
DEMO_NOW=2026-10-29T09:00-06:00 pnpm dev
```

| URL | qué |
|---|---|
| `/os` | pantalla OS (1920×1080). Escucha Realtime (Supabase) o el bus local (SSE) |
| `/os?mock=1` | reproduce los 10 casos + 2 escenarios demo, uno cada 4 s (sin Twilio ni Supabase) |
| `/os?mock=1&every=12` | igual, pero espaciado para ver la secuencia cinematográfica completa (con < 10 s entre eventos entra a multi-punto, como pide la spec) |
| `/os?burst=5` | 5 consultas a la vez → modo multi-punto |
| `/dev` | simulador de WhatsApp: texto, CP, ubicación, imagen, REPORTAR, botones de los 12 casos y reloj `DEMO_NOW` |
| `/api/evaluate?lat=19.386&lon=-99.143` | evaluación cruda (`?demo=1` aplica escenarios, `?now=ISO` cambia el reloj) |

Atajos en `/os`: **D** demo on/off · **B** ráfaga ×5 · **I** volver al globo · **S** MAP/SAT.

## Tests

```bash
pnpm test          # vitest: 16 tests originales del brain + locate/señales/casos demo + bot/webhook (Twilio mockeado)
pnpm test:brain    # los 16 tests originales con node --test
pnpm typecheck
```

## Supabase

1. Crea un proyecto y corre `supabase/migrations/0001_init.sql` (SQL editor o `supabase db push`).
2. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. El webhook escribe con service role en `consultas`; un trigger copia a **`consultas_publicas`** (sin `phone_hash` ni `texto`, lat/lon redondeados a ~110 m). El OS escucha `postgres_changes` INSERT de esa tabla y al conectar/reconectar hace backfill de los últimos 2 min.
   - Es tabla y no vista porque Realtime no emite cambios de vistas y, con RLS, el anon no recibiría los INSERT de `consultas`.

Sin Supabase todo cae a memoria: el OS usa `/api/stream` (SSE) + `BroadcastChannel` entre pestañas. En Vercel serverless ese bus solo vive mientras la función esté caliente: **para la demo en Vercel usa Supabase o `?mock=1`**.

## Twilio (WhatsApp)

Daniel confirma el número → `TWILIO_WHATSAPP_NUMBER`. **No compres otro.**

- **Sender existente:** Console → Messaging → Senders → WhatsApp senders → el número → *Webhook URL for incoming messages* = `https://<app>/api/twilio/webhook` (POST). **Anota el webhook anterior para restaurarlo** después del hackatón.
- **Sandbox (plan B):** `+14155238886`, cada persona manda `join <palabra>`, sesión de 3 días, 1 msg/3 s. Webhook en *Sandbox settings → When a message comes in*.
- **Local:** `ngrok http 3000` → pon la URL en el webhook y en `PUBLIC_BASE_URL` (la firma `X-Twilio-Signature` se valida contra `PUBLIC_BASE_URL + path`). Sin `TWILIO_AUTH_TOKEN` la firma se salta con warning (solo dev).
- Responde por TwiML en < 5 s; si la geocodificación se pasa de 4.2 s contesta "Dame un segundo…" y manda el resultado por REST (`messages.create`) dentro de `after()`.

## QR

```bash
TWILIO_WHATSAPP_NUMBER=+5215512345678 pnpm qr   # → public/qr.png → https://wa.me/5215512345678?text=Hola
```
Mientras no exista `public/qr.png`, el OS muestra `qr-demo.png` con la etiqueta "QR placeholder".

## Setup pendiente de datos

- **U.H. Hacienda de las Flores** (caso 3) no trae coordenada. Con red: `pnpm geocode:demo` la geocodifica, valida que caiga en Iztapalapa y reescribe `brain/data/demo-cases.json`. Mientras tanto el mock usa el punto de etiqueta de Iztapalapa con badge **APROXIMADA**.
- `brain/refresh/*.py` regeneran los datos (no se corren en runtime).

## Env vars

Ver `.env.example`. Notas:
- `DEMO_NOW=2026-10-29T09:00-06:00` mantiene vigente el aviso oficial de CTM El Risco (fin 30-oct 12:00). Con la hora real, el aviso vencido se reporta como vencido.
- `DEMO_SCENARIOS=1` hace que los escenarios [DEMO] (azufre en Agrícola Oriental, fuga sin fin en Sta. Úrsula) apliquen también a tráfico real de WhatsApp. Sin él solo aplican en `/dev`, `?mock=1` y `?demo=1`.
- `LLM_REPLY=1` + `OPENAI_API_KEY`: reformula la respuesta (prompt cerrado, 1.5 s máx.). Si cambia cifras, quita marcas `[DEMO]`/`ESTIMADO`/`Fuente:` o falla `assertSafe`, se usa `buildReply`.
- `DEV_KEY`: si existe, `/api/dev/simulate` exige `?key=` (abre `/dev?key=...`).
- `NEXT_PUBLIC_SAT_TILES` vacío oculta el toggle MAP/SAT. Revisa términos del proveedor (ESRI World Imagery, MapTiler…).
- Si el estilo del mapa no carga en 4 s (Wi-Fi del venue), el OS usa un estilo offline local (tierra y fronteras Natural Earth 110m) y lo indica en el HUD.

## Llamada de alerta (Fase 6, ElevenLabs)

Detalle en [`VOZ_ALERTA.md`](VOZ_ALERTA.md); prompt del agente en `voz/prompt_alerta.md` (el agente ya existe, no se modifica).
- Si la consulta es **crítica** (rojo, corte programado vigente o alerta de calidad, incluida [DEMO]), WhatsApp manda un **segundo mensaje**: "Zona crítica. ¿Te llamo para explicarte? Responde SÍ" (así la respuesta principal sigue en ≤ 4 líneas).
- "SÍ"/"SI" en ≤ 10 min → `triggerVoiceAlert` → `POST api.elevenlabs.io/v1/convai/twilio/outbound-call` al mismo `From`. "NO" → no se ofrece en 24 h. "NO LLAMES" → nunca.
- Guardas: opt-in, crítico, ≤ 1 llamada real por número por hora, regex sin potabilidad, nunca `phnum_5701…` (KL).
- **Dry-run por defecto**: sin `VOICE_DRY_RUN=0` + `ELEVENLABS_API_KEY` no se marca a nadie (bitácora `voice_calls` con `dry_run=true`, badge 📞 "PRUEBA" en el OS).
- `/dev`: botón 📞 por caso muestra las variables dinámicas sin llamar; botones SÍ / NO.
- Supabase: corre también `supabase/migrations/0002_voz.sql`.

## Arquitectura

```
WhatsApp → Twilio → POST /api/twilio/webhook  (lib/bot.ts: router; mismo código que /api/dev/simulate)
  ├ firma → phone_hash = sha256(From + salt) → sesiones
  ├ texto → colonia del catálogo (sin red) | Google | Nominatim (1 req/s) ; ubicación → directo
  ├ lib/brain.ts: locate (bbox + point-in-polygon) → signalsFor → evaluate + estimarLlegada + avisoCalidad → buildReply
  ├ insert consultas (service role) ──trigger──► consultas_publicas ──Realtime──► /os
  └ TwiML <Message>
/os: components/os/engine.ts (MapLibre globo + deck.gl interleaved, AnimationQueue, 1 cámara activa, single/multi/idle, rAF único)
     components/os/OS.tsx (HUD, panel, ticker, toast; React solo re-renderiza por evento, no por frame)
```

Reglas duras (tests): ≤ 4 líneas; "ESTIMADO (no oficial)" en todo estimado; `[DEMO]` + "Fuente: caso de demostración" en escenarios; nunca "apta para beber"/"es potable" (Los Berros = salida de planta, no tu llave); nunca "hoy no hay agua" sin fuente.
