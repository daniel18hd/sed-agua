# Sed — PRD (hackatón)

> **Tu llave no avisa. Sed sí:** por WhatsApp te dice en segundos si hay agua en tu colonia, cuándo llega y si es segura.

## 1. La historia
En México, millones de personas viven con una pregunta que nadie les contesta: **¿hoy hay agua?**
Familias que cargan cubetas, que pagan una pipa sin saber si el agua llegará mañana, que se enteran de un corte cuando abren la llave y no sale nada.
El gobierno publica datos de presas, sequía y lluvia, pero esa información no le sirve a una mamá a las 6 am. Nadie le dice, en su colonia y en tiempo real, qué esperar.

**En números (verificados, CDMX):**
- 172,967 reportes de "Falta de agua" a SACMEX en poco más de 2 años (ene-2022 a feb-2024, Datos CDMX).
- 273 colonias con tandeo registradas (2019, Datos CDMX/SACMEX).
- ≥20,736 viviendas sin agua entubada dentro de la vivienda (INEGI 2020; es un mínimo).
- Hoy el Cutzamala está al 95.12% (CONAGUA, 26-oct-2026) y ninguna alcaldía está en sequía (SMN, 15-oct-2026). Aun así hubo bloqueos por agua en Vallejo (2-oct), Benito Juárez (15-oct) e Iztapalapa, por agua turbia con gusanos (28-oct). Las presas llenas no garantizan agua en tu llave.

## 2. Qué es Sed
**Un número de WhatsApp.** Mandas tu dirección, tu código postal o tu ubicación 📍. En segundos te responde con:
- **Semáforo** de tu zona (verde, ámbar, rojo), con fuente y fecha.
- **Cuándo llega el agua**: si hay aviso oficial, "Corte programado hasta 30 oct 12:00". Si no lo hay, un rango marcado **ESTIMADO** o "sin dato oficial".
- **Aviso de calidad** cuando hay señal (planta fuera de norma o vecinos reportando agua turbia u olor), con qué hacer: hervir, no beber, pedir pipa al *426 o reportar.

Sin app, sin registro, sin fotos. Solo texto o ubicación.

**Por qué importa**
- La gente deja de adivinar, organiza su día, ahorra en pipas y protege su salud.
- Alcaldías y organismos ven en vivo un panel de zonas críticas.

**Qué nos hace distintos**
- Somos los primeros en cruzar **reportes vecinales** (un dato que no está en ningún portal) con **fuentes oficiales al día**: CONAGUA, SMN, SEGIAGUA, INEGI y Datos CDMX. Cada reporte hace más inteligente el mapa.
- **Confiable por diseño:** el texto sale solo de datos calculados, siempre con fuente y fecha, y nunca dice "apta para beber".

**Equipo:** Daniel Herp (líder, ingeniería). Buscamos 1–2 compañeros más.

## 3. Pitch de 60 segundos (guion)
| t | qué se dice | qué se ve |
|---|---|---|
| 0–10 s | "¿Hoy hay agua? Millones en México se lo preguntan cada mañana y nadie les contesta." | pantalla negra, la pregunta |
| 10–20 s | "El gobierno publica presas, sequía y lluvia. Pero eso no le sirve a una mamá a las 6 am." | datos oficiales sueltos |
| 20–40 s | "Sed es un número de WhatsApp. Escaneen el QR y manden su colonia." *(el público lo hace)* "En segundos: semáforo de su zona, cuándo llega el agua y si hay un aviso de calidad, con fuente y fecha." | QR → consultas llegando al mapa en vivo |
| 40–50 s | "Aquí, CTM El Risco: corte programado hasta el 30 de octubre a las 12, según SEGIAGUA. Y si tus vecinos reportan agua con olor, te decimos qué hacer: no beberla, pedir pipa al *426." | caso oficial + caso demo de calidad (con su etiqueta) |
| 50–60 s | "Somos los primeros en cruzar lo que reportan los vecinos con los datos oficiales. Cada reporte hace más inteligente el mapa. Tu llave no avisa. Sed sí." | panel de zonas críticas |

