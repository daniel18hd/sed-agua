# Prompt inicial para Claude Code — Sed

Eres el ingeniero principal de **Sed**, demo de hackatón (CDMX, agua). Construye un monorepo Next.js listo para demo en vivo. Lee todo antes de escribir código. Trabaja por fases, y al cerrar cada una corre los checks de aceptación y reporta.

## Contexto en 5 líneas
- Pitch: "Tu llave no avisa. Sed sí: por WhatsApp te dice en segundos si hay agua en tu colonia, cuándo llega y si es segura."
- Un vecino escanea un QR → WhatsApp (Twilio) → manda dirección, CP o ubicación (SOLO texto/ubicación: sin fotos, sin visión) → geocodificamos → semáforo + cuándo llega + aviso de calidad → respondemos en ≤4 líneas.
- Honestidad dura: "cuándo llega" es OFICIAL solo con aviso con fecha fin; si no, ESTIMADO o "sin dato oficial". Azufre/sulfatos por colonia no existe en datos abiertos → solo `escenarios_demo` marcados [DEMO].
- Al mismo tiempo, una pantalla "OS" (globo 3D dark estilo osirisai.live) vuela al punto, enciende el contorno de la alcaldía con el color del semáforo, dibuja de dónde viene su agua y muestra un panel de datos con fuentes.
- La prioridad #1 es que el OS se vea premium y no se rompa con muchas consultas simultáneas.

## Insumos (cópialos al repo antes de empezar)
- `brain/` → `./brain/` (sin `raw_cache/`).
  - `brain/data/*.json|geojson`: datos empaquetados; cada uno trae `_meta` {fuente,url,fecha_corte,verificado}; índice en `brain/data/manifest.json`.
  - `brain/rules/semaforo.ts`: `evaluate(location, signals) -> {nivel, razones[], fuentes[], confianza, alerta_calidad, puntaje}`. Es pura; NO cambies umbrales sin avisar.
  - `brain/rules/llegada.ts`: `estimarLlegada({ahora, avisoOficial?, eventoSinFin?, horarioTandeo?, tandeo2019?}) -> {tipo:"oficial"|"estimado"|"sin_dato", …}`.
  - `brain/rules/calidad.ts`: `avisoCalidad({planta?, reportesCalidad24h?, demo?}) -> {origen:"planta"|"vecinos"|"demo", es_demo, texto, recomendacion} | null`.
  - `brain/rules/whatsapp.ts`: `buildReply(res, {lugar, llegada?, calidad?})` y `assertSafe(text)`.
  - `brain/rules/semaforo.test.ts`: 16 tests (semáforo, 4 respuestas: aviso oficial, estimado, calidad demo, sin dato). Pórtalos a vitest.
  - `brain/refresh/*.py` + `refresh_all.sh`: regeneran data. No los corras en runtime.
- `demo-cases.json` → `./brain/data/demo-cases.json`: 10 casos (8 "reportado en prensa", 2 "inferido por base histórica"), cada uno con `llegada`; `escenarios_demo[]` (2, `es_demo:true`: azufre en Agrícola Oriental, fuga sin fin en Sta. Úrsula); `_meta.ahora_demo`.
- `PRD.md`: fuente de verdad del producto.

Archivos clave de data:
- `alcaldias.simplified.geojson`: 16 polígonos, props `cve_mun, nombre, label_lat, label_lon, bbox`.
- `colonias.simplified.geojson`: 1,543 colonias, solo servidor.
- `sequia_alcaldias.json`, `cutzamala_latest.json`, `calidad_los_berros.json`, `lluvia_7d_alcaldia.json`, `vulnerabilidad_inegi_alcaldia.json`, `tandeo_2019_alcaldia.json`, `reportes_historicos_alcaldia.json`, `abastecimiento_alcaldia.json`, `ruta_agua.geojson`.
- Todo indexado por `cve_mun` ("002"…"017").

## Stack (no lo cambies)
- Next.js (App Router) + TypeScript + Tailwind, deploy en Vercel.
- **MapLibre GL JS v5** con `projection: { type: 'globe' }` + **deck.gl** vía `@deck.gl/mapbox` `MapboxOverlay({interleaved:true})` (TripsLayer, PathLayer, ScatterplotLayer).
- Supabase (Postgres + **Realtime postgres_changes**).
- `twilio` SDK (firma + TwiML), `@turf/boolean-point-in-polygon`.
- Basemap: `NEXT_PUBLIC_MAP_STYLE` (default CARTO Dark Matter GL `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`, con atribución). Toggle MAP/SAT; SAT es raster configurable en `NEXT_PUBLIC_SAT_TILES`. Si falta, oculta el toggle.