## 4. Qué decir / qué NO decir en el escenario
| ✅ Decir | ❌ No decir |
|---|---|
| "Según SEGIAGUA, corte programado hasta el 30 oct" (con fuente) | "Mañana te llega el agua" sin fuente |
| "Estimado: 2–3 días; no es dato oficial" | Presentar un estimado como fecha oficial |
| "La planta Los Berros reporta parámetros dentro de norma a la salida de planta (26-oct)" | "Tu agua es potable / apta para beber" (planta ≠ llave) |
| "Este aviso de azufre es un **caso de demostración**" | Decir que hay azufre real en una colonia |
| "La ruta del agua es ilustrativa" | "Así viaja exactamente tu agua" |
| "Reportado en prensa el 15-oct" | "Hoy no hay agua en Benito Juárez" |
| "No existe dato público de cortes por colonia en tiempo real; por eso sumamos a los vecinos" | "Tenemos datos en tiempo real de cada calle" |

## 5. Capacidades: qué es dato real, qué es estimado y qué es demo
| capacidad | estado | detalle |
|---|---|---|
| Semáforo por alcaldía/colonia | **dato real + reglas** | sequía SMN, Cutzamala CONAGUA, lluvia Open-Meteo, INEGI 2020, tandeo 2019, reportes SACMEX 2022–24. Umbrales = hipótesis de demo |
| Corte programado con fecha fin | **dato real (si hay aviso)** | aviso SEGIAGUA/alcaldía (hoy: carga manual desde prensa en `demo-cases.json`; caso CTM El Risco) |
| "Días para que llegue" sin aviso | **ESTIMADO** | regla `ESTIMADO_EVENTO` (2–3 días, base: fuga La Caldera oct-2026, ~39 h + restablecimiento gradual). Sin base → "sin dato oficial" |
| Horario de tandeo por colonia | **no integrado** | el portal "Agua en tu colonia" (SEGIAGUA) muestra horario programado, pero su API no devolvió datos; tandeo 2019 solo dice sí/no |
| Calidad a la salida de planta | **dato real** | Los Berros: turbiedad, color, pH, cloro, dureza, olor y sabor (26-oct-2026: todo dentro de norma). Es planta, **no la llave** |
| Calidad por reportes vecinales | **dato real (nuestro)** | ≥3 vecinos únicos en 24 h reportan agua turbia u olor → aviso |
| Azufre / sulfatos por colonia | **NO existe en datos abiertos** → **demo** | búsqueda del 30-oct-2026: Datos CDMX = 0 datasets de agua (el "azufre" que aparece es la RAMA, calidad del aire); los reportes SACMEX solo dicen "Mala calidad" (3,132) sin parámetro. En la demo: `escenarios_demo` con "[DEMO]" |
| Ruta del agua | **ilustrativa** | `ruta_agua.geojson`, etiqueta "ruta aproximada" |
| Abastecimiento por alcaldía | **POR VALIDAR** | curado de prensa |

## 6. Usuario y flujo
**Usuarios**
- **Vecino** (WhatsApp): consulta y reporta.
- **Jurado/público**: ve la pantalla OS.
- **Operador** (Daniel): dispara los casos demo.

**Flujo**
1. QR → `wa.me/<TWILIO_WHATSAPP_NUMBER>?text=Hola`.
2. Bot: "Mándame tu dirección, tu código postal o comparte tu ubicación 📍".
3. Entrada **solo texto o ubicación**. Si es ubicación, Twilio manda `Latitude`/`Longitude`. El texto (dirección o CP de 5 dígitos) se geocodifica, acotado a CDMX; el CP cae al centroide. Las imágenes y audios se ignoran con "Por ahora solo leo texto o ubicación 📍" (sin visión ni LLM).
4. Point-in-polygon → alcaldía y colonia → señales del brain → `evaluate()` + `estimarLlegada()` + `avisoCalidad()`.
5. `consulta` en Supabase → Realtime → el OS anima.
6. Respuesta con `buildReply()` (≤4 líneas).
7. "REPORTAR" → `1` sin agua · `2` turbia/olor · `3` fuga (solo texto) → `reportes`.

**Alcance MVP (sí):** webhook, geocodificación (dirección/CP/ubicación), semáforo, cuándo llega y aviso de calidad con etiquetas, OS con secuencia y multi-punto, 10 casos reales + 2 escenarios demo, reportes por texto, modo mock.

**Opcional (voz):** llamada de alerta con ElevenLabs para zonas críticas. Solo con opt‑in "SÍ" por WhatsApp y máximo 1 por hora por número, al mismo número que escribió (ver `VOZ_ALERTA.md`).

**Fuera:** fotos, visión e imágenes; login; predicción ML; datos por calle en tiempo real (no existen abiertos); calidad en la llave; app nativa; notificaciones proactivas no solicitadas (requieren plantillas aprobadas); pago de pipas.

## 7. Arquitectura (técnico)
**Stack elegido: Next.js (App Router, TS) + MapLibre GL JS v5 (`projection: globe`) + deck.gl (`MapboxOverlay` interleaved: TripsLayer/PathLayer/ScatterplotLayer) + Supabase (Postgres + Realtime) + Vercel.**

¿Por qué?
- MapLibre v5 trae globo nativo con curvatura y transición globo→mercator al hacer zoom, `flyTo`/`fitBounds` suaves, estilos dark libres y es open source, sin key obligatoria.
- deck.gl da la ruta animada en GPU a 60 fps.
- CesiumJS se descarta: es pesado (MBs de workers), su estética es más "simulador" y el dark mode cuesta trabajo. Es overkill sin 3D tiles.
- deck.gl `GlobeView` sola se descarta: es experimental y sin basemap vectorial cómodo.

**Piezas**
```
WhatsApp ─► Twilio ─POST─► /api/twilio/webhook (Vercel)
   ├─ valida X-Twilio-Signature
   ├─ geocode (Google Geocoding; fallback Nominatim solo demo, 1 req/s)
   ├─ pip alcaldía/colonia (turf, GeoJSON del brain en memoria)
   ├─ signals (brain/data, cache en memoria) → evaluate() + estimarLlegada() + avisoCalidad()
   ├─ insert consultas (service role)
   └─ TwiML <Message> buildReply()
Supabase Realtime (postgres_changes INSERT consultas, reportes) ─► /os (cliente)
/os: MapLibre globe + deck.gl + cola de animaciones + panel
```

**Realtime: Supabase Realtime.**
- Cero servidor propio, reconexión incluida, funciona en Vercel.
- SSE requeriría un proceso vivo, cosa que en serverless se complica.
- Fallback: `?mock=1` con emisor local que reproduce demo-cases.

**Mapa**
- Base dark: CARTO Dark Matter GL (`NEXT_PUBLIC_MAP_STYLE`). Revisar sus términos y atribución.
- Toggle MAP/SAT (como Osiris): SAT con raster satelital. Proveedor y términos por validar (ESRI World Imagery o MapTiler con key).

**Look (requisito de UI, no va en el pitch):** globo 3D dark. Referencia: osirisai.live ("Open Source Intelligence Platform", dark, HUD, MAP/SAT).
- Fondo negro azulado.
- Tipografía mono para datos.
- Paneles glass con borde 1px y acentos neón por semáforo:
  - verde #22c55e
  - ámbar #f59e0b
  - rojo #ef4444
  - gris #64748b
- Atmósfera/glow en el globo.