## Env vars (`.env.example`)
```
TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_WHATSAPP_NUMBER=   # Daniel confirma cuál número; NO compres otro
NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GEOCODING_API_KEY=        # opcional; sin key → Nominatim (1 req/s, User-Agent propio, solo demo)
PHONE_HASH_SALT= NEXT_PUBLIC_MAP_STYLE= NEXT_PUBLIC_SAT_TILES= OPENAI_API_KEY=  # LLM opcional
PUBLIC_BASE_URL=                 # para validar firma Twilio detrás de ngrok/Vercel
DEMO_NOW=                        # opcional: reloj de demo (p. ej. 2026-10-29T09:00-06:00); vacío = hora real
```

## Mocks si algo falta (la app SIEMPRE arranca)
- Sin Supabase → bus en memoria + `BroadcastChannel` entre pestañas; mismo `EventSource` interface.
- Sin Twilio → `POST /api/dev/simulate` con `{Body, Latitude, Longitude, From}` y una consola `/dev` que muestra la respuesta.
- Sin geocoding key → Nominatim; si falla → match por nombre de colonia en `colonias.simplified.geojson`.
- `/os?mock=1` → reproduce `demo-cases.json`, uno cada 4 s; `?burst=5` dispara 5 a la vez.
- Sin LLM → `buildReply` determinista (es el default).

## Fase 1 — Esqueleto + brain (aceptación: `pnpm test` verde, `/api/evaluate?lat=19.386&lon=-99.143` responde)
1. Inicializa el repo y copia los insumos.
2. `lib/brain.ts`: carga los JSON una vez (singleton en memoria) y expone:
   - `locate(lat,lon) -> {cve_mun, alcaldia, cve_col?, colonia?}`, con point-in-polygon y prefiltrado por bbox.
   - `signalsFor(loc, now, reportes24h, corteOficial?) -> Signals` (`reportes24h = {sin_agua, calidad}` vecinos únicos).
   - `llegadaFor(loc, now)` → arma el input de `estimarLlegada` desde `demo-cases.json` (`ventana_oficial` → avisoOficial) y `escenarios_demo` (`evento_sin_fin_demo` → eventoSinFin).
   - `calidadFor(loc, signals)` → `avisoCalidad` con planta (si Cutzamala), reportes de calidad y `alerta_calidad_demo` si la colonia está en `escenarios_demo`.
   - `now` = `DEMO_NOW` si existe; si no, hora real.
3. Reglas de `signalsFor`:
   - Sequía: `sequia_alcaldias.json` (`categoria` null = sin sequía).
   - Cutzamala: `pct` de `cutzamala_latest.json`, y `aplica` = `abastecimiento_alcaldia.json[cve].cutzamala`.
   - Lluvia: `lluvia_7d_alcaldia.json`.
   - Vulnerabilidad:
     - `colonia_tandeo_2019`: nombre normalizado de colonia ∈ `tandeo_2019_alcaldia.json[cve].colonias_tandeo`.
     - `pct_sin_agua_entubada`: INEGI.
     - `reportes_hist_sobre_p75`: reportes históricos.
   - `calidadPlanta`: `calidad_los_berros.json.ultimo.parametros_fuera_de_norma`, solo si la alcaldía es Cutzamala.
   - `corteOficial`: si el punto cae en la colonia de un demo-case con `ventana_oficial` vigente.
   - Cada `Fuente` = {nombre, fecha: `_meta.fecha_corte`, url}.
4. `GET /api/evaluate` devuelve `{loc, resultado, llegada, calidad, reply}`.