### 7.1 Secuencia cinematográfica del OS (por consulta)
| t | acción |
|---|---|
| 0 | si el globo está lejos: `flyTo` CDMX (zoom 9, pitch 45) |
| +1.8 s | `flyTo` al punto (zoom 13.5, pitch 55, bearing suave, `essential:true`), pulso en el punto |
| +2.6 s | contorno de la alcaldía: line-width 3 + glow (line-blur) en color semáforo, fill 12% opacidad, fade 600 ms |
| +3.2 s | ruta del agua desde `ruta_agua.geojson` con TripsLayer, 2.5 s; etiqueta "ruta aproximada" |
| +3.5 s | panel lateral: nivel, **cuándo llega (badge OFICIAL / ESTIMADO / SIN DATO)**, **calidad (badge PLANTA / VECINOS / CASO DE DEMOSTRACIÓN)**, razones, sequía, Cutzamala %, Los Berros, lluvia 7d, INEGI/tandeo, reportes 24 h, fuentes + fechas |
| +6 s | toast "respuesta enviada" con el texto de WhatsApp |

**Concurrencia**
- Eventos a una cola. Debounce 400 ms para agrupar.
- Nunca se interrumpe un `flyTo`: el siguiente espera `moveend`.
- Si hay ≥2 eventos en 10 s → **modo multi-punto**:
  - `fitBounds` a los últimos ≤8 puntos de 2 min (padding 120, máx zoom 12).
  - Todas las alcaldías involucradas encendidas.
  - Rutas dibujadas en paralelo.
  - El panel se vuelve lista.
- Cola máx 20: si se llena se saltan animaciones, pero todos los puntos se pintan.
- Tras 60 s sin eventos: vuelve a "idle" con rotación lenta del globo.

**Presupuesto de performance**
- 60 fps en laptop de demo.
- Alcaldías simplificadas (22 KB) cargadas al inicio. Colonias (1.6 MB) solo en servidor.
- Capas deck.gl lazy: se cargan con `dynamic()` al primer evento.
- Datos del brain cacheados en memoria. Lluvia con revalidate 1 h.
- Máximo 1 flyTo activo. Sin re-render de React por frame: la animación vive en refs/deck.
- Primer render < 2 s.

## 8. Respuesta WhatsApp (plantilla, ≤4 líneas)
```
🔴 Alerta · CTM El Risco, GAM
⏱ Corte programado hasta 30 oct 12:00 (faltan ≈27 h)
Corte oficial: obra 08:00–12:00. Cutzamala al 95.1%
Fuente: SEGIAGUA vía adn40 (2026-10-27) · Pipa gratis *426 · Locatel *0311
```
```
🟡 Atención · Agrícola Oriental, Iztacalco
⏱ Sin dato oficial de cuándo llega. No hay aviso oficial de corte para tu colonia
⚠️ [DEMO] Alerta de calidad: posible exceso de azufre (olor a huevo). No la bebas ni cocines con ella (hervir no quita químicos). Pide pipa *426 y repórtala
Fuente: caso de demostración · Reporta: *426
```
- Línea 2, cuándo llega: **oficial** ("Corte programado hasta…"), **ESTIMADO (no oficial)** con rango, o "Sin dato oficial".
- Línea 3: aviso de calidad, si lo hay. Si no, las 2 razones principales.
- Recomendaciones, siempre precautorias:
  - químico → no beber ni cocinar, pipa *426;
  - microbiológico → hervir 1 min o pipa;
  - general → "si sale turbia o con olor, no la bebas y repórtala".
- LLM opcional: solo reescribe desde los JSON calculados. `assertSafe()` bloquea "apta para beber", "es potable", "se puede beber", "segura para beber" y "agua segura".

## 9. Modelo de datos (Supabase)
- `consultas`: id uuid, created_at, phone_hash (sha256+salt), canal, texto, lat, lon, geo_fuente (ubicacion|direccion|cp), cve_mun, alcaldia, cve_col, colonia, nivel, resultado jsonb (incluye `llegada` y `calidad`), demo bool.
- `reportes`: id, created_at, phone_hash, tipo (sin_agua|turbia|fuga), lat, lon, cve_mun, cve_col. **Sin media.**
- `sesiones`: phone_hash pk, estado (esperando_direccion|esperando_tipo_reporte|idle), ultima_consulta_id, updated_at.
- Realtime en `consultas` y `reportes`. RLS: el cliente solo lee columnas públicas.
- Reportes 24 h = conteo único por phone_hash en la colonia; si no hay, en la alcaldía. `sin_agua` alimenta C y `turbia` alimenta calidad.