## Fase 2 — WhatsApp (aceptación: "Hola" → pide dirección; dirección → respuesta ≤4 líneas en <6 s; ubicación funciona)
`POST /api/twilio/webhook` (runtime nodejs):
1. Valida `X-Twilio-Signature` con `twilio.validateRequest` usando `PUBLIC_BASE_URL + path`. Si es inválida → 403. Si estás en dev sin token, sáltala con un warning.
2. `phone_hash = sha256(From + PHONE_HASH_SALT)`. Lee o crea `sesiones`.
3. Router:
   - Saludo o vacío → "Hola 👋 Mándame tu dirección (calle, colonia, alcaldía) o comparte tu ubicación 📍".
   - `Latitude`/`Longitude` presentes → úsalos directo.
   - Texto → si es CP (`^\d{5}$`) geocode `postal_code` + CDMX; si no, dirección con `components=country:MX` y bounds CDMX (19.04,-99.37 / 19.60,-98.94), timeout 2.5 s.
   - `NumMedia>0` (imagen/audio) → "Por ahora solo leo texto o ubicación 📍". No descargues media, no uses visión.
   - Fuera de CDMX → "Por ahora solo cubro CDMX. ¿Me pasas otra dirección?".
   - "REPORTAR" → "Responde 1 Sin agua · 2 Agua turbia/olor · 3 Fuga". La siguiente respuesta (solo texto) inserta en `reportes` y responde "Gracias, quedó registrado 🙌. Cada reporte hace más inteligente el mapa".
4. Con punto: `locate` → `signalsFor` (reportes 24 h contados en Supabase por colonia, si no por alcaldía; únicos por phone_hash) → `evaluate` + `llegadaFor` + `calidadFor` → `buildReply(res, {lugar: "Colonia, Alcaldía", llegada, calidad})` → `assertSafe`.
5. Inserta en `consultas` y responde con TwiML `<Response><Message>…</Message></Response>`. Todo en <5 s; si el geocode se pasa, contesta "Dame un segundo…" y envía el resultado con REST `messages.create`.
6. **LLM (opcional, flag):** solo puede reformular el JSON de `evaluate()` en el mismo formato. Prompt cerrado: sin datos nuevos y sin afirmar potabilidad. Pasa por `assertSafe`; si falla, usa `buildReply`.

Reglas de texto duras:
- Máx 4 líneas: semáforo · cuándo llega · calidad o razones · "Fuente: X (YYYY-MM-DD)" + 1 acción.
- Estimado siempre con "ESTIMADO (no oficial)". Escenario demo siempre con "[DEMO]" y "Fuente: caso de demostración".
- Recomendaciones solo precautorias (no beber / hervir / pipa *426 / reportar).
- Acciones: pipa gratis *426 (Línea H2O), Locatel *0311, o *REPORTAR*.
- **Nunca** "apta para beber" ni "es potable". Los Berros = calidad a la salida de planta, no en la llave.
- Nunca afirmes "hoy no hay agua" sin fuente. Usa "reportado el <fecha>".

## Fase 3 — Supabase (aceptación: insert en `consultas` aparece en `/os` en <1 s)
`supabase/migrations/0001_init.sql`:
- `consultas`: id uuid pk default gen_random_uuid(), created_at timestamptz default now(), phone_hash text, canal text, texto text, lat float8, lon float8, geo_fuente text, cve_mun text, alcaldia text, cve_col text, colonia text, nivel text, resultado jsonb, demo bool default false.
- `reportes`: id, created_at, phone_hash, tipo text check in ('sin_agua','turbia','fuga'), lat, lon, cve_mun, cve_col. Sin columnas de media.
- `sesiones`: phone_hash pk, estado text, updated_at.
- Índices `(cve_col, created_at)`, `(cve_mun, created_at)`.
- Agrega `consultas` y `reportes` a la publicación `supabase_realtime`.
- RLS: anon puede `select` solo la vista `consultas_publicas` (sin phone_hash ni texto). Escritura solo service role.

Cliente: `channel('os').on('postgres_changes',{event:'INSERT',schema:'public',table:'consultas'},…)`, con reconexión y backfill de los últimos 2 min al montar.

## Fase 4 — OS (lo más importante; aceptación abajo)
Ruta `/os`: pantalla completa, sin scroll, 1920×1080 primero.

**Look (referencia osirisai.live: dark, HUD, MAP/SAT)**
- Fondo #05070b, globo con atmósfera (`setSky`/fog de MapLibre v5) y halo azul tenue.
- Paneles glass: bg rgba(10,14,22,.72), backdrop-blur 12px, borde 1px rgba(148,163,184,.18), radio 14.
- Tipografía: Inter para títulos y JetBrains Mono para datos.
- Colores: verde #22c55e, ámbar #f59e0b, rojo #ef4444, gris #64748b, acento cian #38bdf8.
- HUD:
  - Arriba-izq: "SED // CDMX WATER OS", reloj America/Mexico_City y status LIVE.
  - Arriba-der: MAP/SAT, contador de consultas y botón "Demo" (que dispara mock).
  - Abajo-izq: ticker de últimas consultas.
  - Derecha: panel de detalle.
  - Abajo-der: QR (imagen de `public/qr.png`).