## 10. Brain (`brain/`)
- Datos con `_meta` + `manifest.json`; ver `brain/README.md`.
- `rules/semaforo.ts`: S1 sequía 0–3, S2 Cutzamala 0–3 (solo si aplica), S3 lluvia en temporada 0–1, S4 vulnerabilidad 0–3, C = vecinos únicos sin agua en 24 h.
  - **ROJO**: corte oficial vigente, o C≥5 y (S1+S2≥2 o C≥15).
  - **ÁMBAR**: C≥2, o total≥3, o alerta de calidad.
  - **VERDE**: el resto.
  - **GRIS**: sin dato fresco (≤30 d) y C=0.
- `rules/llegada.ts` `estimarLlegada()`: aviso con fecha fin vigente → oficial. Aviso vencido → "terminó el…; repórtalo". Horario publicado → estimado. Evento sin fin → ESTIMADO 2–3 d. Si no → sin dato.
- `rules/calidad.ts` `avisoCalidad()`, en orden de prioridad: demo → planta fuera de norma → ≥3 vecinos → nada.
- `rules/whatsapp.ts` `buildReply()` + `assertSafe()`. 16 tests (`node --test brain/rules/semaforo.test.ts`).
- Umbrales y `ESTIMADO_EVENTO` = convenciones de demo; ajustar con datos.

## 11. Casos demo (`demo-cases.json`)
| # | colonia (alcaldía) | tipo | fuente · fecha |
|---|---|---|---|
| 1 | Joyas Vallejo / Santa Rosa (GAM) | prensa | Reforma/N+ · reportado el 2026-10-02 |
| 2 | Niños Héroes, U.H. Ramos Millán (BJ) | prensa | Reforma · 2026-10-15 |
| 3 | U.H. Hacienda de las Flores (Iztapalapa), calidad | prensa | N+/Reforma · 2026-10-28 (sin coord: geocodificar) |
| 4 | CTM El Risco (GAM), corte programado 28–30 oct 8–12 h | prensa | adn40/El Informador (cita SEGIAGUA) · 2026-10-27 |
| 5 | Pueblo San Lorenzo Tezonco (Iztapalapa), fuga La Caldera | prensa | El Heraldo/Ámbito · 2026-10-05 |
| 6 | Selene (Tláhuac), mismo evento | prensa | El Heraldo/Milenio · 2026-10-05 |
| 7 | Torres de Potrero (Álvaro Obregón) | prensa | N+ · 2026-03-15 (fecha por validar) |
| 8 | Héroes de Padierna (Tlalpan), fuga, corte hasta 26-jun | prensa | Crónica/Excélsior · 2026-06-17 |
| 9 | Agrícola Oriental (Iztacalco), 6,885 reportes | base histórica | Datos CDMX SACMEX 2022–24 |
| 10 | Pedregal de Santa Úrsula (Coyoacán), 2,051 reportes | base histórica | Datos CDMX SACMEX 2022–24 |

- Coordenadas = punto interior de la colonia (aproximado).
- Nunca decir "hoy no hay agua". Usar el campo `frase` ("reportado el …").

- **Escenarios demo** (`escenarios_demo`, `es_demo: true`, siempre con badge "CASO DE DEMOSTRACIÓN" y "[DEMO]" en WhatsApp):
  - A) Agrícola Oriental: alerta "posible exceso de azufre".
  - B) Pedregal de Santa Úrsula: fuga sin fecha fin → ESTIMADO 2–3 días.
- **Reloj de demo:** `_meta.ahora_demo` = 2026-10-29 09:00 (CDMX), vía `DEMO_NOW`, para que el aviso de CTM El Risco (fin 30-oct 12:00) siga vigente. En vivo, con la hora real, el aviso vencido se reporta como vencido.

## 12. Setup de Daniel
1. **Número:** usar el sender de WhatsApp ya conectado que NO está en el demo de "handle" ni en el otro demo. **Daniel confirma cuál número** → `TWILIO_WHATSAPP_NUMBER`. Ojo: cambiar su webhook rompe lo que hoy lo use.
2. **Opción A, sender existente:** Console → Messaging → Senders → WhatsApp senders → el número → "Webhook URL for incoming messages" = `https://<app>/api/twilio/webhook` (POST).
3. **Opción B, Sandbox (plan B):** número compartido +14155238886, cada usuario manda `join <palabra>`, la sesión dura 3 días, 1 msg/3 s. El webhook va en Sandbox settings → "When a message comes in".
4. **Local:** `ngrok http 3000` → URL al webhook (solo pruebas). **Demo:** deploy en Vercel.
5. **Env vars:** `TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_GEOCODING_API_KEY (opcional), PHONE_HASH_SALT, NEXT_PUBLIC_MAP_STYLE, OPENAI_API_KEY (opcional, solo redacción), DEMO_NOW (opcional, reloj de demo)`.
6. **QR:** `qr-demo.png` apunta a `wa.me/NUMERO_PLACEHOLDER?text=Hola`. **Regenerar con el número real** (formato internacional, sin + ni espacios).

## 13. Criterios de aceptación
- [ ] "Hola" → pide dirección/CP/ubicación en <3 s.
- [ ] Dirección o CP en CDMX → respuesta ≤4 líneas con emoji, cuándo llega (con etiqueta), fuente+fecha y 1 acción, en <6 s.
- [ ] Ubicación → mismo resultado sin geocodificar.
- [ ] Una imagen o audio recibe "solo leo texto o ubicación" sin error.
- [ ] Fuera de CDMX → "Por ahora solo CDMX".
- [ ] CTM El Risco (con `DEMO_NOW`) → "Corte programado hasta 30 oct 12:00" con fuente SEGIAGUA.
- [ ] Escenario A → "[DEMO]" + "Fuente: caso de demostración"; OS con badge.
- [ ] Ningún estimado sin la palabra "ESTIMADO"; nunca "apta para beber" (tests).
- [ ] OS: Realtime <1 s, secuencia completa, 5 consultas en 3 s → multi-punto, 60 fps.
- [ ] Panel: cada dato con fuente/fecha; badges OFICIAL/ESTIMADO/DEMO/POR VALIDAR; ruta "aproximada".
- [ ] `?mock=1` reproduce los 10 casos y los 2 escenarios sin Twilio ni Supabase.
- [ ] Tests de `brain/rules` en verde.

## 14. Riesgos
| riesgo | mitigación |
|---|---|
| Número equivocado o webhook pisado | Daniel confirma; anotar el webhook anterior para restaurarlo |
| Sender requiere plantilla fuera de ventana 24 h | Solo responder a mensajes entrantes |
| Geocoding falla con direcciones mexicanas | Pedir "colonia + alcaldía"; aceptar ubicación; fallback a centroide de colonia por nombre |
| Datos viejos (INEGI 2020, tandeo 2019, reportes ≤2024) | Etiquetados como estructurales; semáforo usa frescura ≤30 d |
| Mapeo de abastecimiento y ruta no oficiales | Etiqueta "por validar / ruta aproximada" en UI |
| Interpretar calidad de planta como calidad en la llave | Texto fijo "salida de planta"; `assertSafe` |
| Wi-Fi del venue | Modo mock + video de respaldo |
| Afirmar falta de agua hoy sin fuente | Usar `frase` con fecha; nunca "hoy no hay agua" |
| Un estimado se lee como promesa | Etiqueta "ESTIMADO (no oficial)" en WhatsApp y badge en OS; test |
| Alerta demo se confunde con hecho | Prefijo [DEMO] en WhatsApp, "Fuente: caso de demostración", badge en OS; nunca en tráfico real sin flag |