- Idle: globo con rotación lenta (bearing += 0.02°/frame) centrado en México. Las 16 alcaldías en contorno gris tenue.

**Secuencia por consulta** (máquina de estados en un `useRef`, no `useState` por frame):
1. Si zoom<6: `flyTo` CDMX {center:[-99.13,19.40], zoom:9, pitch:40, duration:1800}.
2. `flyTo` punto {zoom:13.5, pitch:55, bearing:-20…20 aleatorio, duration:2200, essential:true, curve:1.6}. ScatterplotLayer con pulso, radio animado con `transitions`.
3. Alcaldía:
   - feature-state `{nivel}` → paint expressions de una sola fuente `alcaldias`: line color por nivel, line-width 3.
   - Glow = segunda capa line con blur 6 y opacity 0.6; fill opacity 0.12. Fade 600 ms vía `*-transition`.
4. Ruta: `ruta_agua.geojson` filtrada por `cve_mun` → TripsLayer.
   - Timestamps generados por distancia acumulada, trailLength alto, color cian→nivel, 2.5 s, `requestAnimationFrame` único.
   - Etiqueta flotante "ruta aproximada". Nodos (presas, Los Berros) como puntos con label.
   - Para la ruta Cutzamala, haz un zoom-out breve (`fitBounds` de la ruta, 1.5 s) y regresa al punto, solo en modo single.
5. Panel con stagger de 60 ms por fila:
   - nivel + confianza, razones
   - **cuándo llega** con badge OFICIAL (verde) / ESTIMADO (ámbar) / SIN DATO (gris)
   - **calidad** con badge PLANTA / VECINOS / CASO DE DEMOSTRACIÓN (magenta, visible a 3 m)
   - sequía (categoría + fecha)
   - Cutzamala % (+ por presa)
   - Los Berros "salida de planta: dentro de norma" o los parámetros fuera
   - lluvia 7 d
   - INEGI % sin agua entubada, tandeo 2019
   - reportes 24 h e históricos
   - abastecimiento (con badge "por validar")
   - fuentes con fecha y link
   - Si es demo-case: `frase` + fuente de prensa.
6. Toast con el texto WhatsApp enviado.

**Concurrencia (requisito duro)**
- Todos los eventos entran a `AnimationQueue`.
- Debounce 400 ms: agrupa lo que llega junto.
- Nunca llames `flyTo` si hay un movimiento activo: espera `map.once('moveend')`. Máx 1 cámara activa.
- ≥2 eventos en ventana de 10 s → **modo multi-punto**:
  - `fitBounds` de los últimos ≤8 puntos en 2 min {padding:120, maxZoom:12, duration:1500}.
  - Todas sus alcaldías encendidas y rutas en paralelo (una sola TripsLayer con N trips).
  - El panel muestra lista compacta y rota detalle cada 3 s.
- Después de 10 s sin eventos nuevos, vuelve a single con el último. A los 60 s idle → globo.
- Cola máx 20: si se excede, descarta animaciones viejas pero pinta todos los puntos.
- Puntos persistentes 10 min con fade por edad.

**Performance (aceptación: 60 fps en Chrome Performance durante burst=5)**
- Carga inicial: estilo + `alcaldias.simplified.geojson` (22 KB). Nunca colonias en cliente.
- deck.gl y TripsLayer con `next/dynamic` al primer evento. Datos del panel vía `/api/brain/summary` cacheado (revalidate 3600).
- Una sola fuente GeoJSON por capa; actualiza con `setFeatureState` / `setData`, no recrees capas.
- Sin re-render React por frame. Memoiza layers. Respeta `devicePixelRatio` ≤2.
- Lighthouse en `/os`: TTI < 2.5 s en laptop.

**Aceptación Fase 4**
- `/os?mock=1` corre los 10 casos + 2 escenarios demo sin errores en consola; los demo muestran su badge.
- `?burst=5` entra a multi-punto sin saltos de cámara.
- Cada dato en el panel tiene fuente+fecha.
- La ruta dice "aproximada".
- El color del contorno coincide con `resultado.nivel`.

## Fase 5 — Demo polish
- `/dev`: simulador de WhatsApp (input dirección/CP o lat/lon, botones de los 10 demo-cases + 2 escenarios, selector de reloj `DEMO_NOW`) y log de respuestas.
- `public/qr.png`: genéralo desde `TWILIO_WHATSAPP_NUMBER` con un script `scripts/qr.ts` → `https://wa.me/<numero_sin_+>?text=Hola`. El `qr-demo.png` actual es placeholder.
- README con setup Twilio:
  - Sender existente: Console → Messaging → Senders → WhatsApp senders → número → webhook POST `https://<app>/api/twilio/webhook`. Anota el webhook anterior para restaurarlo.
  - Sandbox (plan B): +14155238886, `join <palabra>`, sesión de 3 días. Webhook en Sandbox settings.
  - `ngrok http 3000` para local.
- Modo offline: si falla la red, `/os?mock=1` sigue funcionando con data local.

## Reglas de trabajo
- No inventes datos ni fuentes. Si falta algo, deja `TODO(dato)` y muéstralo como "sin dato".
- Etiqueta en UI todo lo marcado en `_meta.verificado` como "POR VALIDAR" o "APROXIMADA".
- Casos "inferido por base histórica" ≠ "reportado en prensa" ≠ "caso de demostración": badge distinto.
- Nunca presentes un estimado como oficial ni digas "apta para beber"/"es potable"; planta ≠ llave.
- El look dark/globo es requisito de UI; no lo metas en textos de producto ni en el bot.
- No compres números ni mandes mensajes reales en tests. Mockea `twilio` en vitest.
- Commits pequeños por fase; al final de cada fase lista qué quedó, cómo probarlo y qué falta.

## Fase 6 — Llamada de alerta (opcional, voz ElevenLabs)
Detalle completo en `VOZ_ALERTA.md`. El agente ya existe; no lo crees ni lo modifiques.
- Env: `ELEVENLABS_API_KEY` (solo server), `ELEVENLABS_AGENT_ID=agent_9501m674z09mfptt3z954cmmfrbg`, `ELEVENLABS_PHONE_NUMBER_ID=phnum_8701m5gat1j3f38s59jpfmdg2145`. Nunca uses ni toques `phnum_5701m4vx6vvsfz1bn8bz4nzn4320` (KL/WhatsApp).
- `lib/voice/vars.ts` → `buildVoiceVars(resultado, llegada, calidad, nombre?)` devuelve **strings**: nombre, colonia, alcaldia, nivel (rojo|ambar), motivo (corte programado|fuga|sin dato|alerta de calidad), dias_estimados (texto hablado; <48 h en horas), tipo_dias (oficial|estimado|sin_dato), fuente, fecha_fuente, aviso_calidad, es_demo ("true"/"false"). Reusa `assertSafe`.
- `isCritical(r)` = nivel rojo || corte programado vigente || alerta de calidad (incluye [DEMO]).
- En el webhook WhatsApp, si es crítico agrega la línea: "Zona crítica. ¿Te llamo para explicarte? Responde SÍ". Guarda `pending_call(from, vars, exp=10 min)`.
  - "SÍ"/"SI" → POST interno a `/api/voice-alert`; responde "Te llamo en unos segundos 📞".
  - "NO" → cancela, no vuelvas a ofrecer en 24 h. "NO LLAMES" → `voiceOptIn=false` permanente.
- `app/api/voice-alert/route.ts` (snippet en VOZ_ALERTA.md §3):
  - Guards: header interno, el número escribió antes y aceptó, crítico, ≤1 llamada/número/hora, regex sin "apta para beber|agua segura|potable".
  - `POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call`, header `xi-api-key`, body `{agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data:{dynamic_variables}}`.
  - Loguea en `voice_calls` (to, colonia, nivel, motivo, es_demo, ok, conversation_id, call_sid, error, at).
- `to_number` = siempre el `From` del WhatsApp. Nunca hardcodees ni inventes números.
- `/dev`: botón "Simular llamada" que muestra el JSON de variables y **no** llama (dry-run por defecto; `VOICE_DRY_RUN=1`).
- Tests (vitest, `fetch` mockeado, cero llamadas reales):
  - CTM El Risco @ DEMO_NOW → tipo_dias oficial, "27 horas".
  - [DEMO] azufre → motivo "alerta de calidad", es_demo "true".
  - Rate limit → 429. Sin opt-in → 403. Verde → 422.
- **Aceptación**: la llamada real solo se prueba con el celular de Daniel y su OK. En `/os` se ve un badge 📞 en el evento cuando se dispara.
